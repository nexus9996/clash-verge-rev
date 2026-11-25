use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use crate::enhance::field::use_keys;

const PATCH_CONFIG_INNER: [&str; 5] = ["allow-lan", "ipv6", "log-level", "unified-delay", "tunnels"];

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    pub(crate) dns_override: Option<super::dns::DnsOverrideState>,
    // Keys seen in the profile pipeline, including merge and script output.
    pub exists_keys: HashSet<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
    /// 记录当前由链式代理 UI 覆盖过 dialer-proxy 的代理节点，以及被覆盖前的原值（None 表示原本没有）。
    /// 断开或重设链式代理时恢复原值，避免误删扩展脚本 / merge 设置的 dialer-proxy。
    pub chain_dialer_proxies: HashMap<String, Option<Value>>,
    /// Last serialization of `config`, invalidated by every config mutation.
    pub(crate) yaml: Option<Arc<str>>,
    pub(crate) revision: u64,
}

impl IRuntime {
    #[inline]
    pub(crate) fn invalidate_yaml(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.yaml = None;
    }

    #[inline]
    pub fn patch_config(&mut self, patch: &Mapping) {
        if self.config.is_none() {
            return;
        }
        self.invalidate_yaml();
        let Some(config) = self.config.as_mut() else {
            return;
        };

        for key in PATCH_CONFIG_INNER.iter() {
            if let Some(value) = patch.get(key) {
                config.insert((*key).into(), value.clone());
            }
        }

        let Some(patch_tun) = patch.get("tun") else {
            return;
        };

        let tun_key = Value::from("tun");
        if !matches!(config.get(&tun_key), Some(Value::Mapping(_))) {
            config.insert(tun_key.clone(), Value::Mapping(Mapping::new()));
        }

        if let (Some(patch_tun_mapping), Some(Value::Mapping(tun))) = (patch_tun.as_mapping(), config.get_mut(&tun_key))
        {
            for key in use_keys(patch_tun_mapping) {
                if let Some(value) = patch_tun_mapping.get(key.as_str()) {
                    tun.insert(Value::from(key.as_str()), value.clone());
                }
            }
        }
    }

    /// Rebuilds `dialer-proxy` links from an ordered proxy chain, or removes them for `None`.
    #[inline]
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>) {
        if self.config.is_none() {
            return;
        }
        self.invalidate_yaml();
        let Some(config) = self.config.as_mut() else {
            return;
        };

        // 只还原链式代理 UI 上一次覆盖的 dialer-proxy，恢复扩展脚本 / merge 等外部来源的原值。
        // 即使当前配置没有 proxies 段也要清空记录，避免旧值落到下一份配置里。
        let previous_chain = std::mem::take(&mut self.chain_dialer_proxies);
        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            for (name, original) in previous_chain {
                let Some(proxy_map) = proxies
                    .iter_mut()
                    .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name.as_str()))
                    .and_then(Value::as_mapping_mut)
                else {
                    continue;
                };

                match original {
                    Some(original) => {
                        proxy_map.insert("dialer-proxy".into(), original);
                    }
                    None => {
                        proxy_map.remove("dialer-proxy");
                    }
                }
            }
        }

        if let Some(Value::Sequence(dialer_proxies)) = proxy_chain_config
            && let Some(Value::Sequence(proxies)) = config.get_mut("proxies")
        {
            for (i, dialer_proxy) in dialer_proxies.iter().enumerate() {
                if let Some(Value::Mapping(proxy)) =
                    proxies.iter_mut().find(|proxy| proxy.get("name") == Some(dialer_proxy))
                    && i != 0
                    && let Some(dialer_proxy) = dialer_proxies.get(i - 1)
                {
                    let Some(name) = proxy.get("name").and_then(Value::as_str).map(String::from) else {
                        continue;
                    };
                    let original = proxy.get("dialer-proxy").cloned();
                    proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
                    self.chain_dialer_proxies.entry(name).or_insert(original);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IRuntime;
    use serde_yaml_ng::Mapping;
    use std::sync::Arc;

    #[test]
    fn mutating_config_invalidates_cached_yaml() {
        let mut runtime = IRuntime {
            config: Some(Mapping::new()),
            yaml: Some(Arc::from("cached")),
            revision: 7,
            ..IRuntime::default()
        };

        runtime.patch_config(&Mapping::new());

        assert!(runtime.yaml.is_none());
        assert_eq!(runtime.revision, 8);
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn disconnecting_chain_preserves_external_dialer_proxy() {
        let mut runtime = IRuntime {
            config: Some(
                serde_yaml_ng::from_str(
                    r"
proxies:
  - name: entry
    type: ss
  - name: exit
    type: ss
    dialer-proxy: external
",
                )
                .expect("valid runtime config"),
            ),
            ..IRuntime::default()
        };

        runtime.update_proxy_chain_config(Some(
            serde_yaml_ng::from_str(r#"["exit", "entry"]"#).expect("valid chain"),
        ));
        assert!(runtime.chain_dialer_proxies.contains_key("entry"));

        runtime.update_proxy_chain_config(None);

        let proxies = runtime
            .config
            .as_ref()
            .and_then(|config| config.get("proxies"))
            .and_then(serde_yaml_ng::Value::as_sequence)
            .expect("proxies remain");
        let entry = proxies
            .iter()
            .find(|proxy| proxy.get("name") == Some(&serde_yaml_ng::Value::from("entry")))
            .expect("entry remains");
        let exit = proxies
            .iter()
            .find(|proxy| proxy.get("name") == Some(&serde_yaml_ng::Value::from("exit")))
            .expect("exit remains");

        assert!(entry.get("dialer-proxy").is_none());
        assert_eq!(
            exit.get("dialer-proxy").and_then(serde_yaml_ng::Value::as_str),
            Some("external")
        );
        assert!(runtime.chain_dialer_proxies.is_empty());
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn disconnecting_chain_restores_an_external_dialer_proxy_on_a_non_first_node() {
        let mut runtime = IRuntime {
            config: Some(
                serde_yaml_ng::from_str(
                    r"
proxies:
  - name: entry
    type: ss
    dialer-proxy: external
  - name: exit
    type: ss
",
                )
                .expect("valid runtime config"),
            ),
            ..IRuntime::default()
        };

        runtime.update_proxy_chain_config(Some(
            serde_yaml_ng::from_str(r#"["exit", "entry"]"#).expect("valid chain"),
        ));
        assert!(runtime.chain_dialer_proxies.contains_key("entry"));

        runtime.update_proxy_chain_config(None);

        let proxies = runtime
            .config
            .as_ref()
            .and_then(|config| config.get("proxies"))
            .and_then(serde_yaml_ng::Value::as_sequence)
            .expect("proxies remain");
        let entry = proxies
            .iter()
            .find(|proxy| proxy.get("name") == Some(&serde_yaml_ng::Value::from("entry")))
            .expect("entry remains");

        assert_eq!(
            entry.get("dialer-proxy").and_then(serde_yaml_ng::Value::as_str),
            Some("external"),
            "the value set by the profile pipeline must come back on disconnect"
        );
        assert!(runtime.chain_dialer_proxies.is_empty());
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn chain_tracking_is_cleared_even_without_a_proxies_sequence() {
        let mut runtime = IRuntime {
            config: Some(serde_yaml_ng::from_str("mode: rule").expect("valid runtime config")),
            ..IRuntime::default()
        };
        runtime
            .chain_dialer_proxies
            .insert("entry".into(), Some(serde_yaml_ng::Value::from("external")));

        runtime.update_proxy_chain_config(None);

        assert!(runtime.chain_dialer_proxies.is_empty());
    }
}

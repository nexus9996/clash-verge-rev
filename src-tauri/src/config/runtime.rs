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

        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            proxies.iter_mut().for_each(|proxy| {
                if let Some(proxy) = proxy.as_mapping_mut()
                    && proxy.get("dialer-proxy").is_some()
                {
                    proxy.remove("dialer-proxy");
                }
            });
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
                    proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
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
}

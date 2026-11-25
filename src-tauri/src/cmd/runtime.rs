use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, runtime::IRuntime},
    core::CoreManager,
    utils::yaml_emitter,
};
use anyhow::{Context as _, anyhow};
use clash_verge_draft::SharedDraft;
use serde::ser::SerializeMap as _;
use smartstring::alias::String;
use std::collections::HashMap;

/// Bulky sections the frontend reads from mihomo APIs instead of Runtime Config.
const IPC_OMITTED_KEYS: &[&str] = &["rules", "rule-providers", "proxy-providers", "proxy-groups"];

/// Serializes only the runtime config the frontend consumes, borrowing the committed snapshot.
#[derive(specta::Type)]
#[specta(inline, type = crate::ipc::YamlMapping)]
pub struct RuntimeConfigView(SharedDraft<IRuntime>);

impl serde::Serialize for RuntimeConfigView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let Some(config) = self.0.config.as_ref() else {
            return serializer.serialize_none();
        };
        let mut map = serializer.serialize_map(Some(config.len().saturating_sub(IPC_OMITTED_KEYS.len())))?;
        for (key, value) in config {
            if key.as_str().is_some_and(|key| IPC_OMITTED_KEYS.contains(&key)) {
                continue;
            }
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(name = "ipc_get_runtime_config", skip_all, level = "debug")]
pub async fn get_runtime_config() -> CmdResult<Option<RuntimeConfigView>> {
    let runtime = Config::runtime().await.latest_arc();
    if runtime.config.is_none() {
        return Ok(None);
    }
    Ok(Some(RuntimeConfigView(runtime)))
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(name = "ipc_get_runtime_yaml", skip_all, level = "debug")]
pub async fn get_runtime_yaml() -> CmdResult<std::string::String> {
    let yaml = Config::runtime_config_yaml().await.stringify_err()?;

    crate::process::AsyncHandler::spawn_blocking(move || {
        let body = Config::runtime_yaml_body(&yaml);
        Ok::<_, anyhow::Error>(yaml_emitter::to_mihomo_config_string_from_yaml(body))
    })
    .await
    .map_err(|join| anyhow!("runtime yaml task failed: {join}"))
    .and_then(|result| result)
    .stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn get_runtime_logs() -> CmdResult<RuntimeLogs> {
    Ok(RuntimeLogs(Config::runtime().await.latest_arc().chain_logs.clone()))
}

#[derive(serde::Serialize, specta::Type)]
#[serde(transparent)]
pub struct RuntimeLogs(
    #[specta(type = HashMap<std::string::String, Vec<(std::string::String, std::string::String)>>)]
    HashMap<String, Vec<(String, String)>>,
);

#[tauri::command]
#[specta::specta]
pub fn take_discarded_keys_notice() -> Option<std::string::String> {
    crate::enhance::take_discarded_keys_notice().map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn get_runtime_proxy_chain_config(
    proxy_chain_exit_node: std::string::String,
) -> CmdResult<std::string::String> {
    let runtime = Config::runtime().await;
    let runtime = runtime.latest_arc();

    let config = runtime
        .config
        .as_ref()
        .ok_or_else(|| anyhow!("failed to parse config to yaml file"))
        .stringify_err()?;

    if let Some(serde_yaml_ng::Value::Sequence(proxies)) = config.get("proxies") {
        let mut proxy_name = Some(Some(proxy_chain_exit_node.as_str()));
        let mut proxies_chain = Vec::new();

        while let Some(proxy) = proxies.iter().find(|proxy| {
            if let serde_yaml_ng::Value::Mapping(proxy_map) = proxy {
                proxy_map.get("name").map(|x| x.as_str()) == proxy_name && proxy_map.get("dialer-proxy").is_some()
            } else {
                false
            }
        }) {
            proxies_chain.push(proxy);
            proxy_name = proxy.get("dialer-proxy").map(|x| x.as_str());
        }

        if let Some(entry_proxy) = proxies
            .iter()
            .find(|proxy| proxy.get("name").map(|x| x.as_str()) == proxy_name)
            && !proxies_chain.is_empty()
        {
            proxies_chain.push(entry_proxy);
        }

        proxies_chain.reverse();

        let mut config: HashMap<String, Vec<&serde_yaml_ng::Value>> = HashMap::new();

        config.insert("proxies".into(), proxies_chain);

        yaml_emitter::to_mihomo_config_string(&config)
            .context("YAML generation failed")
            .stringify_err()
    } else {
        Err("failed to get proxies or proxy-groups".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{IPC_OMITTED_KEYS, RuntimeConfigView};
    use crate::config::runtime::IRuntime;
    use serde_yaml_ng::{Mapping, Value};
    use std::sync::Arc;

    #[test]
    fn runtime_config_view_omits_only_bulk_sections() -> anyhow::Result<()> {
        let mut config = Mapping::new();
        config.insert("mode".into(), Value::from("rule"));
        config.insert("proxies".into(), Value::Sequence(Vec::new()));
        for key in IPC_OMITTED_KEYS {
            config.insert((*key).into(), Value::Sequence(Vec::new()));
        }

        let runtime = Arc::new(Box::new(IRuntime {
            config: Some(config),
            ..IRuntime::default()
        }));
        let value = serde_json::to_value(RuntimeConfigView(runtime))?;

        assert_eq!(value["mode"], serde_json::json!("rule"));
        assert!(value.get("proxies").is_some());
        for key in IPC_OMITTED_KEYS {
            assert!(value.get(*key).is_none(), "{key} must stay out of the IPC payload");
        }
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn update_proxy_chain_config_in_runtime(
    proxy_chain_config: Option<crate::ipc::YamlValue>,
) -> CmdResult<crate::core::validate::ValidationOutcome> {
    let proxy_chain_config = proxy_chain_config.map(|value| value.0);
    CoreManager::global()
        .update_runtime_config(|d| d.update_proxy_chain_config(proxy_chain_config))
        .await
        .stringify_err()
}

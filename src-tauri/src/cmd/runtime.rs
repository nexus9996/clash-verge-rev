use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, runtime::IRuntime},
    core::CoreManager,
    utils::yaml_emitter,
};
use anyhow::{Context as _, anyhow};
use clash_verge_draft::SharedDraft;
use smartstring::alias::String;
use std::collections::HashMap;

/// Serializes only `IRuntime::config`, borrowing the committed snapshot instead of copying it.
#[derive(specta::Type)]
#[specta(inline, type = crate::ipc::YamlMapping)]
pub struct RuntimeConfigView(SharedDraft<IRuntime>);

impl serde::Serialize for RuntimeConfigView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.config.serialize(serializer)
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
    let runtime = Config::runtime().await.latest_arc();

    crate::process::AsyncHandler::spawn_blocking(move || {
        let config = runtime
            .config
            .as_ref()
            .ok_or_else(|| anyhow!("failed to parse config to yaml file"))?;
        yaml_emitter::to_mihomo_config_string(config).context("failed to convert config to yaml")
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

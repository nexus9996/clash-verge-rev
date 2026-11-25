use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::core::{proxy_control, sysopt::Sysopt};

use gethostname::gethostname;
use sysproxy::{Autoproxy, Sysproxy};
use tauri_plugin_clash_verge_sysinfo;

/// Both proxy modes come from the same OS settings and a refresh needs them
/// together, so one command returns both from a single blocking round-trip.
#[derive(serde::Serialize, specta::Type)]
pub struct SystemProxyState {
    pub sysproxy: SystemProxy,
    pub autoproxy: AutoProxy,
}

#[tauri::command]
#[specta::specta]
pub async fn get_system_proxy_state() -> CmdResult<SystemProxyState> {
    Sysopt::global().wait_idle().await;

    // Each platform read can spawn helper processes (gsettings on Linux, the
    // system prefs framework on macOS), so the pair runs on a blocking worker.
    let (sys_proxy, auto_proxy) = crate::process::AsyncHandler::spawn_blocking(|| {
        // With no network service there is no proxy configured anywhere, which reads as disabled.
        let sys_proxy = match Sysproxy::get_system_proxy() {
            Err(error) if proxy_control::is_missing_network_service(&error) => Sysproxy::default(),
            other => other.stringify_err()?,
        };
        let auto_proxy = match Autoproxy::get_auto_proxy() {
            Err(error) if proxy_control::is_missing_network_service(&error) => Autoproxy::default(),
            other => other.stringify_err()?,
        };
        Ok::<_, crate::cmd::CommandFailure>((sys_proxy, auto_proxy))
    })
    .await
    .map_err(|join| crate::cmd::CommandFailure::plain(format!("system proxy state task failed: {join}")))??;

    let Sysproxy {
        host,
        bypass,
        port,
        enable,
    } = sys_proxy;
    let Autoproxy {
        enable: auto_enable,
        url,
    } = auto_proxy;

    Ok(SystemProxyState {
        sysproxy: SystemProxy {
            enable,
            server: format!("{host}:{port}"),
            bypass,
        },
        autoproxy: AutoProxy {
            enable: auto_enable,
            url,
        },
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_embedded_server_port() -> CmdResult<u16> {
    crate::utils::server::embedded_server_port().stringify_err()
}

#[tauri::command]
#[specta::specta]
pub fn get_system_hostname() -> String {
    match gethostname().into_string() {
        Ok(name) => name,
        Err(os_string) => {
            let fallback = format!("{os_string:?}");
            fallback.trim_matches('"').to_string()
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_network_interfaces() -> Vec<String> {
    tauri_plugin_clash_verge_sysinfo::list_network_interfaces()
}

#[tauri::command]
#[specta::specta]
pub fn get_network_interfaces_info() -> CmdResult<Vec<crate::ipc::NetworkInterfaceView>> {
    use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};

    let names = get_network_interfaces();
    let interfaces = NetworkInterface::show().stringify_err()?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface.into());
        }
    }

    Ok(result)
}

#[derive(serde::Serialize, specta::Type)]
pub struct SystemProxy {
    pub enable: bool,
    pub server: String,
    pub bypass: String,
}

#[derive(serde::Serialize, specta::Type)]
pub struct AutoProxy {
    pub enable: bool,
    pub url: String,
}

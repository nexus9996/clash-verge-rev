use crate::core::notify::NoticeStatus;
use crate::core::notify::{Refresh, announce};
use crate::{
    config::{Config, MixedPort},
    constants::latency::DEFAULT_TIMEOUT_MS,
    core::{CoreManager, handle, tray},
    feat::run_exit_cleanup_flow,
    process::AsyncHandler,
    utils,
};
use bytes::BytesMut;
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[allow(clippy::expect_used)]
static TLS_CONFIG: LazyLock<Arc<rustls::ClientConfig>> =
    LazyLock::new(|| Arc::new(utils::network::build_webpki_rooted_tls_config().expect("Failed to set TLS versions")));

pub async fn restart_clash_core() {
    match CoreManager::global().restart_core().await {
        Ok(_) => {
            announce(Refresh::Clash);
        }
        Err(err) => {
            handle::Handle::notice(NoticeStatus::SetConfigError, format!("{err:#}"));
            logging!(error, Type::Core, "restart core failed: {err:#}");
        }
    }
}

pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    let cleanup_result = run_exit_cleanup_flow(NoticeStatus::AppRestartCoreStopFailed).await;

    if !cleanup_result.core_stopped {
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}

fn after_change_clash_mode() {
    AsyncHandler::spawn(move || async {
        if let Err(err) = handle::Handle::mihomo().close_all_connections().await {
            logging!(
                error,
                Type::Core,
                "Failed to close all connections after changing clash mode: {err}"
            );
        }
    });
}

/// Propagates mihomo PATCH failures so the frontend can roll back its optimistic mode.
pub async fn change_clash_mode(mode: String) -> Result<(), String> {
    let config_write = Config::lock_config_write().await;
    let clash = Config::clash().await;
    let previous_mode = clash.data_arc().get_mode().unwrap_or_else(|| "rule".into());
    let transaction = DraftTransaction::begin(vec![&clash]).map_err(|error| error.to_string())?;

    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode.as_str()));
    let json_value = serde_json::json!({
        "mode": mode
    });
    if let Err(err) = handle::Handle::mihomo().patch_base_config(&json_value).await {
        transaction.rollback();
        logging!(error, Type::Core, "change clash mode failed: {err}");
        return Err(err.to_string().into());
    }

    clash.edit_draft(|d| d.patch_config(&mapping));
    if let Err(save_error) = clash.latest_arc().save_config().await {
        transaction.rollback();
        let rollback = serde_json::json!({ "mode": previous_mode });
        if let Err(rollback_error) = handle::Handle::mihomo().patch_base_config(&rollback).await {
            logging!(
                error,
                Type::Core,
                "failed to restore clash mode after config save failure: {rollback_error}"
            );
            return Err(format!(
                "failed to save clash config: {save_error}; failed to restore running mode: {rollback_error}"
            )
            .into());
        }
        return Err(format!("failed to save clash config: {save_error}").into());
    }
    transaction.commit();
    // Persisted and applied: release the write lock before announcing and refreshing the tray.
    drop(config_write);
    announce(Refresh::Clash);
    tray::Tray::global().update_menu_and_icon().await;

    let is_auto_close_connection = Config::verge().await.data_arc().auto_close_connection.unwrap_or(false);
    if is_auto_close_connection {
        after_change_clash_mode();
    }

    Ok(())
}

/// Reads the CONNECT reply up to the end of its headers before the stream becomes TLS.
async fn read_connect_response(stream: &mut tokio::net::TcpStream) -> anyhow::Result<()> {
    let mut response = Vec::with_capacity(256);
    let mut buf = [0u8; 512];
    loop {
        let read = stream.read(&mut buf).await?;
        if read == 0 {
            return Err(anyhow::anyhow!("Proxy CONNECT failed: connection closed"));
        }
        response.extend_from_slice(&buf[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if response.len() >= 8192 {
            return Err(anyhow::anyhow!("Proxy CONNECT failed: oversized response"));
        }
    }

    let status_line = response
        .split(|byte| *byte == b'\n')
        .next()
        .and_then(|line| std::str::from_utf8(line).ok())
        .unwrap_or_default()
        .trim();
    if status_line.split(' ').nth(1) != Some("200") {
        return Err(anyhow::anyhow!("Proxy CONNECT failed: {status_line}"));
    }
    Ok(())
}

/// Test delay to a URL through proxy.
/// HTTPS: measures TLS handshake time. HTTP: measures HEAD round-trip time.
#[tracing::instrument(skip_all, level = "trace", fields(url = %url))]
pub async fn test_delay(url: String) -> anyhow::Result<u32> {
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::Instant;

    let parsed = tauri::Url::parse(&url)?;
    let is_https = parsed.scheme() == "https";
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid URL: no host"))?
        .to_string();
    let port = parsed.port().unwrap_or(if is_https { 443 } else { 80 });
    let path = match parsed.query() {
        Some(query) => format!("{}?{query}", parsed.path()),
        None => parsed.path().to_owned(),
    };

    let verge = Config::verge().await.latest_arc();
    let timeout_ms = verge
        .default_latency_timeout
        .filter(|timeout| *timeout > 0)
        .map_or(DEFAULT_TIMEOUT_MS as u64, |timeout| timeout as u64);
    let proxy_enabled = verge.enable_system_proxy.unwrap_or(false) || verge.enable_tun_mode.unwrap_or(false);
    let proxy_port = if proxy_enabled {
        Some(MixedPort::effective().await)
    } else {
        None
    };

    tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        let start = Instant::now();
        let mut buf = BytesMut::with_capacity(1024);

        if is_https {
            let stream = match proxy_port {
                Some(pp) => {
                    let mut s = TcpStream::connect(format!("127.0.0.1:{pp}")).await?;
                    s.write_all(format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n").as_bytes())
                        .await?;
                    read_connect_response(&mut s).await?;
                    s
                }
                None => TcpStream::connect(format!("{host}:{port}")).await?,
            };
            let connector = tokio_rustls::TlsConnector::from(Arc::clone(&TLS_CONFIG));
            // `host_str` keeps IPv6 brackets; `ServerName` expects the bare address.
            let server_name =
                rustls::pki_types::ServerName::try_from(host.trim_start_matches('[').trim_end_matches(']'))
                    .map_err(|_| anyhow::anyhow!("Invalid DNS name: {host}"))?
                    .to_owned();
            connector.connect(server_name, stream).await?;
        } else {
            let (mut stream, req) = match proxy_port {
                Some(pp) => (
                    TcpStream::connect(format!("127.0.0.1:{pp}")).await?,
                    format!("HEAD {url} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
                ),
                None => (
                    TcpStream::connect(format!("{host}:{port}")).await?,
                    format!("HEAD {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
                ),
            };
            stream.write_all(req.as_bytes()).await?;
            let mut head = Vec::with_capacity(128);
            loop {
                let read = stream.read(&mut buf).await?;
                if read == 0 {
                    break;
                }
                head.extend_from_slice(&buf[..read]);
                if head.windows(2).any(|window| window == b"\r\n") || head.len() >= 512 {
                    break;
                }
            }
            if !head.starts_with(b"HTTP/") {
                return Err(anyhow::anyhow!("Unexpected HTTP response"));
            }
        }

        Ok((start.elapsed().as_millis() as u32).max(1))
    })
    .await
    .unwrap_or(Ok(10000u32))
}

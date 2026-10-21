use crate::{
    cmd::{CmdResult, StringifyErr as _},
    utils::dirs::{self, PathBufExec as _},
};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Component, Path, PathBuf},
    sync::Arc,
    sync::OnceLock,
    time::Duration,
};
use tokio::fs;
use tokio::io::AsyncWriteExt as _;

const ICON_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ICON_BYTES: usize = 4 * 1024 * 1024;
const MAX_ICON_REDIRECTS: usize = 10;

fn is_disallowed_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || a >= 240
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && matches!(c, 0 | 2))
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && matches!(b, 18 | 19))
}

fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_disallowed_ipv4(ip),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.to_ipv4_mapped().is_some_and(is_disallowed_ipv4)
                || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
        }
    }
}

fn resolved_addresses_are_allowed(addrs: &[SocketAddr]) -> bool {
    !addrs.is_empty() && addrs.iter().all(|addr| !is_disallowed_ip(addr.ip()))
}

/// DNS answers must be checked too: a subscription-controlled hostname can resolve to a
/// loopback/link-local address even though its text is not an IP literal.
#[derive(Clone, Copy, Default)]
struct InternalAddressFilter;

impl reqwest::dns::Resolve for InternalAddressFilter {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((name.as_str(), 0))
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { Box::new(error) })?
                .collect();
            if !resolved_addresses_are_allowed(&addrs) {
                return Err("icon host resolves to a disallowed address".into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn host_is_disallowed(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".local") || lower.ends_with(".localhost") {
        return true;
    }

    let literal = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    literal.parse::<IpAddr>().is_ok_and(is_disallowed_ip)
}

/// Subscription-controlled icon URLs must not reach loopback, private or local destinations.
/// The same check runs on every redirect target through the client's redirect policy.
fn validate_icon_url(raw: &str) -> CmdResult<()> {
    let url = reqwest::Url::parse(raw).map_err(|error| format!("invalid icon URL {raw:?}: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("icon URL must use http or https: {raw}").into());
    }

    let host = url.host_str().ok_or_else(|| format!("icon URL has no host: {raw}"))?;
    if host_is_disallowed(host) {
        return Err(format!("icon URL host is not allowed: {raw}").into());
    }

    Ok(())
}

static ICON_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn icon_client() -> CmdResult<&'static reqwest::Client> {
    if let Some(client) = ICON_CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(ICON_TIMEOUT)
        .connect_timeout(Duration::from_secs(5))
        .dns_resolver(Arc::new(InternalAddressFilter))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_ICON_REDIRECTS {
                attempt.error(std::io::Error::other("too many icon redirects"))
            } else if validate_icon_url(attempt.url().as_str()).is_ok() {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|error| format!("Failed to create icon HTTP client: {error}"))?;
    let _ = ICON_CLIENT.set(client);
    ICON_CLIENT
        .get()
        .ok_or_else(|| "Failed to initialize icon HTTP client".into())
}

const fn exceeds_icon_limit(current: usize, incoming: usize) -> bool {
    current.saturating_add(incoming) > MAX_ICON_BYTES
}

#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct IconInfo {
    #[specta(type = std::string::String)]
    name: String,
    #[specta(type = std::string::String)]
    previous_t: String,
    #[specta(type = std::string::String)]
    current_t: String,
}

fn normalize_icon_segment(name: &str) -> CmdResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("invalid icon cache file name".into());
    }

    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed.into()),
        _ => Err("invalid icon cache file name".into()),
    }
}

fn ensure_icon_cache_target(icon_cache_dir: &Path, file_name: &str) -> CmdResult<PathBuf> {
    let icon_path = icon_cache_dir.join(file_name);
    let is_direct_child =
        icon_path.parent().is_some_and(|parent| parent == icon_cache_dir) && icon_path.starts_with(icon_cache_dir);

    if !is_direct_child {
        return Err("invalid icon cache file name".into());
    }

    Ok(icon_path)
}

fn normalized_text_prefix(content: &[u8]) -> std::string::String {
    let content = content.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(content);
    let start = content
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(content.len());
    let end = content.len().min(start.saturating_add(2048));
    let prefix = &content[start..end];
    std::string::String::from_utf8_lossy(prefix).to_ascii_lowercase()
}

fn looks_like_html(content: &[u8]) -> bool {
    let prefix = normalized_text_prefix(content);
    prefix.starts_with("<!doctype html") || prefix.starts_with("<html") || prefix.starts_with("<head")
}

fn looks_like_svg(content: &[u8]) -> bool {
    let prefix = normalized_text_prefix(content);
    prefix.starts_with("<svg")
        || ((prefix.starts_with("<?xml") || prefix.starts_with("<!doctype svg")) && prefix.contains("<svg"))
}

fn is_supported_icon_content(content: &[u8]) -> bool {
    if looks_like_html(content) {
        return false;
    }

    tauri::image::Image::from_bytes(content).is_ok() || looks_like_svg(content)
}

pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    validate_icon_url(url.as_str())?;

    let icon_cache_dir = dirs::app_home_dir().stringify_err()?.join("icons").join("cache");
    let icon_name = normalize_icon_segment(name.as_str())?;
    let icon_path = ensure_icon_cache_target(&icon_cache_dir, icon_name.as_str())?;

    if icon_path.exists() {
        return Ok(icon_path.to_string_lossy().into());
    }

    if !icon_cache_dir.exists() {
        fs::create_dir_all(&icon_cache_dir).await.stringify_err()?;
    }

    let temp_name = format!("{icon_name}.downloading");
    let temp_path = ensure_icon_cache_target(&icon_cache_dir, temp_name.as_str())?;

    let response = icon_client()?.get(url.as_str()).send().await.stringify_err()?;
    // A redirect target rejected by the policy is returned as the raw 3xx response.
    if response.status().is_redirection() {
        return Err(format!("Icon URL redirects to a disallowed address: {}", url.as_str()).into());
    }
    let mut response = response.error_for_status().stringify_err()?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ICON_BYTES as u64)
    {
        return Err(format!("Icon exceeds {MAX_ICON_BYTES} bytes: {}", url.as_str()).into());
    }
    let mut content =
        Vec::with_capacity(response.content_length().unwrap_or_default().min(MAX_ICON_BYTES as u64) as usize);
    while let Some(chunk) = response.chunk().await.stringify_err()? {
        if exceeds_icon_limit(content.len(), chunk.len()) {
            return Err(format!("Icon exceeds {MAX_ICON_BYTES} bytes: {}", url.as_str()).into());
        }
        content.extend_from_slice(&chunk);
    }

    if !is_supported_icon_content(&content) {
        let _ = temp_path.remove_if_exists().await;
        return Err(format!("Downloaded content is not a valid image: {}", url.as_str()).into());
    }

    {
        let mut file = match fs::File::create(&temp_path).await {
            Ok(file) => file,
            Err(_) => {
                if icon_path.exists() {
                    return Ok(icon_path.to_string_lossy().into());
                }
                return Err("Failed to create temporary file".into());
            }
        };
        file.write_all(content.as_ref()).await.stringify_err()?;
        file.flush().await.stringify_err()?;
    }

    if !icon_path.exists() {
        match fs::rename(&temp_path, &icon_path).await {
            Ok(_) => {}
            Err(_) => {
                let _ = temp_path.remove_if_exists().await;
                if icon_path.exists() {
                    return Ok(icon_path.to_string_lossy().into());
                }
            }
        }
    } else {
        let _ = temp_path.remove_if_exists().await;
    }

    Ok(icon_path.to_string_lossy().into())
}

pub async fn copy_icon_file(path: String, icon_info: IconInfo) -> CmdResult<String> {
    let file_path = Path::new(path.as_str());
    let icon_name = normalize_icon_segment(icon_info.name.as_str())?;
    let current_t = normalize_icon_segment(icon_info.current_t.as_str())?;
    let previous_t = if icon_info.previous_t.trim().is_empty() {
        None
    } else {
        Some(normalize_icon_segment(icon_info.previous_t.as_str())?)
    };

    let icon_dir = dirs::app_home_dir().stringify_err()?.join("icons");
    if !icon_dir.exists() {
        fs::create_dir_all(&icon_dir).await.stringify_err()?;
    }

    let ext: String = match file_path.extension() {
        Some(e) => e.to_string_lossy().into(),
        None => "ico".into(),
    };

    let dest_file_name = format!("{icon_name}-{current_t}.{ext}");
    let dest_path = ensure_icon_cache_target(&icon_dir, dest_file_name.as_str())?;

    if file_path.exists() {
        if let Some(previous_t) = previous_t {
            let previous_png = ensure_icon_cache_target(&icon_dir, format!("{icon_name}-{previous_t}.png").as_str())?;
            previous_png.remove_if_exists().await.unwrap_or_default();
            let previous_ico = ensure_icon_cache_target(&icon_dir, format!("{icon_name}-{previous_t}.ico").as_str())?;
            previous_ico.remove_if_exists().await.unwrap_or_default();
        }

        logging!(debug, Type::Cmd, "copying icon file: {path} -> {}", dest_path.display());

        match fs::copy(file_path, &dest_path).await {
            Ok(_) => Ok(dest_path.to_string_lossy().into()),
            Err(err) => Err(err.to_string().into()),
        }
    } else {
        Err("file not found".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_ICON_BYTES, exceeds_icon_limit, resolved_addresses_are_allowed, validate_icon_url};

    #[test]
    fn icon_stream_limit_accepts_the_boundary_and_rejects_growth() {
        assert!(!exceeds_icon_limit(MAX_ICON_BYTES - 1, 1));
        assert!(exceeds_icon_limit(MAX_ICON_BYTES, 1));
        assert!(exceeds_icon_limit(usize::MAX, 1));
    }

    #[test]
    fn icon_resolution_rejects_private_answers_and_accepts_public_ones() {
        use std::net::{Ipv4Addr, SocketAddr};

        assert!(resolved_addresses_are_allowed(&[
            SocketAddr::from((Ipv4Addr::new(1, 1, 1, 1), 443)),
            SocketAddr::from((Ipv4Addr::new(8, 8, 8, 8), 443)),
        ]));
        assert!(!resolved_addresses_are_allowed(&[SocketAddr::from((
            Ipv4Addr::new(127, 0, 0, 1),
            443
        )),]));
        assert!(!resolved_addresses_are_allowed(&[SocketAddr::from((
            Ipv4Addr::new(10, 0, 0, 1),
            80
        )),]));
        assert!(!resolved_addresses_are_allowed(&[]));
    }

    #[test]
    fn icon_urls_allow_public_http_endpoints() {
        for url in [
            "https://example.com/icon.png",
            "http://example.com/icon.png",
            "https://sub.example.com:8443/icons/a.svg",
            "http://1.1.1.1/icon.png",
            "https://8.8.8.8/icon.png",
        ] {
            assert!(validate_icon_url(url).is_ok(), "{url} must be allowed");
        }
    }

    #[test]
    fn icon_urls_reject_non_http_and_internal_hosts() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/icon.png",
            "https://localhost/icon.png",
            "http://localhost./icon.png",
            "http://127.0.0.1/icon.png",
            "http://10.0.0.1/icon.png",
            "http://172.16.0.1/icon.png",
            "http://192.168.1.1/icon.png",
            "http://169.254.10.1/icon.png",
            "http://0.0.0.0/icon.png",
            "http://100.64.0.1/icon.png",
            "http://198.18.0.1/icon.png",
            "http://224.0.0.1/icon.png",
            "http://240.0.0.1/icon.png",
            "http://[::1]/icon.png",
            "http://[fe80::1]/icon.png",
            "http://[fd00::1]/icon.png",
            "http://[::ffff:127.0.0.1]/icon.png",
            "http://printer.local/icon.png",
        ] {
            assert!(validate_icon_url(url).is_err(), "{url} must be rejected");
        }
    }
}

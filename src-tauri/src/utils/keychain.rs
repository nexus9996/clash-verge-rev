//! OS keychain access for credentials that must not live in a config file.
//!
//! The WebDAV password is the only consumer for now. Reads and writes are
//! best-effort: callers fall back to the legacy encrypted config field where a
//! keychain service is unavailable (e.g. a minimal Linux install without a
//! secret service).

use anyhow::{Context as _, Result};
use keyring_core::{Entry, set_default_store};
use smartstring::alias::String;
use std::sync::Once;

const WEBDAV_SERVICE: &str = "clash-verge-rev";
const WEBDAV_ACCOUNT: &str = "webdav-password";

static INSTALL_STORE: Once = Once::new();

/// Installs the platform default credential store on first use. Best-effort:
/// when no store is available the default stays unset and callers observe the
/// NoDefaultStore error path.
fn ensure_default_store() {
    INSTALL_STORE.call_once(|| {
        #[cfg(target_os = "macos")]
        {
            if let Ok(store) = apple_native_keyring_store::keychain::Store::new() {
                set_default_store(store);
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(store) = windows_native_keyring_store::Store::new() {
                set_default_store(store);
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(store) = dbus_secret_service_keyring_store::Store::new() {
                set_default_store(store);
            }
        }
    });
}

/// Stores the WebDAV password in the OS keychain.
pub fn set_webdav_password(password: &str) -> Result<()> {
    ensure_default_store();
    Entry::new(WEBDAV_SERVICE, WEBDAV_ACCOUNT)
        .context("failed to open the keychain entry")?
        .set_password(password)
        .context("failed to store the WebDAV password in the keychain")
}

/// Reads the WebDAV password from the OS keychain, or None when unavailable.
pub fn get_webdav_password() -> Option<String> {
    ensure_default_store();
    Entry::new(WEBDAV_SERVICE, WEBDAV_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(Into::into)
}

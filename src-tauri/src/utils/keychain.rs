//! OS keychain access for credentials that must not live in a config file.
//!
//! The WebDAV password is the only consumer for now. Reads and writes are
//! best-effort: callers fall back to the legacy encrypted config field where a
//! keychain service is unavailable (e.g. a minimal Linux install without a
//! secret service).

use anyhow::{Context as _, Result};
use smartstring::alias::String;

const WEBDAV_SERVICE: &str = "clash-verge-rev";
const WEBDAV_ACCOUNT: &str = "webdav-password";

/// Stores the WebDAV password in the OS keychain.
pub fn set_webdav_password(password: &str) -> Result<()> {
    keyring::Entry::new(WEBDAV_SERVICE, WEBDAV_ACCOUNT)
        .context("failed to open the keychain entry")?
        .set_password(password)
        .context("failed to store the WebDAV password in the keychain")
}

/// Reads the WebDAV password from the OS keychain, or None when unavailable.
pub fn get_webdav_password() -> Option<String> {
    keyring::Entry::new(WEBDAV_SERVICE, WEBDAV_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(Into::into)
}

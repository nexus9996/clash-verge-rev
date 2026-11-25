use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, IVerge},
    core, feat,
};
use clash_verge_draft::DraftTransaction;
use tristr::alias::String;

#[tauri::command]
#[specta::specta]
pub async fn save_webdav_config(
    url: std::string::String,
    username: std::string::String,
    password: std::string::String,
) -> CmdResult<()> {
    let _config_write = Config::lock_config_write().await;
    let verge = Config::verge().await;
    let transaction = DraftTransaction::begin(vec![&verge]).map_err(|error| error.to_string())?;
    let url: String = url.into();
    let username: String = username.into();
    let password: String = password.into();

    // The password is a credential: prefer the OS keychain and clear any legacy
    // encrypted copy. Fall back to the encrypted config field only where no
    // keychain service is available, so WebDAV keeps working on minimal Linux.
    let password_in_keychain = crate::utils::keychain::set_webdav_password(password.as_str()).is_ok();
    let legacy_password = if password_in_keychain { None } else { Some(password) };

    verge.edit_draft(|e| {
        e.patch_config(&IVerge {
            webdav_url: Some(url),
            webdav_username: Some(username),
            webdav_password: legacy_password,
            ..IVerge::default()
        });
        if password_in_keychain {
            e.webdav_password = None;
        }
    });
    if let Err(error) = verge.latest_arc().save_file().await {
        transaction.rollback();
        return Err(error.to_string().into());
    }
    transaction.commit();
    core::backup::WebDavClient::global().reset();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn create_webdav_backup() -> CmdResult<()> {
    feat::create_backup_and_upload_webdav().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn list_webdav_backup() -> CmdResult<Vec<crate::ipc::WebDavFile>> {
    feat::list_wevdav_backup()
        .await
        .map(|files| files.into_iter().map(Into::into).collect())
        .stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn delete_webdav_backup(filename: std::string::String) -> CmdResult<()> {
    let filename: String = filename.into();
    feat::delete_webdav_backup(filename).await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn restore_webdav_backup(filename: std::string::String) -> CmdResult<()> {
    let filename: String = filename.into();
    feat::restore_webdav_backup(filename)
        .await
        .map_err(|error| super::proxy_aware_error(&error))
}

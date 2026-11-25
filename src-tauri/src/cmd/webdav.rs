use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, IVerge},
    core, feat,
};
use clash_verge_draft::DraftTransaction;
use smartstring::alias::String;

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
    let patch = IVerge {
        webdav_url: Some(url),
        webdav_username: Some(username),
        webdav_password: Some(password),
        ..IVerge::default()
    };
    verge.edit_draft(|e| e.patch_config(&patch));
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

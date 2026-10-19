use super::{CmdResult, CommandFailure, WithErrorCode as _, proxy_aware_coded_error, proxy_aware_error};
use crate::core::notify::NoticeStatus;
use crate::feat;
use crate::utils::{dirs, yaml_emitter};
use crate::{
    cmd::StringifyErr as _,
    config::{ClashInfo, Config, profiles::profiles_save_file_safe},
    constants,
    core::{
        CoreManager,
        handle::{self, Handle},
        validate::{CoreConfigValidator, ValidationOutcome},
    },
};
use clash_verge_logging::{Type, logging, logging_error};
use smartstring::alias::String;
use tokio::fs;

#[tauri::command]
#[specta::specta]
pub async fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().await.data_arc().get_client_info())
}

#[tauri::command]
#[specta::specta]
pub async fn patch_clash_config(payload: crate::ipc::YamlMapping) -> CmdResult {
    feat::patch_clash(&payload.0)
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CLASH_CONFIG_UPDATE_FAILED"))
}

#[tauri::command]
#[specta::specta]
pub async fn patch_clash_mode(payload: std::string::String) -> CmdResult {
    let payload: String = payload.into();
    feat::change_clash_mode(payload)
        .await
        .with_error_code("CLASH_MODE_UPDATE_FAILED")
}

/// Reads the saved mode without depending on strict mihomo `/configs` deserialization.
#[tauri::command]
#[specta::specta]
pub async fn get_clash_mode() -> CmdResult<Option<std::string::String>> {
    Ok(Config::clash().await.data_arc().get_mode())
}

#[tauri::command]
#[specta::specta]
pub async fn change_clash_core(clash_core: std::string::String) -> CmdResult<Option<CommandFailure>> {
    let clash_core: String = clash_core.into();
    logging!(info, Type::Config, "changing core to {clash_core}");

    match CoreManager::global().change_core(&clash_core).await {
        Ok(_) => {
            logging_error!(Type::Core, profiles_save_file_safe().await);

            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    handle::Handle::notice(NoticeStatus::ConfigCoreChangeSuccess, clash_core.as_str());
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let failed = err.context("core changed but failed to restart");
                    let error_msg: String = format!("{failed:#}").into();
                    handle::Handle::notice(NoticeStatus::ConfigCoreChangeError, error_msg.as_str());
                    logging!(error, Type::Core, "core changed but failed to restart: {error_msg}");
                    Ok(Some(proxy_aware_coded_error(&failed, "CORE_CHANGE_FAILED")))
                }
            }
        }
        Err(err) => {
            let error_msg: String = format!("{err:#}").into();
            logging!(error, Type::Core, "failed to change core: {error_msg}");
            handle::Handle::notice(NoticeStatus::ConfigCoreChangeError, error_msg.as_str());
            Ok(Some(proxy_aware_coded_error(&err, "CORE_CHANGE_FAILED")))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn restart_core() -> CmdResult {
    logging_error!(Type::Core, profiles_save_file_safe().await);
    let result = CoreManager::global()
        .restart_core()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CORE_RESTART_FAILED"));
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// Replaces the managed core binary atomically instead of letting mihomo overwrite itself.
#[tauri::command]
#[specta::specta]
pub async fn upgrade_clash_core(force: bool) -> CmdResult<feat::CoreUpgradeReport> {
    let report = feat::upgrade_core(force).await.with_error_code("CORE_UPGRADE_FAILED")?;
    if report.upgraded {
        handle::Handle::refresh_clash();
    }
    Ok(report)
}

/// Lists the core versions installable for the managed core's release channel.
#[tauri::command]
#[specta::specta]
pub async fn get_core_versions() -> CmdResult<feat::CoreVersionCatalog> {
    feat::get_core_versions().await.with_error_code("CORE_VERSIONS_FAILED")
}

/// Installs an explicit core version through the same stage/publish/rollback path as an upgrade.
#[tauri::command]
#[specta::specta]
pub async fn install_core_version(version: std::string::String) -> CmdResult<feat::CoreUpgradeReport> {
    let report = feat::install_core_version(version)
        .await
        .with_error_code("CORE_INSTALL_FAILED")?;
    if report.upgraded {
        handle::Handle::refresh_clash();
    }
    Ok(report)
}

#[tauri::command]
#[specta::specta]
pub async fn test_delay(url: std::string::String) -> CmdResult<u32> {
    let url: String = url.into();
    let result = match feat::test_delay(url).await {
        Ok(delay) => delay,
        Err(e) => {
            logging!(error, Type::Cmd, "get clash delay failed: {e:#}");
            10000u32
        }
    };
    Ok(result)
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuleExtraInfo {
    pub index: i64,
    pub disabled: bool,
    pub hit_count: u64,
    pub hit_at: std::string::String,
    pub miss_count: u64,
    pub miss_at: std::string::String,
}

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuleDisableRequest {
    pub index: i64,
    pub disabled: bool,
}

#[derive(serde::Deserialize)]
struct RawRulesResponse {
    rules: Vec<RawRule>,
}

#[derive(serde::Deserialize)]
struct RawRule {
    index: i64,
    extra: Option<RawRuleExtra>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRuleExtra {
    disabled: bool,
    hit_count: u64,
    hit_at: std::string::String,
    miss_count: u64,
    miss_at: std::string::String,
}

/// Rule disabling is runtime state in mihomo and resets when the core reloads.
#[tauri::command]
#[specta::specta]
pub async fn update_rules_disable(requests: Vec<RuleDisableRequest>) -> CmdResult {
    let disabled: std::collections::BTreeMap<i64, bool> = requests
        .into_iter()
        .map(|request| (request.index, request.disabled))
        .collect();

    let request = {
        let ctx = Handle::mihomo().load_ctx();
        ctx.build_request(reqwest::Method::PATCH, "rules/disable")
            .stringify_err()?
    };
    let response = request.json(&disabled).send().await.stringify_err()?;
    response.error_for_status().stringify_err()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_rules_extra() -> CmdResult<Vec<RuleExtraInfo>> {
    let request = {
        let ctx = Handle::mihomo().load_ctx();
        ctx.build_request(reqwest::Method::GET, "rules").stringify_err()?
    };
    let response = request.send().await.stringify_err()?;
    let payload: RawRulesResponse = response
        .error_for_status()
        .stringify_err()?
        .json()
        .await
        .stringify_err()?;

    Ok(payload
        .rules
        .into_iter()
        .filter_map(|rule| {
            rule.extra.map(|extra| RuleExtraInfo {
                index: rule.index,
                disabled: extra.disabled,
                hit_count: extra.hit_count,
                hit_at: extra.hit_at,
                miss_count: extra.miss_count,
                miss_at: extra.miss_at,
            })
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn save_dns_config(dns_config: crate::ipc::YamlMapping) -> CmdResult {
    use crate::utils::dirs;
    use tokio::fs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    let yaml_str = yaml_emitter::to_mihomo_config_string(&dns_config.0).stringify_err()?;
    fs::write(&dns_path, yaml_str).await.stringify_err()?;
    logging!(info, Type::Config, "DNS config saved to {dns_path:?}");

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn take_dns_override_notice() -> bool {
    crate::config::dns::take_dns_override_notice()
}

#[tauri::command]
#[specta::specta]
pub async fn set_dns_override(
    profile_uid: std::string::String,
    enabled: bool,
    confirmation: Option<std::string::String>,
) -> CmdResult<feat::DnsOverrideOutcome> {
    let profile_uid: String = profile_uid.into();
    let confirmation = confirmation.map(String::from);
    feat::set_dns_override(profile_uid, enabled, confirmation)
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "DNS_OVERRIDE_UPDATE_FAILED"))
}

#[tauri::command]
#[specta::specta]
pub async fn apply_dns_config(apply: bool) -> CmdResult {
    if apply {
        let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

        if !dns_path.exists() {
            logging!(warn, Type::Config, "DNS config file not found: {}", dns_path.display());
            return Err("DNS config file not found".into());
        }

        let dns_yaml = fs::read_to_string(&dns_path).await.stringify_err_log(|e| {
            logging!(
                error,
                Type::Config,
                "Failed to read DNS config {}: {e}",
                dns_path.display()
            );
        })?;

        serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml).stringify_err_log(|e| {
            logging!(
                error,
                Type::Config,
                "Failed to parse DNS config {}: {e}",
                dns_path.display()
            );
        })?;

        CoreManager::global().update_config_checked().await.map_err(|error| {
            logging!(error, Type::Config, "failed to apply the config with DNS: {error:#}");
            proxy_aware_error(&error)
        })?;

        logging!(info, Type::Config, "DNS config successfully applied");
    } else {
        logging!(info, Type::Config, "DNS settings disabled, regenerating config");

        CoreManager::global().update_config_checked().await.map_err(|error| {
            logging!(error, Type::Config, "failed to apply the regenerated config: {error:#}");
            proxy_aware_error(&error)
        })?;

        logging!(info, Type::Config, "Config regenerated successfully");
    }

    logging_error!(Type::Config, Config::sync_dns_override().await);
    handle::Handle::refresh_clash();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_dns_config_content() -> CmdResult<Option<std::string::String>> {
    use crate::utils::dirs;
    use tokio::fs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    match fs::read_to_string(&dns_path).await {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CommandFailure::plain(error)),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn validate_dns_config() -> CmdResult<ValidationOutcome> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    let dns_path = app_dir.join(constants::files::DNS_CONFIG);
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok(ValidationOutcome::invalid_from_message("DNS config file not found"));
    }

    // A fragment, not a runnable config; the merged result is validated on apply.
    CoreConfigValidator::validate_config_file_outcome(dns_path_str, Some(true))
        .await
        .stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn get_clash_logs() -> CmdResult<Vec<std::string::String>> {
    let logs = CoreManager::global().get_clash_logs().await.unwrap_or_default();
    Ok(logs)
}

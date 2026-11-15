use tauri::ipc::Channel;

use crate::cmd::{CmdResult, CommandFailure};
use crate::core::logs::{self, LogBatch};

/// Streams mihomo log lines in bounded batches.
///
/// Returns the subscription id passed to [`unsubscribe_logs`].
#[tauri::command]
#[specta::specta]
pub fn subscribe_logs(level: String, on_message: Channel<LogBatch>) -> CmdResult<u64> {
    let level = level.to_ascii_uppercase();
    if !logs::supports_level(&level) {
        return Err(CommandFailure::plain(format!("unknown log level: {level}")));
    }
    Ok(logs::subscribe(level, on_message))
}

/// Stops one log stream; the mihomo socket closes with the last one.
#[tauri::command]
#[specta::specta]
pub fn unsubscribe_logs(id: u64) {
    logs::unsubscribe(id);
}

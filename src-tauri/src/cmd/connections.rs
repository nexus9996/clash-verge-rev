use tauri::ipc::Channel;

use crate::core::connections::{self, StreamKind};

/// Streams the coalesced mihomo connection snapshot to one webview.
///
/// Returns the subscription id passed to [`unsubscribe_connections`].
#[tauri::command]
#[specta::specta]
pub fn subscribe_connections(on_message: Channel<String>) -> u64 {
    connections::subscribe(StreamKind::Snapshots, Box::new(on_message))
}

/// Streams the active-connection count from the same mihomo socket.
#[tauri::command]
#[specta::specta]
pub fn subscribe_connections_count(on_message: Channel<String>) -> u64 {
    connections::subscribe(StreamKind::Count, Box::new(on_message))
}

/// Stops one connection stream; the mihomo socket closes with the last one.
#[tauri::command]
#[specta::specta]
pub fn unsubscribe_connections(id: u64) {
    connections::unsubscribe(id);
}

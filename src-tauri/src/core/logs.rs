//! Batched mihomo log stream.
//!
//! The plugin forwards every mihomo log line as its own IPC frame, so the frame
//! rate equals the line rate during a connection storm. This hub keeps one
//! `/logs` subscription, groups lines into bounded batches, and drops the
//! oldest lines (reporting the count) instead of letting a slow webview grow
//! an unbounded queue.

use std::collections::{HashMap, VecDeque};
use std::sync::LazyLock;
use std::time::Duration;

use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_mihomo::models::{LogLevel, WsConnectionId};
use tokio::sync::Notify;

use crate::core::notify::handle::Handle;
use crate::process::AsyncHandler;

/// One IPC frame worth of raw mihomo log lines, plus the lines dropped before it.
#[derive(Clone, serde::Serialize, specta::Type)]
pub struct LogBatch {
    pub lines: Vec<String>,
    pub dropped: u32,
}

/// Coalescing window; the logs page already merges frames every 50 ms.
const BATCH_WINDOW: Duration = Duration::from_millis(20);
/// Lines per frame, matching logcat's batch cap.
const MAX_BATCH_LINES: usize = 300;
const MAX_BATCH_BYTES: usize = 64 * 1024;
/// Backpressure: the oldest lines go first when the webview cannot keep up.
const MAX_PENDING_LINES: usize = 2_000;
const MAX_PENDING_BYTES: usize = 256 * 1024;
const RETRY_DELAY: Duration = Duration::from_secs(1);

#[derive(Default)]
struct LogBuffer {
    lines: VecDeque<String>,
    bytes: usize,
    dropped: u32,
}

impl LogBuffer {
    fn push(&mut self, line: String) {
        self.bytes += line.len();
        self.lines.push_back(line);

        while self.lines.len() > MAX_PENDING_LINES || self.bytes > MAX_PENDING_BYTES {
            let Some(dropped) = self.lines.pop_front() else {
                break;
            };
            self.bytes -= dropped.len();
            self.dropped = self.dropped.saturating_add(1);
        }
    }

    fn take_batch(&mut self) -> Option<LogBatch> {
        if self.lines.is_empty() {
            return None;
        }

        let mut lines = Vec::new();
        let mut bytes = 0usize;
        while let Some(line) = self.lines.front() {
            if !lines.is_empty() && (lines.len() >= MAX_BATCH_LINES || bytes + line.len() > MAX_BATCH_BYTES) {
                break;
            }
            let Some(line) = self.lines.pop_front() else {
                break;
            };
            bytes += line.len();
            lines.push(line);
        }
        self.bytes -= bytes;

        Some(LogBatch {
            lines,
            dropped: std::mem::take(&mut self.dropped),
        })
    }

    fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

fn parse_level(value: &str) -> Option<LogLevel> {
    Some(match value {
        "DEBUG" => LogLevel::DEBUG,
        "INFO" => LogLevel::INFO,
        "WARNING" => LogLevel::WARNING,
        "ERROR" => LogLevel::ERROR,
        "SILENT" => LogLevel::SILENT,
        _ => return None,
    })
}

/// Whether a normalized level name has a mihomo counterpart.
pub fn supports_level(value: &str) -> bool {
    parse_level(value).is_some()
}

#[derive(Default)]
struct Hub {
    next_id: u64,
    running: bool,
    level: Option<String>,
    failed: bool,
    subscribers: HashMap<u64, Channel<LogBatch>>,
}

impl Hub {
    fn idle(&self) -> bool {
        self.subscribers.is_empty()
    }

    fn deliver(&mut self, batch: &LogBatch) {
        self.subscribers.retain(|_, sink| sink.send(batch.clone()).is_ok());
    }
}

fn hub() -> &'static Mutex<Hub> {
    static HUB: LazyLock<Mutex<Hub>> = LazyLock::new(|| Mutex::new(Hub::default()));
    &HUB
}

fn buffer() -> &'static Mutex<LogBuffer> {
    static BUFFER: LazyLock<Mutex<LogBuffer>> = LazyLock::new(|| Mutex::new(LogBuffer::default()));
    &BUFFER
}

fn wake() -> &'static Notify {
    static WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);
    &WAKE
}

/// Registers a subscriber and starts the shared mihomo socket on demand.
pub fn subscribe(level: String, channel: Channel<LogBatch>) -> u64 {
    let mut state = hub().lock();
    let id = state.next_id;
    state.next_id = state.next_id.wrapping_add(1);
    state.subscribers.insert(id, channel);
    state.level = Some(level);
    state.failed = false;
    let start = !state.running;
    state.running = true;
    drop(state);

    wake().notify_one();
    if start {
        AsyncHandler::spawn(pump);
    }

    id
}

/// Removes a subscriber; the shared socket closes once none remain.
pub fn unsubscribe(id: u64) {
    let mut state = hub().lock();
    state.subscribers.remove(&id);
    let idle = state.idle();
    drop(state);

    if idle {
        wake().notify_one();
    }
}

/// Keeps the shared socket open while anyone is subscribed.
async fn pump() {
    let mut failures = 0u32;
    loop {
        if stop_if_idle() {
            return;
        }

        let Some(level) = hub().lock().level.clone() else {
            logging!(error, Type::Config, "log stream started without a level");
            if stop_if_idle() {
                return;
            }
            tokio::time::sleep(RETRY_DELAY).await;
            continue;
        };
        let Some(parsed) = parse_level(&level) else {
            logging!(error, Type::Config, "unsupported mihomo log level: {level}");
            if stop_if_idle() {
                return;
            }
            tokio::time::sleep(RETRY_DELAY).await;
            continue;
        };

        match open_stream(parsed).await {
            Ok(ws) => {
                failures = 0;
                let end = read_batches(&level).await;
                let _ = Handle::mihomo().disconnect(ws, Some(1000)).await;
                if matches!(end, ReadEnd::LevelChanged) {
                    continue;
                }
            }
            Err(error) => {
                // A stopped core is expected; report the transition, not every retry.
                if failures == 0 {
                    logging!(warn, Type::Network, "failed to open mihomo log stream: {error}");
                } else {
                    logging!(debug, Type::Network, "mihomo log stream still unavailable: {error}");
                }
                failures = failures.saturating_add(1);
            }
        }

        if stop_if_idle() {
            return;
        }
        tokio::time::sleep(RETRY_DELAY).await;
    }
}

/// Marks the pump stopped when nobody is subscribed; `true` means exit.
fn stop_if_idle() -> bool {
    let mut state = hub().lock();
    if state.idle() {
        state.running = false;
        drop(state);
        return true;
    }
    false
}

async fn open_stream(level: LogLevel) -> tauri_plugin_mihomo::Result<WsConnectionId> {
    *buffer().lock() = LogBuffer::default();
    hub().lock().failed = false;

    Handle::mihomo()
        .ws_logs(level, |bytes| {
            let Ok(text) = String::from_utf8(bytes) else {
                return;
            };
            let line = text.trim_end();
            if line.is_empty() {
                return;
            }
            // The plugin wraps transport errors as JSON strings; mihomo logs are objects.
            if !line.starts_with('{') {
                hub().lock().failed = true;
                wake().notify_one();
                return;
            }
            buffer().lock().push(line.to_owned());
            wake().notify_one();
        })
        .await
}

enum ReadEnd {
    LevelChanged,
    SubscribersGone,
    TransportError,
}

fn check_stream(ws_level: &str) -> Option<ReadEnd> {
    let state = hub().lock();
    if state.idle() {
        return Some(ReadEnd::SubscribersGone);
    }
    if state.level.as_deref() != Some(ws_level) {
        return Some(ReadEnd::LevelChanged);
    }
    if state.failed {
        return Some(ReadEnd::TransportError);
    }
    drop(state);
    None
}

/// Delivers pending lines once per [`BATCH_WINDOW`].
async fn read_batches(ws_level: &str) -> ReadEnd {
    loop {
        if let Some(end) = check_stream(ws_level) {
            return end;
        }

        if buffer().lock().is_empty() {
            tokio::select! {
                _ = wake().notified() => {}
            }
        }
        if let Some(end) = check_stream(ws_level) {
            return end;
        }

        tokio::time::sleep(BATCH_WINDOW).await;

        let batch = { buffer().lock().take_batch() };
        if let Some(batch) = batch {
            hub().lock().deliver(&batch);
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    #[test]
    fn bounded_buffer_drops_oldest_and_reports_dropped() {
        let mut buffer = LogBuffer::default();
        for index in 0..(MAX_PENDING_LINES + 3) {
            buffer.push(format!("line-{index}"));
        }

        let batch = buffer.take_batch().expect("batch");
        assert_eq!(batch.lines.len(), MAX_BATCH_LINES);
        assert_eq!(batch.dropped, 3);
        assert_eq!(batch.lines[0], "line-3");
    }

    #[test]
    fn batch_stops_at_line_and_byte_caps() {
        let mut buffer = LogBuffer::default();
        for index in 0..(MAX_BATCH_LINES + 5) {
            buffer.push(format!("line-{index}"));
        }
        let first = buffer.take_batch().expect("first batch");
        assert_eq!(first.lines.len(), MAX_BATCH_LINES);
        assert_eq!(first.dropped, 0);

        let second = buffer.take_batch().expect("remainder");
        assert_eq!(second.lines.len(), 5);
        assert_eq!(second.lines[4], format!("line-{}", MAX_BATCH_LINES + 4));

        let mut buffer = LogBuffer::default();
        let half = MAX_BATCH_BYTES / 2 + 1;
        buffer.push("a".repeat(half));
        buffer.push("b".repeat(half));
        assert_eq!(buffer.take_batch().expect("single").lines.len(), 1);
        assert_eq!(buffer.take_batch().expect("second").lines.len(), 1);
    }

    #[test]
    fn parse_level_accepts_canonical_names() {
        assert!(matches!(parse_level("DEBUG"), Some(LogLevel::DEBUG)));
        assert!(matches!(parse_level("INFO"), Some(LogLevel::INFO)));
        assert!(matches!(parse_level("WARNING"), Some(LogLevel::WARNING)));
        assert!(matches!(parse_level("ERROR"), Some(LogLevel::ERROR)));
        assert!(matches!(parse_level("SILENT"), Some(LogLevel::SILENT)));
        assert!(parse_level("verbose").is_none());
    }
}

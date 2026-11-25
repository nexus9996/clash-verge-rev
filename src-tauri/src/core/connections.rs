//! One mihomo `/connections` subscription shared by every webview stream.
//!
//! Mihomo pushes the whole connection list on every connection event, and the
//! plugin forwards each snapshot as its own IPC frame. A busy proxy therefore
//! sends many full-list frames per second and the webview throws most of them
//! away. This hub keeps the newest snapshot and delivers it on a fixed window,
//! and it derives the active-connection count from the same mihomo socket
//! instead of opening a second `/connections` subscription.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_mihomo::models::WsConnectionId;
use tokio::sync::Notify;

use crate::core::notify::handle::Handle;
use crate::process::AsyncHandler;

/// Fastest rate a snapshot or count reaches the webview.
const COALESCE_WINDOW: Duration = Duration::from_millis(100);
/// Delay before reopening the mihomo subscription after a failure.
const RETRY_DELAY: Duration = Duration::from_secs(1);
/// Reopen after this much silence: mihomo can drop the socket on reload
/// without the reader seeing an error.
const SILENCE_LIMIT: Duration = Duration::from_secs(30);

/// What a subscriber wants from the shared snapshot stream.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// The full mihomo snapshot, as mihomo's own JSON text.
    Snapshots,
    /// `{"count":N}` frames only.
    Count,
}

/// Destination for delivered frames; `false` drops the subscriber.
pub trait ConnectionSink: Send {
    fn send(&self, text: &str) -> bool;
}

impl ConnectionSink for Channel<String> {
    fn send(&self, text: &str) -> bool {
        Self::send(self, text.to_owned()).is_ok()
    }
}

#[derive(Default)]
struct Hub {
    next_id: u64,
    running: bool,
    pending: Option<String>,
    latest: Option<(String, usize)>,
    subscribers: HashMap<u64, (StreamKind, Box<dyn ConnectionSink>)>,
}

impl Hub {
    fn subscribe(&mut self, kind: StreamKind, sink: Box<dyn ConnectionSink>) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);

        if let Some(frame) = self.replay_frame(kind)
            && !sink.send(&frame)
        {
            return id;
        }

        self.subscribers.insert(id, (kind, sink));
        id
    }

    fn unsubscribe(&mut self, id: u64) {
        self.subscribers.remove(&id);
    }

    fn idle(&self) -> bool {
        self.subscribers.is_empty()
    }

    const fn take_pending(&mut self) -> Option<String> {
        self.pending.take()
    }

    fn deliver(&mut self, text: String, count: usize) {
        let count_frame = format!("{{\"count\":{count}}}");
        self.subscribers.retain(|_, (kind, sink)| match kind {
            StreamKind::Snapshots => sink.send(&text),
            StreamKind::Count => sink.send(&count_frame),
        });
        self.latest = Some((text, count));
    }

    /// The last delivered frame reshaped for `kind`, so a late subscriber does
    /// not wait for the next mihomo event.
    fn replay_frame(&self, kind: StreamKind) -> Option<String> {
        let (text, count) = self.latest.as_ref()?;
        Some(match kind {
            StreamKind::Snapshots => text.clone(),
            StreamKind::Count => format!("{{\"count\":{count}}}"),
        })
    }
}

fn hub() -> &'static Mutex<Hub> {
    static HUB: LazyLock<Mutex<Hub>> = LazyLock::new(|| Mutex::new(Hub::default()));
    &HUB
}

fn wake() -> &'static Notify {
    static WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);
    &WAKE
}

/// Registers a subscriber and starts the shared mihomo socket on demand.
pub fn subscribe(kind: StreamKind, sink: Box<dyn ConnectionSink>) -> u64 {
    let mut state = hub().lock();
    let id = state.subscribe(kind, sink);
    let start = !state.running;
    state.running = true;
    drop(state);

    if start {
        AsyncHandler::spawn(pump);
    }

    id
}

/// Removes a subscriber; the shared socket closes once none remain.
pub fn unsubscribe(id: u64) {
    let mut state = hub().lock();
    state.unsubscribe(id);
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

        match open_stream().await {
            Ok(ws) => {
                failures = 0;
                read_frames().await;
                let _ = Handle::mihomo().disconnect(ws, Some(1000)).await;
            }
            Err(error) => {
                // A stopped core is expected; report the transition, not every retry.
                if failures == 0 {
                    logging!(warn, Type::Network, "failed to open mihomo connections stream: {error}");
                } else {
                    logging!(
                        debug,
                        Type::Network,
                        "mihomo connections stream still unavailable: {error}"
                    );
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

async fn open_stream() -> tauri_plugin_mihomo::Result<WsConnectionId> {
    hub().lock().pending = None;
    Handle::mihomo()
        .ws_connections(|bytes| {
            let Ok(text) = String::from_utf8(bytes) else {
                return;
            };
            if text.is_empty() {
                return;
            }
            hub().lock().pending = Some(text);
            wake().notify_one();
        })
        .await
}

/// Delivers the newest snapshot once per [`COALESCE_WINDOW`].
async fn read_frames() {
    loop {
        let idle = { hub().lock().idle() };
        if idle {
            return;
        }

        tokio::select! {
            _ = wake().notified() => {}
            _ = tokio::time::sleep(SILENCE_LIMIT) => {
                logging!(debug, Type::Network, "mihomo connections stream went silent; reopening");
                return;
            }
        }

        tokio::time::sleep(COALESCE_WINDOW).await;

        let pending = { hub().lock().take_pending() };
        let Some(text) = pending else {
            continue;
        };

        let Some(count) = connection_count(&text) else {
            logging!(
                warn,
                Type::Network,
                "mihomo connections frame was not a snapshot; reopening"
            );
            return;
        };

        hub().lock().deliver(text, count);

        let idle = { hub().lock().idle() };
        if idle {
            return;
        }
    }
}

fn connection_count(text: &str) -> Option<usize> {
    #[derive(serde::Deserialize)]
    struct SnapshotEnvelope {
        #[serde(default)]
        connections: Option<Vec<serde::de::IgnoredAny>>,
    }

    let envelope = serde_json::from_str::<SnapshotEnvelope>(text).ok()?;
    Some(envelope.connections.map_or(0, |connections| connections.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use parking_lot::Mutex as StdMutex;

    const SNAPSHOT: &str = r#"{"downloadTotal":10,"uploadTotal":20,"connections":[{"id":"a"},{"id":"b"}]}"#;

    #[derive(Default)]
    struct RecordingSink {
        frames: Arc<StdMutex<Vec<String>>>,
        fail_after: Option<usize>,
    }

    impl RecordingSink {
        fn new(frames: Arc<StdMutex<Vec<String>>>, fail_after: Option<usize>) -> Self {
            Self { frames, fail_after }
        }
    }

    impl ConnectionSink for RecordingSink {
        fn send(&self, text: &str) -> bool {
            let mut frames = self.frames.lock();
            if self.fail_after.is_some_and(|limit| frames.len() >= limit) {
                return false;
            }
            frames.push(text.to_owned());
            true
        }
    }

    #[test]
    fn snapshot_and_count_subscribers_share_one_frame() {
        let snapshots = Arc::new(StdMutex::new(Vec::new()));
        let counts = Arc::new(StdMutex::new(Vec::new()));
        let mut hub = Hub::default();
        let snapshot_id = hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&snapshots), None)),
        );
        let count_id = hub.subscribe(
            StreamKind::Count,
            Box::new(RecordingSink::new(Arc::clone(&counts), None)),
        );
        assert_ne!(snapshot_id, count_id);

        assert_eq!(connection_count(SNAPSHOT), Some(2));
        hub.deliver(SNAPSHOT.to_owned(), 2);

        assert_eq!(snapshots.lock().as_slice(), [SNAPSHOT]);
        assert_eq!(counts.lock().as_slice(), [r#"{"count":2}"#]);
    }

    #[test]
    fn rejected_frame_drops_only_that_subscriber() {
        let failing = Arc::new(StdMutex::new(Vec::new()));
        let healthy = Arc::new(StdMutex::new(Vec::new()));
        let mut hub = Hub::default();
        hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&failing), Some(0))),
        );
        hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&healthy), None)),
        );

        hub.deliver(SNAPSHOT.to_owned(), 2);

        assert!(failing.lock().is_empty());
        assert_eq!(healthy.lock().len(), 1);
        assert!(!hub.idle());
    }

    #[test]
    fn new_subscriber_replays_the_latest_frame() {
        let early = Arc::new(StdMutex::new(Vec::new()));
        let mut hub = Hub::default();
        hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&early), None)),
        );
        hub.deliver(SNAPSHOT.to_owned(), 2);

        let late_snapshots = Arc::new(StdMutex::new(Vec::new()));
        let late_counts = Arc::new(StdMutex::new(Vec::new()));
        hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&late_snapshots), None)),
        );
        hub.subscribe(
            StreamKind::Count,
            Box::new(RecordingSink::new(Arc::clone(&late_counts), None)),
        );

        assert_eq!(late_snapshots.lock().as_slice(), [SNAPSHOT]);
        assert_eq!(late_counts.lock().as_slice(), [r#"{"count":2}"#]);
    }

    #[test]
    fn last_unsubscribe_makes_the_hub_idle() {
        let frames = Arc::new(StdMutex::new(Vec::new()));
        let mut hub = Hub::default();
        let id = hub.subscribe(
            StreamKind::Snapshots,
            Box::new(RecordingSink::new(Arc::clone(&frames), None)),
        );
        assert!(!hub.idle());
        hub.unsubscribe(id);
        assert!(hub.idle());
    }

    #[test]
    fn pending_keeps_only_the_newest_frame() {
        let mut hub = Hub {
            next_id: 0,
            running: false,
            pending: Some("first".to_owned()),
            latest: None,
            subscribers: HashMap::new(),
        };
        hub.pending = Some("second".to_owned());
        assert_eq!(hub.take_pending().as_deref(), Some("second"));
        assert_eq!(hub.take_pending(), None);
    }

    #[test]
    fn count_rejects_transport_errors() {
        assert_eq!(connection_count(SNAPSHOT), Some(2));
        assert_eq!(connection_count(r#"{"connections":null}"#), Some(0));
        assert_eq!(connection_count(r#""websocket error""#), None);
        assert_eq!(connection_count("not json"), None);
    }
}

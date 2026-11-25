use super::{handle::Handle, notification::FrontendEvent};
use parking_lot::Mutex;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
pub enum Refresh {
    Clash,
    Verge,
    Profiles,
    Proxies,
}

const REFRESH_WINDOW: Duration = Duration::from_millis(20);
static BATCH: RefreshBatch = RefreshBatch(Mutex::new(Vec::new()));

#[derive(Default)]
struct RefreshBatch(Mutex<Vec<Refresh>>);

impl RefreshBatch {
    fn enqueue(&self, refresh: Refresh) -> bool {
        let mut pending = self.0.lock();
        let start_window = pending.is_empty();
        if !pending.contains(&refresh) {
            pending.push(refresh);
        }
        start_window
    }

    async fn flush(&self, emit: impl Fn(Vec<Refresh>)) {
        // A fixed window bounds latency even under a continuous stream of refreshes.
        tokio::time::sleep(REFRESH_WINDOW).await;
        let refreshes = std::mem::take(&mut *self.0.lock());
        // One save announces several kinds; delivering the window as one batch
        // keeps it to a single message and a single main-thread dispatch.
        if !refreshes.is_empty() {
            emit(refreshes);
        }
    }
}

pub fn announce(refresh: Refresh) {
    if BATCH.enqueue(refresh) {
        crate::AsyncHandler::spawn(|| BATCH.flush(emit));
    }
}

fn emit(refreshes: Vec<Refresh>) {
    Handle::send_event(FrontendEvent::Refresh(refreshes));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bursts_keep_each_refresh_kind_and_rearm_during_delivery() -> anyhow::Result<()> {
        let batch = RefreshBatch::default();
        let delivered = Mutex::new(Vec::new());
        assert!(batch.enqueue(Refresh::Clash));
        for refresh in [Refresh::Verge, Refresh::Clash, Refresh::Profiles, Refresh::Proxies] {
            assert!(!batch.enqueue(refresh));
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            batch
                .flush(|refreshes| {
                    delivered.lock().extend(refreshes.iter().copied());
                    if refreshes.contains(&Refresh::Clash) {
                        assert!(batch.enqueue(Refresh::Clash));
                        assert!(!batch.enqueue(Refresh::Clash));
                    }
                })
                .await;
            batch.flush(|refreshes| delivered.lock().extend(refreshes)).await;
        })
        .await?;
        assert_eq!(
            *delivered.lock(),
            [
                Refresh::Clash,
                Refresh::Verge,
                Refresh::Profiles,
                Refresh::Proxies,
                Refresh::Clash
            ]
        );
        assert!(batch.enqueue(Refresh::Verge));
        Ok(())
    }

    #[tokio::test]
    async fn one_save_emits_one_message_for_both_refreshes() -> anyhow::Result<()> {
        let batch = RefreshBatch::default();
        let delivered = Mutex::new(Vec::new());
        // A setting save announces its config change and its runtime change
        // back to back, from the same task.
        assert!(batch.enqueue(Refresh::Verge));
        assert!(!batch.enqueue(Refresh::Clash));
        tokio::time::timeout(
            Duration::from_secs(1),
            batch.flush(|refreshes| delivered.lock().push(refreshes)),
        )
        .await?;

        let delivered = delivered.lock();
        assert_eq!(delivered.len(), 1);
        assert_eq!(delivered[0], [Refresh::Verge, Refresh::Clash]);
        Ok(())
    }
}

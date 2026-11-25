use crate::{
    config::{Config, IVerge},
    process::AsyncHandler,
};
use anyhow::{Result, anyhow};
use clash_verge_draft::SharedDraft;
use serde_yaml_ng::Mapping;
use std::{sync::OnceLock, time::Duration};
use tokio::sync::{MutexGuard, mpsc, oneshot};

/// Give a queued transaction a chance to release the write lock before reporting the queue stuck.
const CONFIG_WRITE_WAIT: Duration = Duration::from_secs(2);
/// Bounds how many UI patches can wait behind a slow configuration transaction.
const PATCH_QUEUE_CAPACITY: usize = 64;
/// Collect a short burst before applying so adjacent compatible patches share one transaction.
const PATCH_COALESCE_WINDOW: Duration = Duration::from_millis(5);

enum QueuedPatch {
    Verge {
        patch: Box<IVerge>,
        persist: bool,
        /// System-proxy failures carry structured classification, so those patches stay alone.
        system_proxy: bool,
    },
    Clash(Mapping),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MergeKey {
    Verge { persist: bool },
    Clash,
}

impl QueuedPatch {
    const fn merge_key(&self) -> Option<MergeKey> {
        match self {
            Self::Clash(_) => Some(MergeKey::Clash),
            Self::Verge {
                persist,
                system_proxy: false,
                ..
            } => Some(MergeKey::Verge { persist: *persist }),
            Self::Verge { .. } => None,
        }
    }

    fn merge(&mut self, other: Self) {
        match (self, other) {
            (Self::Verge { patch, .. }, Self::Verge { patch: next, .. }) => patch.patch_config(&next),
            (Self::Clash(current), Self::Clash(next)) => current.extend(next),
            _ => {}
        }
    }
}

#[derive(Debug)]
enum PatchFailure {
    Full(anyhow::Error),
    Detail(String),
}

impl PatchFailure {
    fn into_error(self) -> anyhow::Error {
        match self {
            Self::Full(error) => error,
            Self::Detail(detail) => anyhow!(detail),
        }
    }
}

impl std::fmt::Display for PatchFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Full(error) => write!(formatter, "{error:#}"),
            Self::Detail(detail) => formatter.write_str(detail),
        }
    }
}

impl std::error::Error for PatchFailure {}

struct PatchJob {
    patch: QueuedPatch,
    response: oneshot::Sender<Result<(), PatchFailure>>,
}

fn patch_queue() -> &'static mpsc::Sender<PatchJob> {
    static QUEUE: OnceLock<mpsc::Sender<PatchJob>> = OnceLock::new();
    QUEUE.get_or_init(|| {
        let (sender, receiver) = mpsc::channel(PATCH_QUEUE_CAPACITY);
        AsyncHandler::spawn(move || run_patch_queue(receiver, apply_queued));
        sender
    })
}

async fn run_patch_queue<F, Fut>(mut receiver: mpsc::Receiver<PatchJob>, mut apply: F)
where
    F: FnMut(QueuedPatch) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<()>> + Send,
{
    while let Some(first) = receiver.recv().await {
        let mut jobs = vec![first];
        tokio::time::sleep(PATCH_COALESCE_WINDOW).await;
        while let Ok(job) = receiver.try_recv() {
            jobs.push(job);
            if jobs.len() >= PATCH_QUEUE_CAPACITY {
                break;
            }
        }
        run_patch_batch(jobs, &mut apply).await;
    }
}

async fn run_patch_batch<F, Fut>(jobs: Vec<PatchJob>, apply: &mut F)
where
    F: FnMut(QueuedPatch) -> Fut,
    Fut: std::future::Future<Output = Result<()>> + Send,
{
    let mut jobs = jobs.into_iter().peekable();
    while let Some(first) = jobs.next() {
        let key = first.patch.merge_key();
        let mut group = vec![first];
        if let Some(key) = key {
            while jobs.peek().is_some_and(|job| job.patch.merge_key() == Some(key)) {
                if let Some(job) = jobs.next() {
                    group.push(job);
                }
            }
        }

        let (patch, responses) = merge_group(group);
        let result = apply(patch).await;
        send_results(responses, result);
    }
}

fn merge_group(mut jobs: Vec<PatchJob>) -> (QueuedPatch, Vec<oneshot::Sender<Result<(), PatchFailure>>>) {
    let first = jobs.remove(0);
    let mut patch = first.patch;
    let mut responses = vec![first.response];
    for job in jobs {
        patch.merge(job.patch);
        responses.push(job.response);
    }
    (patch, responses)
}

fn send_results(responses: Vec<oneshot::Sender<Result<(), PatchFailure>>>, result: Result<()>) {
    match result {
        Ok(()) => {
            for response in responses {
                let _ = response.send(Ok(()));
            }
        }
        Err(error) => {
            let mut responses = responses.into_iter();
            let Some(first) = responses.next() else {
                return;
            };
            let Some(second) = responses.next() else {
                let _ = first.send(Err(PatchFailure::Full(error)));
                return;
            };
            let detail = format!("{error:#}");
            let _ = first.send(Err(PatchFailure::Detail(detail.clone())));
            let _ = second.send(Err(PatchFailure::Detail(detail.clone())));
            for response in responses {
                let _ = response.send(Err(PatchFailure::Detail(detail.clone())));
            }
        }
    }
}

async fn apply_queued(patch: QueuedPatch) -> Result<()> {
    match patch {
        QueuedPatch::Verge { patch, persist, .. } => {
            apply_verge_patch(&patch, persist).await?;
            // TUN patches do not always produce a Run State transition, so reconciliation is explicit.
            if patch.enable_tun_mode.is_some() {
                super::reconcile_tun_availability().await;
            }
            Ok(())
        }
        QueuedPatch::Clash(patch) => apply_clash_patch(&patch).await,
    }
}

async fn enqueue(patch: QueuedPatch) -> Result<()> {
    let (response, result) = oneshot::channel();
    let job = PatchJob { patch, response };

    match tokio::time::timeout(CONFIG_WRITE_WAIT, patch_queue().send(job)).await {
        Ok(Ok(())) => {}
        Ok(Err(_)) => return Err(anyhow!("configuration update queue stopped")),
        Err(_) => return Err(anyhow!("configuration update is already running")),
    }

    result
        .await
        .map_err(|_| anyhow!("configuration update task stopped"))?
        .map_err(PatchFailure::into_error)
}

pub async fn patch_clash(patch: &Mapping) -> Result<()> {
    enqueue(QueuedPatch::Clash(patch.clone())).await
}

pub async fn patch_verge(patch: &IVerge, not_save_file: bool) -> Result<()> {
    let system_proxy = super::effects::verge_effects(patch).contains(&super::effects::Effect::SystemProxy);
    enqueue(QueuedPatch::Verge {
        patch: Box::new(patch.clone()),
        persist: !not_save_file,
        system_proxy,
    })
    .await
}

async fn apply_clash_patch(patch: &Mapping) -> Result<()> {
    let config_write = Config::lock_config_write_bounded(CONFIG_WRITE_WAIT).await?;
    super::executor::apply(
        &config_write,
        super::executor::Patch::Clash(patch),
        super::effects::clash_effects(patch),
    )
    .await
}

async fn apply_verge_patch(patch: &IVerge, persist: bool) -> Result<()> {
    let config_write = Config::lock_config_write_bounded(CONFIG_WRITE_WAIT).await?;
    apply_verge_patch_locked(&config_write, patch, !persist).await
}

/// Apply a patch with the shared configuration write lock already held.
/// Callers must pass the guard returned by [`Config::lock_config_write`].
pub(super) async fn apply_verge_patch_locked(
    _config_write: &MutexGuard<'_, ()>,
    patch: &IVerge,
    not_save_file: bool,
) -> Result<()> {
    super::executor::apply(
        _config_write,
        super::executor::Patch::Verge {
            patch,
            persist: !not_save_file,
        },
        super::effects::verge_effects(patch),
    )
    .await
}

pub async fn fetch_verge_config() -> Result<SharedDraft<IVerge>> {
    let draft = Config::verge().await;
    let data = draft.data_arc();
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::{PatchJob, QueuedPatch, run_patch_queue};
    use crate::config::IVerge;
    use anyhow::anyhow;
    use serde_yaml_ng::{Mapping, Value};
    use std::sync::Arc;
    use tokio::sync::{mpsc, oneshot};

    #[tokio::test]
    async fn queued_patches_run_in_order_and_keep_their_own_result() -> anyhow::Result<()> {
        let (sender, receiver) = mpsc::channel(4);
        let applied = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let recorded = Arc::clone(&applied);
        let worker = tokio::spawn(run_patch_queue(receiver, move |patch| {
            let recorded = Arc::clone(&recorded);
            async move {
                let label = match patch {
                    QueuedPatch::Clash(_) => 2,
                    QueuedPatch::Verge { .. } => 1,
                };
                recorded.lock().push(label);
                Ok(())
            }
        }));

        let (first_tx, first_rx) = oneshot::channel();
        sender
            .send(PatchJob {
                patch: QueuedPatch::Clash(Mapping::new()),
                response: first_tx,
            })
            .await
            .map_err(|_| anyhow!("queue closed"))?;
        let (second_tx, second_rx) = oneshot::channel();
        sender
            .send(PatchJob {
                patch: QueuedPatch::Verge {
                    patch: Box::new(IVerge::default()),
                    persist: true,
                    system_proxy: false,
                },
                response: second_tx,
            })
            .await
            .map_err(|_| anyhow!("queue closed"))?;

        first_rx.await.map_err(|_| anyhow!("first response dropped"))??;
        second_rx.await.map_err(|_| anyhow!("second response dropped"))??;
        drop(sender);
        worker.await?;
        assert_eq!(*applied.lock(), vec![2, 1]);
        Ok(())
    }

    #[tokio::test]
    async fn adjacent_clash_patches_share_one_apply() -> anyhow::Result<()> {
        let (sender, receiver) = mpsc::channel(4);
        let applied = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let recorded = Arc::clone(&applied);
        let worker = tokio::spawn(run_patch_queue(receiver, move |patch| {
            let recorded = Arc::clone(&recorded);
            async move {
                if let QueuedPatch::Clash(patch) = patch {
                    recorded.lock().push(patch);
                }
                Ok(())
            }
        }));

        let mut first = Mapping::new();
        first.insert("mode".into(), Value::from("rule"));
        let mut second = Mapping::new();
        second.insert("allow-lan".into(), Value::from(true));

        let (first_tx, first_rx) = oneshot::channel();
        sender
            .send(PatchJob {
                patch: QueuedPatch::Clash(first),
                response: first_tx,
            })
            .await
            .map_err(|_| anyhow!("queue closed"))?;
        let (second_tx, second_rx) = oneshot::channel();
        sender
            .send(PatchJob {
                patch: QueuedPatch::Clash(second),
                response: second_tx,
            })
            .await
            .map_err(|_| anyhow!("queue closed"))?;

        first_rx.await.map_err(|_| anyhow!("first response dropped"))??;
        second_rx.await.map_err(|_| anyhow!("second response dropped"))??;
        drop(sender);
        worker.await?;

        let applied = applied.lock();
        assert_eq!(applied.len(), 1);
        assert_eq!(applied[0]["mode"].as_str(), Some("rule"));
        assert_eq!(applied[0]["allow-lan"].as_bool(), Some(true));
        Ok(())
    }
}

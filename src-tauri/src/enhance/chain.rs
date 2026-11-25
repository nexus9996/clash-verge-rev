use super::SeqMap;
use crate::{
    config::PrfItem,
    utils::{dirs, help},
};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::SystemTime;
use tokio::fs;
use tristr::alias::String;

#[derive(Debug, Clone)]
pub struct ChainItem {
    pub uid: String,
    pub data: ChainType,
}

#[derive(Debug, Clone)]
pub enum ChainType {
    Merge(Arc<Mapping>),
    Script(String),
    Rules(SeqMap),
    Proxies(SeqMap),
    Groups(SeqMap),
}

struct CachedChain {
    mtime: SystemTime,
    len: u64,
    item: ChainItem,
}

static CHAIN_CACHE: LazyLock<Mutex<HashMap<PathBuf, CachedChain>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

impl ChainItem {
    pub async fn from_profile(item: &PrfItem) -> Option<Self> {
        let itype = item.itype.as_ref()?.as_str();
        let file = item.file.clone()?;
        let uid = item.uid.clone().unwrap_or_else(|| "".into());
        let path = dirs::app_profiles_dir().ok()?.join(file.as_str());

        let meta = fs::metadata(&path).await.ok()?;
        let (mtime, len) = (meta.modified().ok()?, meta.len());
        if let Some(cached) = CHAIN_CACHE.lock().get(&path)
            && cached.mtime == mtime
            && cached.len == len
        {
            return Some(cached.item.clone());
        }

        let loaded = match itype {
            "script" => match fs::read_to_string(&path).await {
                Ok(content) => Some(Self {
                    uid,
                    data: ChainType::Script(content.into()),
                }),
                Err(error) => {
                    logging!(
                        warn,
                        Type::Config,
                        "failed to read script file {}: {error:#}",
                        path.display()
                    );
                    None
                }
            },
            "merge" => match help::read_mapping_cached(&path).await {
                Ok(mapping) => Some(Self {
                    uid,
                    data: ChainType::Merge(mapping),
                }),
                Err(error) => {
                    logging!(
                        warn,
                        Type::Config,
                        "failed to read merge file {}: {error:#}",
                        path.display()
                    );
                    None
                }
            },
            "rules" | "proxies" | "groups" => match help::read_yaml::<SeqMap>(&path).await {
                Ok(seq_map) => {
                    let data = match itype {
                        "rules" => ChainType::Rules(seq_map),
                        "proxies" => ChainType::Proxies(seq_map),
                        _ => ChainType::Groups(seq_map),
                    };
                    Some(Self { uid, data })
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Config,
                        "failed to read chain file {}: {error:#}",
                        path.display()
                    );
                    None
                }
            },
            _ => None,
        }?;

        CHAIN_CACHE.lock().insert(
            path,
            CachedChain {
                mtime,
                len,
                item: loaded.clone(),
            },
        );
        Some(loaded)
    }
}

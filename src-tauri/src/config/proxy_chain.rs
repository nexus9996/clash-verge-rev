use anyhow::{Result, bail};
use serde_yaml_ng::{Mapping, Value};
use std::collections::HashSet;
use tristr::alias::String;

/// Rejects a chain that cannot be applied atomically: fewer than two hops, a
/// duplicate node, or a node that is not an inline proxy mapping.
pub fn validate_proxy_chain(config: &Mapping, chain: &[String]) -> Result<()> {
    if chain.len() < 2 {
        bail!("proxy chain requires at least two hops");
    }

    let mut seen = HashSet::with_capacity(chain.len());
    for name in chain {
        if !seen.insert(name.clone()) {
            bail!("proxy chain contains a duplicate node: {name}");
        }
    }

    let Some(Value::Sequence(proxies)) = config.get("proxies") else {
        bail!("proxy chain requires inline proxies");
    };

    for name in chain {
        let found = proxies.iter().any(|proxy| {
            proxy.get("name").and_then(Value::as_str) == Some(name.as_str()) && matches!(proxy, Value::Mapping(_))
        });
        if !found {
            bail!("proxy chain node is not an inline proxy: {name}");
        }
    }
    Ok(())
}

/// Applies an ordered chain (as the frontend submits it: entry first) to an
/// enhanced config. The first hop is the terminal, so its `dialer-proxy` is
/// removed and every following hop is chained to its predecessor. Validation is
/// all-or-nothing; a rejected chain leaves `config` untouched.
pub fn apply_proxy_chain(config: &mut Mapping, chain: &[String]) -> Result<()> {
    validate_proxy_chain(config, chain)?;

    let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
        // Unreachable after validation, but keep the guard so a rejected apply
        // can never produce a partial chain.
        bail!("proxy chain requires inline proxies");
    };

    for (index, name) in chain.iter().enumerate() {
        let Some(Value::Mapping(proxy)) = proxies
            .iter_mut()
            .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name.as_str()))
        else {
            continue;
        };
        if index == 0 {
            proxy.remove("dialer-proxy");
        } else {
            proxy.insert("dialer-proxy".into(), Value::String(chain[index - 1].to_string()));
        }
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::apply_proxy_chain;

    fn parse(yaml: &str) -> serde_yaml_ng::Mapping {
        serde_yaml_ng::from_str(yaml).expect("valid yaml")
    }

    fn names<'a>(config: &'a serde_yaml_ng::Mapping, node: &str) -> Option<Option<&'a str>> {
        config
            .get("proxies")
            .and_then(serde_yaml_ng::Value::as_sequence)?
            .iter()
            .find(|proxy| proxy.get("name").and_then(serde_yaml_ng::Value::as_str) == Some(node))
            .map(|proxy| proxy.get("dialer-proxy").and_then(serde_yaml_ng::Value::as_str))
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn applying_a_chain_links_hops_to_their_predecessor() {
        let mut config = parse(
            r"
proxies:
  - {name: entry, type: ss}
  - {name: middle, type: ss}
  - {name: exit, type: ss}
",
        );
        let chain: Vec<tristr::alias::String> = vec!["entry".into(), "middle".into(), "exit".into()];

        apply_proxy_chain(&mut config, &chain).expect("valid chain");

        assert_eq!(names(&config, "entry"), Some(None));
        assert_eq!(names(&config, "middle"), Some(Some("entry")));
        assert_eq!(names(&config, "exit"), Some(Some("middle")));
    }

    #[test]
    #[allow(clippy::expect_used)]
    fn a_rejected_chain_leaves_the_config_untouched() {
        let mut config = parse(
            r"
proxies:
  - {name: entry, type: ss, dialer-proxy: external}
  - {name: exit, type: ss}
",
        );
        let before = config.clone();
        // Missing node and a duplicate both fail before any mutation.
        let chain: Vec<tristr::alias::String> = vec!["entry".into(), "missing".into()];

        assert!(apply_proxy_chain(&mut config, &chain).is_err());
        assert_eq!(config, before);
    }
}

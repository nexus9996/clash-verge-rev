use anyhow::{Context as _, Result};
use granit_parser::{Event, Parser, ScalarStyle};
use serde::Serialize;

#[tracing::instrument(name = "yaml_mihomo_serialize", skip_all, level = "debug")]
pub fn to_mihomo_config_string<T: Serialize>(data: &T) -> Result<String> {
    let yaml = to_runtime_config_string(data)?;
    Ok(to_mihomo_config_string_from_yaml(&yaml))
}

/// Applies only the mihomo-specific rewrite to an already runtime-serialized document.
#[tracing::instrument(
    name = "yaml_mihomo_rewrite",
    skip_all,
    level = "debug",
    fields(bytes = yaml.len())
)]
pub fn to_mihomo_config_string_from_yaml(yaml: &str) -> String {
    if !yaml.contains("fake-ip-filter:") {
        return yaml.to_owned();
    }
    quote_fake_ip_filter_wildcards(yaml)
}

#[tracing::instrument(name = "yaml_runtime_serialize", skip_all, level = "debug")]
pub fn to_runtime_config_string<T: Serialize>(data: &T) -> Result<String> {
    let yaml = serde_yaml_ng::to_string(data)?;
    if !may_contain_date_like_scalar(&yaml) {
        return Ok(yaml);
    }
    quote_date_like_strings(&yaml)
}

/// A plain date-like scalar is the only shape the rewrite below can match, so documents
/// without one do not need a second full parse.
fn may_contain_date_like_scalar(yaml: &str) -> bool {
    yaml.as_bytes()
        .windows(5)
        .any(|window| window[4] == b'-' && window[..4].iter().all(u8::is_ascii_digit))
}

#[tracing::instrument(
    name = "yaml_quote_date_like",
    skip_all,
    level = "debug",
    fields(bytes = yaml.len())
)]
fn quote_date_like_strings(yaml: &str) -> Result<String> {
    let mut result = String::with_capacity(yaml.len());
    let mut copied = 0;

    for event in Parser::new_from_str(yaml) {
        let (Event::Scalar(value, ScalarStyle::Plain, _, None), span) = event? else {
            continue;
        };
        if !value
            .as_bytes()
            .get(..5)
            .is_some_and(|prefix| prefix[4] == b'-' && prefix[..4].iter().all(u8::is_ascii_digit))
        {
            continue;
        }

        let range = span.byte_range().context("missing YAML scalar byte range")?;
        result.push_str(&yaml[copied..range.start]);
        result.push_str(&serde_json::to_string(value.as_ref())?);
        copied = range.end;
    }

    result.push_str(&yaml[copied..]);
    Ok(result)
}

#[tracing::instrument(
    name = "yaml_quote_fake_ip_filter",
    skip_all,
    level = "debug",
    fields(bytes = yaml.len())
)]
fn quote_fake_ip_filter_wildcards(yaml: &str) -> String {
    let mut result = String::with_capacity(yaml.len());
    let mut in_fake_ip_filter = false;
    let mut fake_ip_filter_indent = 0;

    for line in yaml.lines() {
        let indent = leading_spaces(line);
        let trimmed = &line[indent..];

        if in_fake_ip_filter && indent <= fake_ip_filter_indent && !trimmed.starts_with("- ") {
            in_fake_ip_filter = false;
        }

        if !in_fake_ip_filter && trimmed == "fake-ip-filter:" {
            in_fake_ip_filter = true;
            fake_ip_filter_indent = indent;
            result.push_str(line);
            result.push('\n');
            continue;
        }

        if in_fake_ip_filter && indent >= fake_ip_filter_indent && trimmed.starts_with("- ") {
            result.push_str(&line[..indent]);
            result.push_str("- ");
            result.push_str(&quote_wildcard_item(&trimmed[2..]));
            result.push('\n');
            continue;
        }

        result.push_str(line);
        result.push('\n');
    }

    result
}

fn leading_spaces(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

fn quote_wildcard_item(item: &str) -> String {
    if !item.starts_with('\"') && !item.starts_with('\'') && contains_wildcard(item) {
        quote_string(item)
    } else {
        item.to_string()
    }
}

fn quote_string(s: &str) -> String {
    "\'".to_string() + s.replace('\'', "''").as_str() + "\'"
}

fn contains_wildcard(value: &str) -> bool {
    value.contains('*') || value.starts_with('+') || value.starts_with('.')
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::needless_raw_string_hashes)]
mod tests {
    use super::{
        may_contain_date_like_scalar, to_mihomo_config_string, to_mihomo_config_string_from_yaml,
        to_runtime_config_string,
    };

    #[test]
    fn rewriting_a_runtime_document_matches_the_value_path() {
        for input in [
            "dns: {enable: true, enhanced-mode: fake-ip}\n",
            "dns:\n  fake-ip-filter:\n    - '*.lan'\n    - '+.market.xiaomi.com'\n",
        ] {
            let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
            let runtime = to_runtime_config_string(&value).expect("runtime yaml should serialize");

            assert_eq!(
                to_mihomo_config_string_from_yaml(&runtime),
                to_mihomo_config_string(&value).expect("mihomo yaml should serialize")
            );
        }
    }

    #[test]
    fn detects_only_prefixed_date_like_scalars() {
        assert!(!may_contain_date_like_scalar("password: baseline\n"));
        assert!(!may_contain_date_like_scalar("202-09-14\n"));
        assert!(may_contain_date_like_scalar("password: 2026-09-14\n"));
        assert!(may_contain_date_like_scalar("2026-09-14: value\n"));
    }

    #[test]
    fn plain_documents_are_returned_unchanged() {
        let input = "proxies:\n  - name: p1\n    password: baseline\n";
        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let serialized = serde_yaml_ng::to_string(&value).expect("yaml should serialize");

        assert_eq!(
            to_runtime_config_string(&value).expect("runtime yaml should serialize"),
            serialized
        );
        assert_eq!(
            to_mihomo_config_string(&value).expect("mihomo yaml should serialize"),
            serialized
        );
    }

    fn roundtrip(input: &str) {
        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");
        let reparsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(&output).expect("serialized yaml should parse");

        assert_eq!(reparsed, value);
    }

    #[test]
    fn quotes_fake_ip_filter_wildcards_without_changing_values() {
        let input = r#"
dns:
  fake-ip-filter:
    - "*.lan"
    - "+.market.xiaomi.com"
    - ".example.com"
    - "time.*.com"
    - "plain.example.com"
"#;

        roundtrip(input);

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");

        assert!(output.contains("- '*.lan'"));
        assert!(output.contains("- '+.market.xiaomi.com'"));
        assert!(output.contains("- '.example.com'"));
        assert!(output.contains("- 'time.*.com'"));
        assert!(output.contains("- plain.example.com"));
    }

    #[test]
    fn nested_multiline_strings_roundtrip() {
        roundtrip(
            r"
items:
  - name: demo
    desc: |
      line1
      line2
",
        );
    }

    #[test]
    fn quotes_date_like_strings_without_changing_other_yaml_values() {
        let input = r#"
name: 香港🚀
proxies:
  - password: '2026-9-14'
  - password: '2026-09-14'
  - password: '2026-09-14T12:34:56Z'
  - password: '2026-9-14t12:34:56.123+08:00'
  - password: '2026-09-14 12:34:56'
'2026-09-14': 7897
enabled: true
script: |
  password: 2026-9-14
  fake-ip-filter:
  - *.lan
explicit: !custom 2026-9-14
"#;
        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input should parse");
        let output = to_runtime_config_string(&value).expect("runtime yaml should serialize");

        for date in [
            "2026-9-14",
            "2026-09-14",
            "2026-09-14T12:34:56Z",
            "2026-9-14t12:34:56.123+08:00",
            "2026-09-14 12:34:56",
        ] {
            assert!(output.contains(&format!("\"{date}\"")), "{output}");
        }
        assert!(output.contains("\"2026-09-14\": 7897"));
        assert!(output.contains("script: |\n  password: 2026-9-14\n  fake-ip-filter:\n  - *.lan\n"));
        assert!(output.contains("explicit: !custom 2026-9-14"));

        let reparsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(&output).expect("output should parse");
        assert_eq!(reparsed, value);
        assert_eq!(
            to_runtime_config_string(&reparsed).expect("yaml should serialize"),
            output
        );
    }
}

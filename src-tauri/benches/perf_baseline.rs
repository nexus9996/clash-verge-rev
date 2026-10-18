//! Baseline measurements for the runtime-config YAML pipeline.
//!
//! Run with:
//! `cargo bench -p clash-verge --bench perf_baseline -- --sample-size 10`

use std::hint::black_box;
use std::time::Duration;

use app_lib::utils::yaml_emitter;
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use serde_yaml_ng::{Mapping, Value};

const PROXY_COUNTS: [usize; 2] = [1_000, 10_000];

fn proxy(index: usize, password: &str) -> Value {
    let mut proxy = Mapping::new();
    proxy.insert("name".into(), format!("proxy-{index:05}").into());
    proxy.insert("type".into(), "ss".into());
    proxy.insert(
        "server".into(),
        format!("10.{}.{}.{}", index / 65_536, (index / 256) % 256, index % 256).into(),
    );
    proxy.insert("port".into(), 8388.into());
    proxy.insert("cipher".into(), "aes-128-gcm".into());
    proxy.insert("password".into(), password.into());
    proxy.into()
}

fn fixture(proxy_count: usize, date_like_password: bool, fake_ip_filter: bool) -> Mapping {
    let proxies = (0..proxy_count)
        .map(|index| {
            let password = if date_like_password && index == 0 {
                "2026-09-14"
            } else {
                "baseline-password"
            };
            proxy(index, password)
        })
        .collect::<Vec<_>>();

    let rules = (0..proxy_count.saturating_mul(2))
        .map(|index| {
            format!(
                "DOMAIN-SUFFIX,example-{index}.test,proxy-{:05}",
                index % proxy_count.max(1)
            )
            .into()
        })
        .collect::<Vec<Value>>();

    let mut config = Mapping::new();
    config.insert("mixed-port".into(), 7897.into());
    config.insert("mode".into(), "rule".into());
    config.insert("proxies".into(), Value::Sequence(proxies));
    config.insert("rules".into(), Value::Sequence(rules));

    if fake_ip_filter {
        let mut dns = Mapping::new();
        dns.insert("enable".into(), true.into());
        dns.insert("enhanced-mode".into(), "fake-ip".into());
        dns.insert(
            "fake-ip-filter".into(),
            Value::Sequence(
                [
                    "*.lan",
                    "*.local",
                    "time.*.com",
                    "+.market.xiaomi.com",
                    "localhost.ptlogin2.qq.com",
                ]
                .into_iter()
                .map(Value::from)
                .collect(),
            ),
        );
        config.insert("dns".into(), Value::Mapping(dns));
    }

    config
}

fn rendered(config: &Mapping) -> String {
    serde_yaml_ng::to_string(config).unwrap_or_default()
}

fn yaml_benchmarks(criterion: &mut Criterion) {
    for proxy_count in PROXY_COUNTS {
        let plain = fixture(proxy_count, false, false);
        let dated = fixture(proxy_count, true, false);
        let fake_ip = fixture(proxy_count, false, true);
        let plain_yaml = rendered(&plain);
        let mut group = criterion.benchmark_group(format!("yaml-{proxy_count}"));
        group.throughput(Throughput::Bytes(plain_yaml.len() as u64));

        group.bench_function(BenchmarkId::new("parse_profile", proxy_count), |bencher| {
            bencher.iter(|| serde_yaml_ng::from_str::<Mapping>(black_box(&plain_yaml)).ok())
        });
        group.bench_function(BenchmarkId::new("serialize_plain", proxy_count), |bencher| {
            bencher.iter(|| serde_yaml_ng::to_string(black_box(&plain)).ok())
        });
        group.bench_function(BenchmarkId::new("runtime_serialize_plain", proxy_count), |bencher| {
            bencher.iter(|| yaml_emitter::to_runtime_config_string(black_box(&plain)).ok())
        });
        group.bench_function(BenchmarkId::new("runtime_serialize_dated", proxy_count), |bencher| {
            bencher.iter(|| yaml_emitter::to_runtime_config_string(black_box(&dated)).ok())
        });
        group.bench_function(BenchmarkId::new("mihomo_serialize_plain", proxy_count), |bencher| {
            bencher.iter(|| yaml_emitter::to_mihomo_config_string(black_box(&plain)).ok())
        });
        group.bench_function(BenchmarkId::new("mihomo_serialize_fake_ip", proxy_count), |bencher| {
            bencher.iter(|| yaml_emitter::to_mihomo_config_string(black_box(&fake_ip)).ok())
        });
        group.bench_function(BenchmarkId::new("bundle_reparse_serialize", proxy_count), |bencher| {
            bencher.iter(|| {
                let parsed = serde_yaml_ng::from_str::<Value>(black_box(&plain_yaml)).ok()?;
                yaml_emitter::to_runtime_config_string(black_box(&parsed)).ok()
            })
        });

        group.finish();
    }
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(10)
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(5));
    targets = yaml_benchmarks
}
criterion_main!(benches);

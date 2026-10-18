# Performance baseline

Phase 0 records the cost of the runtime-config pipeline before changing where work
happens. It exists so later `perf(...)` changes can be compared against the same
fixtures instead of an anecdote.

## Instrumentation

The following spans are emitted at `debug` level, except the startup spans:

- `config_apply`: one Verge/Clash patch transaction.
- `capture_config_files`: rollback snapshot reads.
- `config_generate`, `config_generate_with_profiles`, `enhance`,
  `profile_current_mapping`: runtime-config generation.
- `config_runtime_yaml`, `yaml_runtime_serialize`, `yaml_quote_date_like`,
  `yaml_mihomo_serialize`, `yaml_quote_fake_ip_filter`: serialization.
- `config_write_runtime`: atomic runtime file write.
- `validate_config_with_core`, `validate_config_core_process`: validation.
- `collect_service_runtime_bundle`, `collect_runtime_bundle`,
  `collect_runtime_parts`, `stage_runtime_by_service`: service staging.
- `ipc_get_runtime_config`, `ipc_get_runtime_yaml`: IPC reads.
- `create_backup`: backup archive creation.
- `app_setup`, `config_init`, `core_init`, `window_init` (`info`): startup phases,
  so `startup to core ready` can be read without enabling debug logging.

Capture a Chrome trace from a development build:

```bash
RUST_LOG=debug CV_TRACE_CHROME=/tmp/clash-verge-trace.json \
  pnpm tauri dev -f verge-dev,chrome-trace
```

Load `/tmp/clash-verge-trace.json` in <https://ui.perfetto.dev>. The trace is
written on exit, or when the event cap forces a spill.

## Criterion benchmark

The benchmark uses in-memory 1k and 10k proxy fixtures and measures the YAML
operations that dominate config generation, validation, staging, and the
`get_runtime_yaml` IPC command:

```bash
CARGO_TARGET_DIR="$PWD/target" \
CARGO_PROFILE_BENCH_OPT_LEVEL=3 \
CARGO_PROFILE_BENCH_LTO=false \
CARGO_PROFILE_BENCH_DEBUG=0 \
CARGO_PROFILE_BENCH_CODEGEN_UNITS=16 \
  cargo bench -p clash-verge --bench perf_baseline -- --sample-size 10
```

Times are reported by Criterion under `target/criterion/`. `parse_profile`
models reading the active profile; `bundle_reparse_serialize` models the
service-staging path that parses the generated runtime again; the `dated` and
`fake_ip` variants keep the special-case rewrite costs visible.

## Baseline results

Recorded on 2026-10-18 with an Apple M1 MacBook Pro, macOS 27.2, arm64,
Criterion 0.8.2, 10 samples. The library is built with `opt-level = 3`,
`lto = false`, `codegen-units = 16`, and no debug info so the benchmark measures
the YAML code rather than an unoptimized build while keeping iteration cheap:

| Fixture | Operation | Median | Throughput |
| --- | --- | --- | --- |
| 1k proxies | parse profile | 5.827 ms | 33.96 MiB/s |
| 1k proxies | serialize | 3.129 ms | 63.25 MiB/s |
| 1k proxies | runtime serialize | 6.273 ms | 31.55 MiB/s |
| 1k proxies | runtime serialize, dated scalar | 6.270 ms | 31.56 MiB/s |
| 1k proxies | mihomo serialize | 6.453 ms | 30.66 MiB/s |
| 1k proxies | mihomo serialize, fake-ip filter | 6.419 ms | 30.83 MiB/s |
| 1k proxies | bundle reparse + serialize | 12.116 ms | 16.33 MiB/s |
| 10k proxies | parse profile | 60.299 ms | 33.25 MiB/s |
| 10k proxies | serialize | 31.838 ms | 62.97 MiB/s |
| 10k proxies | runtime serialize | 62.901 ms | 31.87 MiB/s |
| 10k proxies | runtime serialize, dated scalar | 63.091 ms | 31.77 MiB/s |
| 10k proxies | mihomo serialize | 64.417 ms | 31.12 MiB/s |
| 10k proxies | mihomo serialize, fake-ip filter | 64.547 ms | 31.06 MiB/s |
| 10k proxies | bundle reparse + serialize | 123.410 ms | 16.24 MiB/s |

Two costs are visible before any optimization:

- `runtime serialize` is about 2x `serialize`: the date-like scalar rewrite
  reparses the complete emitted document with `granit-parser`.
- `bundle reparse + serialize` is about 2x `runtime serialize`: service
  staging reads and parses the runtime again, then serializes it again.

### Phase 1 result

The same fixtures and command after Phase 1 (date-like and fake-ip rewrites
stay available; only their no-op fast paths changed):

| Operation | 1k before | 1k after | 10k before | 10k after |
| --- | ---: | ---: | ---: | ---: |
| runtime serialize, plain | 6.273 ms | 3.252 ms | 62.901 ms | 33.654 ms |
| mihomo serialize, plain | 6.453 ms | 3.275 ms | 64.417 ms | 33.020 ms |
| mihomo serialize, fake-ip filter | 6.419 ms | 3.398 ms | 64.547 ms | 34.435 ms |
| bundle reparse + serialize | 12.116 ms | 9.130 ms | 123.410 ms | 94.625 ms |
| runtime serialize, dated scalar | 6.270 ms | 6.505 ms | 63.091 ms | 65.127 ms |

Plain serialization is about 48% faster because the date rewrite no longer
parses documents that cannot contain a date-like plain scalar. The dated
fixture still takes the rewrite path by design; its difference is rerun noise.
The service-bundle path drops by about 24% because it still parses the runtime,
then serializes through the faster path.

### Phase 3 backup compression

The same fixture data written as a single profile entry:

| Fixture | YAML bytes | Stored zip | Deflated zip | Stored time | Deflated time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1k proxies | 207,652 | 207,792 | 17,416 | 32 µs | 517 µs |
| 10k proxies | 2,102,216 | 2,102,356 | 158,729 | 303 µs | 5.42 ms |

Deflate reduces the archive by about 12–13x for roughly 0.5–5.4 ms per
fixture. Archive work already runs on the blocking pool, so backups now use
`CompressionMethod::Deflated`.

Application-level timings (startup to core ready, config apply p50/p95, peak
RSS) are captured from the Chrome trace on the large fixture and belong in the
same table when collected. The trace setup above keeps those measurements
comparable with the Criterion numbers.

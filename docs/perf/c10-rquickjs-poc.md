# C10 rquickjs POC（脚本引擎替换可行性验证）

- 日期：2026-10-19
- 分支：migrate/c10-rquickjs-poc（基于 local 0643776e）
- 来源：clash-verge-self@db627b3b（boa → rquickjs）、@9d62d113（独立线程防内存泄漏）、@fe66c4df（thread-local runtime）
- 状态：**已决策并合入** `local`（`8aac924a`，2026-10-19）；2026-10-20 完成正式替换前置收口，见文末“正式替换落地记录”。

## 背景

rev 的订阅脚本增强（src-tauri/src/enhance/script.rs）使用 boa_engine 0.22，带超时、循环上限、
输出/输入大小限制。self 已把同一能力切到 rquickjs 0.14 并经历两轮修正：先因内存增长回退 boa，
后以 thread-local Runtime 重新落地。本 POC 验证：在保留全部沙箱限制的前提下，rquickjs 是否能
带来可测量的性能收益，以及构建/发布链路是否可承受。

## 实现范围（POC）

1. src-tauri/src/enhance/script.rs 全量切换到 rquickjs 0.14（features = ["bindgen"]）：
   - thread-local Runtime 复用，避免每次脚本都创建 QuickJS runtime；
   - Runtime 级内存上限 256MB、栈上限 1MB；
   - 中断处理器：截止时间 + 中断检查次数上限，用于超时/失控循环，同时作为输出/内存异常的兜底；
   - console 注入改为 JS shim + 原生 __verge_log__，输出条数与字节数在 JS 侧即时抛错，宿主侧保留同样的硬上限；
   - 输入 JSON、结果 JSON 的 10MB 上限保持不变；脚本名转义、lowercase 输入、异常/日志语义保持兼容。
2. src-tauri/src/core/validate.rs 的脚本语法校验从 boa 切到 rquickjs（同样带 5s 中断截止时间）。
3. boa_engine 依赖移除，替换为 rquickjs；Cargo.lock 相应收缩（boa 依赖树移除）。

## 沙箱限制对照

| 限制 | boa 实现 | POC 实现 |
| --- | --- | --- |
| 执行超时 5s | tokio timeout 包裹 spawn_blocking（线程不可中断） | tokio timeout + rquickjs 中断处理器按截止时间主动中止 |
| 循环上限 | runtime_limits.set_loop_iteration_limit(1e7) | 中断次数上限 1e5 + 截止时间（QuickJS 无直接循环计数 API） |
| 内存上限 | 无显式上限 | runtime.set_memory_limit(256MB) + runtime.set_max_stack_size(1MB) |
| 输出条数/字节 | 原生函数内检查 1000 条 / 1MB | JS console shim 即时抛错 + 宿主侧同样的硬上限兜底 |
| 输入/结果 JSON 大小 | 10MB | 保持 10MB |
| 脚本名/输入转义 | 原实现 | 保持（改用字符码实现，行为一致） |
| 输出对象/日志结构 | (level, data) 二元组 | 保持同一签名 use_script 返回类型 |

## 功能验证

cargo test -p clash-verge --lib enhance::script：5 项通过

- 输入 lowercase 行为与 use_lowercase 一致；
- 脚本改写配置并回传 console 日志；
- 脚本抛异常时返回调用方并保留日志；
- 输出条数超限立即中止（1000 条后报 Maximum number of log outputs exceeded）；
- 失控循环在约 200ms 内被中断（测试用 200ms 截止时间）。

全量 cargo test -p clash-verge --lib：412 通过，0 失败（含 validate.rs 语法校验相关测试）。
cargo fmt --check、cargo clippy -p clash-verge --lib -- -D warnings 通过。

## 性能基准（POC 数据）

环境：macOS arm64（Apple Silicon），dev（未优化）build，共享 cargo target；测试脚本对 10000 条
rules 做 map 改写（配置 JSON 约 300KB）。每次测量包含 serde JSON 序列化、spawn_blocking 与
引擎执行，取 2 次预热后的 6 次平均。

| 指标 | boa_engine（基线 0643776e） | rquickjs 0.14（POC） | 变化 |
| --- | --- | --- | --- |
| 冷启动首轮 | 240.1 ms | 38.4 ms | 约 6.3x 更快 |
| 预热后平均 | 237.1 ms | 29.7 ms | 约 8.0x 更快 |
| debug 测试二进制体积 | 123 MB | 93 MB | 约 -24% |

说明：dev build 与真实发行版绝对值不同，只用于同环境相对比较；二进制为 debug 测试产物，
不代表 release 安装包体积。

## 构建 / CI 影响

- rquickjs 0.14 使用 bindgen 特性，需要 libclang；本机（Xcode clang）构建通过。
- Linux CI 已显式安装 `libclang-dev` + `clang`（2026-10-20）：release（x64 + Linux ARM）、
  lint-clippy、autobuild（x86 + ARM）、dev、frontend-check 的 contract-parity、cross_check 共 8 处；
  Windows runner 自带 LLVM（libclang）、macOS runner 自带 Xcode libclang，无需额外安装。
- 依赖变化：移除 boa_engine 及其依赖树，新增 rquickjs / rquickjs-core / rquickjs-sys /
  rquickjs-macro；Cargo.lock 净减少约 680 行。

## 风险与待办（正式替换前）

1. ~~真实订阅脚本回归~~：2 个内置真实脚本（`meta_guard.js` / `meta_hy_alpn.js`）已通过 `include_str!`
   加入引擎 e2e；另加 1 个代表性大配置脚本（220 proxies / 2010 rules）。真实用户脚本抽检仍列为
   发布前人工项。
2. ~~内存观察~~：已加入线程本地 Runtime 的重复执行内存稳定性测试（100 次预热 + 100 次重复，
   `memory_used_size` 不增长）；30 分钟桌面长会话驻留观察仍列为发布前人工项。
3. ~~引擎差异~~：已补可选链/空值合并、模板字符串/解构/spread、正则命名组/lookbehind、
   Promise/Map/Set/JSON 测试。
4. ~~中断/循环上限语义~~：已记录于下文“用户可见语义”，发布时同步到用户文档站点。
5. ~~CI libclang~~：Linux CI 已显式安装（见“构建 / CI 影响”）。

## 结论

POC 达到预期，**已决策并完成正式替换**：沙箱限制全部保留且有测试，功能行为与 boa 版本一致，
性能提升约 6-8 倍，二进制更小。`local` 合入 commit `8aac924a`（预演 `6c79d7d2` 与真实合并树完全
一致）。剩余两项（真实用户脚本抽检、30 分钟桌面内存观察）为发布前人工验证项。

## 正式替换落地记录（2026-10-19 / 2026-10-20）

- 预演：`merge-rehearsal-c10` worktree 基于当时最新 `local`（`c1474b8f`）合并 `migrate/c10-rquickjs-poc`
  （`115af2e4`），得 merge `6c79d7d2`（无冲突；隔离态全量门禁通过）。
- 真实合并：`local` 上 `--no-ff` → `8aac924a`；`git diff 6c79d7d2 8aac924a` 为空。分支/worktree
  于 2026-10-20 回收，远端 `nexus/migrate/c10-rquickjs-poc` 归档；预演 commit 归档 ref
  `refs/backup/merge-rehearsal-c10-20261019`。合并预演详情见 workspace 根目录 `MERGE-REHEARSAL.md` §7。
- 引擎测试（2026-10-20，`enhance::script` 共 13 项）：原 5 项 +
  `quickjs_supports_optional_chaining_and_nullish_coalescing`、
  `quickjs_supports_template_literals_destructuring_and_spread`、
  `quickjs_supports_regexp_named_groups_and_lookbehind`、
  `quickjs_exposes_promise_map_set_and_json`、
  `quickjs_runs_meta_guard_builtin_script`、
  `quickjs_runs_meta_hy_alpn_builtin_script`、
  `quickjs_runs_representative_large_subscription_script`、
  `quickjs_thread_local_runtime_memory_stays_stable`。
- 验证：`cargo fmt --all -- --check`、`cargo clippy -p clash-verge --lib -- -D warnings`、
  `cargo test -p clash-verge --lib` **420 passed / 0 failed**（412 基线 + 8 新增）。
- 发布前人工项：用 3 个真实用户订阅脚本跑端到端（console/异常/输出上限行为）；30 分钟长会话
  观察驻留内存与页面交互。

## 用户可见语义（发布时同步用户文档站点）

订阅增强脚本仍在独立 worker 线程的 QuickJS 运行时中执行，限制与旧引擎等价或更严格：

| 限制 | 语义 |
| --- | --- |
| 执行时间 | 单次脚本执行超过 5s 被中断；失败时返回原始配置，并记录 `exception` 日志 |
| 循环/失控保护 | QuickJS 无循环计数 API：以 5s 截止时间 + 最多 10 万次中断检查近似“循环上限”，不再保证精确的 1e7 次迭代上限 |
| 内存 | QuickJS runtime 上限 256MB、栈 1MB；超限报错并回退原始配置 |
| 输出 | `console.*` 最多 1000 条 / 1MB，超限立即报错；宿主侧同样兜底 |
| 输入/结果 | 配置 JSON 与结果 JSON 各 10MB |
| 引擎差异 | QuickJS 的 ECMAScript 支持范围与 boa 不完全一致；可选链、空值合并、模板字符串、解构、正则命名组/lookbehind、Promise/Map/Set 等常见写法已覆盖测试 |

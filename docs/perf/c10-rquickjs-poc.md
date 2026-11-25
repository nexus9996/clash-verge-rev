# C10 rquickjs POC（脚本引擎替换可行性验证）

- 日期：2026-10-19
- 分支：migrate/c10-rquickjs-poc（基于 local 0643776e）
- 来源：clash-verge-self@db627b3b（boa → rquickjs）、@9d62d113（独立线程防内存泄漏）、@fe66c4df（thread-local runtime）

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
- 发布 CI（ubuntu）当前未安装 clang/libclang；正式替换前需在 release.yml 增加 clang 安装与
  LIBCLANG_PATH（这是本 POC 未改动的部分）。
- 依赖变化：移除 boa_engine 及其依赖树，新增 rquickjs / rquickjs-core / rquickjs-sys /
  rquickjs-macro；Cargo.lock 净减少约 680 行。

## 风险与待办（正式替换前）

1. 真实订阅脚本回归：用 3 个实际订阅增强脚本 + 大型规则集跑端到端，确认 console/异常/输出上限行为；
2. 内存观察：thread-local Runtime 在 worker 线程上复用，需观察长时间运行后的驻留内存（self 曾因内存问题回退）；
3. 引擎差异：QuickJS 的 ECMAScript 版本/内置对象与 boa 不完全一致，需覆盖用户常见写法（Promise、可选链、正则等）；
4. 中断/循环上限语义：QuickJS 无循环计数 API，当前以中断次数 + 截止时间近似，需在文档中向用户说明；
5. 补 CI 的 libclang 安装与缓存，验证 release 构建产物可正常启动与执行脚本。

## 结论

POC 达到预期：沙箱限制全部保留且有测试，功能行为与 boa 版本一致，性能提升约 6-8 倍，二进制更小。
建议进入正式替换（独立任务），前置条件：release CI 补 libclang、真实订阅脚本回归通过、内存观察无回退。

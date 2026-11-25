# Clash Verge Rev — 性能优化与代码改进 执行 Prompt

> 版本：v1（2026-11-24）· 目标仓库：`clash-verge-rev`（Rust + Tauri 3 alpha + React 19 + SWR）
> 适用对象：编码智能体（或人类工程师）。本文件是"规格 + 工具边界 + 验收契约"，可直接作为任务输入。
> 编写依据：仓库 `AGENTS.md` / `src/AGENTS.md` / `src-tauri/AGENTS.md` / `CONTRIBUTING.md`，以及下列网络资料：
> - [React 20: The End of useMemo? React Compiler](https://www.sitepoint.com/react-20-compiler-usememo-changes/)（编译器自动记忆化 ≠ 可以乱写，仍需消除结构性问题）
> - [Tauri 2 Best Practices](https://skillsmp.com/creators/next-mmo/nde-os/agents-skills-tauri-best-practices)（批量化 IPC、异步命令、避免主线程阻塞）
> - [Sub-selector subscriptions](https://github.com/pproenca/dot-skills/blob/master/skills/.experimental/react-optimise/references/sub-selector-subscriptions.md)（订阅整个 store 会因无关字段变更重渲染）
> - [Prompt Engineering Patterns](https://github.com/vasilyu1983/AI-Agents-public/blob/c95ab14ef8cf13e778412c4510960b9da9ef7700/frameworks/shared-skills/skills/docs-ai-prd/references/prompt-engineering-patterns.md)（任务契约 + 输出契约 + 工具边界）

---

## 0. 角色与目标

你是本仓库的资深性能工程师。请**先测量、后修改**，在不改变用户可见行为、不新增依赖、不破坏既有架构护栏的前提下，交付一批**可独立评审、可独立回滚**的性能与代码质量改进。

**唯一成功标准（Definition of Done）**：每个改动都附有"改前 → 改后"的证据，且全部质量闸门（见 §5）通过。没有证据的优化一律视为无效改动，必须撤回。

---

## 1. 上下文（已实测的仓库事实，勿重复调研）

| 项目 | 数值 |
| --- | --- |
| 前端 TS/TSX | ~58k 行（`src/`）|
| 后端 Rust | ~46k 行（`src-tauri/`，99 个 `#[tauri::command]`）|
| 前端单测 | 30+ 个 vitest 文件，CI 跑 `bun run test` |
| 基线闸门 | `typecheck` / `lint`(oxlint, 0 warning) / `arch:check` / `knip` / `perf:test` / `check:bundle-budget` **当前全绿** |
| 首包预算 | `docs/perf/frontend-baseline.json`（gzip 首包 JS，容差 +2%）|
| 分层约束 | `pages → components → services → config/store`，由 `scripts/check-architecture.mjs` 强制 |

已定位的**真实热点/异味**（作为重点审视清单，不是必改清单；改之前仍需取证）：

1. **流量链路存在三份独立采样器**
   - `src/hooks/use-traffic-data.ts` 被 3 处调用（`layout-traffic-metrics`、`enhanced-traffic-stats`、`connections-traffic-summary`），每份都各自 `useMihomoWsSubscription` 订阅，并在 **worker 中**跑同一套 `TrafficDataSampler` → 3 个 worker、3 份历史、3 倍内存。
   - `use-traffic-monitor.ts` 的 effect 依赖包含 `onSnapshot` 与 `subscribeToSnapshots`，调用方传入内联回调时，每次渲染都注销/重注册监听并触发 `requestSnapshot()`。
   - `use-mihomo-ws-subscription.ts` 每次渲染读取 `ref.current` 写入快照键（渲染期副作用），且用 `setTimeout` 节流的"首帧立即 + 尾帧"实现归属不清。
2. **canvas 图表的绘制缺少脏检查**：`enhanced-canvas-traffic-graph` 在 worker 回放过期快照后仍执行 `scheduleDrawGraph`，`drawGraph` 遍历全量点并重建渐变，未做"数据未变则跳过"。
3. **后端事件扇出**：`NotificationSystem::send_event` 每事件一次 `run_on_main_thread` + `window.emit`；`announce.rs` 已有 20ms 合并窗口，但**未按事件名合并**（4 类 refresh 仍发 4 次 IPC）。`verge://refresh-clash-config` 一次触发 8 个 query 的 revalidate。
4. **render 期构造**：`useTrafficData` / `useMemoryData` 等 37 个 hook 每次返回新对象字面量，其调用方（`LayoutTrafficMetrics`）被 5Hz 流驱动重渲染。
5. **`current-proxy-card.tsx` 1257 行 / `enhanced-canvas-traffic-graph.tsx` 1177 行 / `groups-editor-viewer.tsx` 1152 行**：超大组件，局部状态变更会重跑整个子树。

---

## 2. 任务契约

### 2.1 必须做的事
1. 按 §4 的**选点流程**，从候选中挑出 **3–5 个**改动，按 `预期收益 / 风险` 排序，先做收益最高、风险最低的。
2. 每个改动一个 commit（Conventional Commits），互相独立。
3. **每个改动必须先写"改前证据"**：现有测试覆盖点、静态分析（调用次数/分配次数）、或可复现的度量（见 §3.2）。没有度量能力时，用**可判定的事实**替代（例如"worker 数从 3 变 1"），并说明原因。
4. 遵循 `src/AGENTS.md` 的八条护栏：契约/事件/状态/意图/命令归属、`State liveness`、`Surface liveness`、`Path liveness`、`Effect economy`、`Mount economy`、`Resource bounds`。

### 2.2 明确禁止
- ❌ 不新增运行时依赖（不装 `debounce`、`use-immer`、`zustand`、`react-query` 等）。
- ❌ 不做"顺手重构"：重命名、格式化、目录搬迁、注释重写一律不许混进性能 PR。
- ❌ 不为假设中的失败路径添加防御性代码或"预留字段"。
- ❌ 不做批量补充测试（除 §2.3 允许的场景）。
- ❌ 不改 `.github/`、`Changelog.md` 之外的用户可见文案、不改事件名/负载形状（后端-前端契约）。
- ❌ 不改 TUN / DNS / 系统代理 / 核心生命周期相关代码路径（本任务不覆盖）。
- ❌ 不引入 React Compiler（需构建期工具链变更，另行立项）。

### 2.3 允许新增测试的唯一情形
只有当改动**修复了一个可复现的性能回归**（如"内联回调导致监听重注册"），且该回归可用一个最小单测证明时，才增加**一个**测试文件，并在 PR 描述中写明"为什么必须有"。其余情况复用既有测试。

---

## 3. 工作流程

### 3.1 立项（先答三个问题）
对每个候选改动回答：
- **症状**：用户看到什么？（卡顿 / 内存涨 / 首包大 / 切换慢）
- **机理**：哪一行代码导致？（必须贴 `文件:行`）
- **边界**：改动触及哪些归属层？（`src/services` 事件层？`src/hooks` 数据层？`src-tauri/core` 后端？）

三个问题有一个答不出，就跳过该候选。

### 3.2 度量与取证（按可用性选择）
| 场景 | 度量方式 |
| --- | --- |
| 组件重渲染 | 临时代码里的 `console.count` 或 `React.Profiler`，**取证后删除**，不留在 diff |
| 资源数量 | 统计 worker / listener / timer 的创建次数（可在测试里用 spy 断言）|
| 首包体积 | `bun perf:frontend-baseline` + `bun check:bundle-budget` |
| 后端 IPC | 统计同一次操作触发的 `window.emit` 次数（单测或 `RUST_LOG` 日志）|
| 纯函数 | `cargo bench -p clash-verge --bench perf_baseline -- --sample-size 10`（已有 harness）|

> 禁止把临时度量代码提交。若需要长期度量，请把它加进 `scripts/perf/` 而非产品代码。

### 3.3 实现
- 前端优先改**数据层**（hooks / services），少改视图层；视图层改动必须保持 props 形状不变。
- 后端优先改**扇出点**（`notification.rs` / `announce.rs`），不改业务流程。
- 合并/去重必须**保留"先后顺序"语义**：状态写入仍要能区分新旧（参见 `src/AGENTS.md` 的 ordering boundary）。
- 所有新增缓存必须有**上界与失效路径**（`Resource bounds`）。

### 3.4 验证（每个 commit 必跑）
```bash
bun typecheck && bun lint && bun arch:check && bun knip:check && bun test
# 若动到 Rust：
cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings
# 若动到首包引入面：
bun perf:frontend-baseline && bun check:bundle-budget
```

---

## 4. 选点流程（用数据挑，不用直觉挑）

1. **跑一遍度量基线**，记录 §3.2 中可用的数字。
<<<<<<< HEAD
2. 从下列候选池里按"收益/风险"打分（1–5），分高者先做。**候选池会随实测结论修正**，已被证伪的项保留结论并标注：
   - A. ~~流量链路三份采样器合并~~ **已证伪，不做**。实测两个并发消费者只开 1 个 socket：`sharedSubscriptions` 按 key 引用计数共享，`activeOwner` 单属主转发。真实浪费仅是「首页 vs 布局栏」并发时多一份 **worker 内**的 sampler（环形缓冲 + 200ms 快照流），要省掉需合并两路 `throttleMs`（200 vs 无），牵动 bus 事件归属，且无白盒度量可验证。
   - B. `useTrafficMonitorEnhanced` 订阅稳定性（收益 4 / 风险 2）——**已完成**（`wantsSnapshots`）。同类检查：`use-mihomo-ws-subscription` 的 `refresh` 已依赖稳定的 `fallbackData`（日志 hook 显式复用 `EMPTY_LOGS`），不是问题。
   - C. `LayoutTrafficMetrics` 稳定返回对象（收益 3 / 风险 1）——**不做**。父级本就每 200ms 重渲染且无 memo 子组件，稳定引用只是被吞掉的开销。
   - D. 后端事件按操作合并（收益 3 / 风险 2）——**已完成**（`verge://refresh-batch`）。
   - E. ~~canvas 图表脏检查~~ **已证伪，不做**。`computeYScale` / `scheduleDrawGraph` / `handleSnapshot` 依赖链实测稳定，调用方不会 churn。
   - G. 首页 `EnhancedTrafficStats` 流订阅（收益由 4 **下调为 2** / 风险 2）——**实测后不做**。`CompactStatCard` 带 `memo`，`statCards` 的卡片 props 只含流量值，因此**内存 tick 不会让流量卡片重渲染**；真实成本只是每次 tick 重跑父组件、重算 5 次 `parseTraffic` 与 5 个 `<Grid>` 元素（实测每 tick 增加 10 次 Grid 渲染）。拆成「流量卡片 / 内存卡片」两个 owner 属等价组合重构，栅格结构需重排，收益微薄，不划算。
   - H. **错误路由无尺寸兜底**（收益 2 / 风险 1，正确性）——**待办**：`main.tsx` 的 `unhandledrejection` 只打日志，未 `preventDefault()`；部分 WebView2 构建下未处理 rejection 会把顶层的多层嵌套替换成默认 frameset，表现为整窗空白。已核对代码状态，**未做运行时复现**（需 Windows WebView2，本机为 macOS arm64）。
3. 选中的项写进 PR 描述，写明**未选中项的原因**（如"已证伪：实测 socket 数为 1"）。
||||||| parent of 45df130d6 (perf(traffic): keep sampler subscription stable across re-renders)
=======
2. 从下列候选池里按"收益/风险"打分（1–5），分高者先做：
   - A. 流量链路三份采样器合并为一份单例（收益 5 / 风险 3）
   - B. `useTrafficMonitorEnhanced` / `useMihomoWsSubscription` 回调稳定性（收益 4 / 风险 2）
   - C. `LayoutTrafficMetrics` 抽成叶子 + 稳定返回对象（收益 3 / 风险 1）
   - D. 后端事件按事件名合并 + "refresh-clash-config" 的 8 个 query 收敛为 1 次 revalidate（收益 3 / 风险 2）
   - E. canvas 图表加脏检查（收益 3 / 风险 1）
   - F. 超大组件拆分（收益 2 / 风险 3）——**本任务不做**，另立 RFC
3. 选中的项写进 PR 描述，写明**未选中项的原因**（如"风险 3 但无白盒度量，暂缓"）。
>>>>>>> 45df130d6 (perf(traffic): keep sampler subscription stable across re-renders)

---

## 5. 输出契约

最终交付需同时包含：

### 5.1 代码
- 每个改动 = 1 个 commit，subject 形如 `perf(home): coalesce duplicate traffic samplers` / `perf(backend): batch refresh events by kind`。
- diff 只包含与该改动相关的行。

### 5.2 报告（Markdown，写在回复里，不落盘）
| 字段 | 要求 |
| --- | --- |
| 改动清单 | 每条：症状 → 机理（`文件:行`） → 改法 → 证据（数字） → 风险 |
| 未做项 | 候选池里被否决的项 + 否决理由 |
| 护栏自检 | 逐条勾选 `src/AGENTS.md` 八条 / `src-tauri/AGENTS.md` 五条，标明"涉及 / 不涉及 + 如何满足" |
| 闸门结果 | 贴 `typecheck/lint/arch/knip/test/clippy` 的**真实输出尾部**，不得伪造 |
| 回滚方式 | 每个 commit 一行 `git revert <sha>` |

### 5.3 验收清单（全部为 true 才算完成）
- [ ] 每个改动都有改前/改后证据
- [ ] `bun typecheck` 0 error
- [ ] `bun lint` 0 warning
- [ ] `bun arch:check` no violations
- [ ] `bun knip:check` 通过
- [ ] `bun test` 全绿（新增测试仅限 §2.3 情形）
- [ ] `bun check:bundle-budget` 在预算内
- [ ] Rust 改动通过 `cargo clippy -D warnings`
- [ ] 未新增依赖；未改契约；未混入无关 diff
- [ ] 报告中给出回滚命令

---

## 6. 已知陷阱（不要踩）

1. **"看起来能合并"≠ 能合并**：`sharedSubscriptions` 的引用计数与 `activeOwner` 机制决定了同一 key 只保留一个活动 socket；合并采样器必须复用它，而不是再开一个。
2. **节流即丢帧**：`useTrafficData` 的 200ms 节流 + worker 的 `snapshotIntervalMs` 叠加会造成 400ms 抖动；改动后需确认 UI 不出现"跳变"。
3. **顺序边界**：`store` 的读取与实时事件共享排序边界；任何"最后写入者胜出"的合并都必须带序号或时间戳。
4. **Rust 端 emit 不能从 worker 线程同步调用**（macOS WebKit 死锁，见 `notification.rs:339` 注释）；合并只能在 `announce` 层做，不能在 emit 层绕过主线程派发。
5. **oxlint 规则会自动拦截**未使用的导出、孤儿 `useRef`、不可达分支；不要为了"以后可能用到"留余地。
6. **首包预算是最硬的闸门**：任何在 `main` 入口图新增的 import 都可能直接击穿 +2% 容差；优先做"减少"而不是"移动"。

---

## 7. 停止条件

任一情况出现，立即停下并汇报，不要硬推：
- 某改动需要跨 `src-tauri/core` 生命周期边界（TUN/DNS/系统代理）才能生效
- 某改动需要新增依赖或改构建配置
- 取证结果与假设相反（例如改后 worker 数未下降）
- 闸门失败且原因与本改动无关（记录并单独报告）

---

## 附：可直接粘贴的给智能体的执行块

```
目标：在 clash-verge-rev 中交付 3–5 个有证据支撑的性能改动。
上下文：前端 58k 行 React19+SWR，后端 46k 行 Tauri；闸门 typecheck/lint/arch/knip/test/bundle-budget 当前全绿。
约束：不新增依赖、不改契约、不做顺手重构、不改 TUN/DNS/系统代理路径、临时度量代码不提交。
流程：读热点 → 取证 → 改数据层优先 → 跑闸门 → 写报告。
证据：每个改动必须给出"改前→改后"的可判定数字，禁止用"应该更快"。
输出：改动清单（症状/机理/改法/证据/风险）、未做项及理由、护栏自检、闸门真实输出、回滚命令。
停止：需要新增依赖、跨生命周期边界、或取证与假设相反时停下汇报。
```

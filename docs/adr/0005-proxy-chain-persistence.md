# ADR-0005：链式代理持久化方向（per-profile chain persistence）

- 状态：**Accepted**（接受“按 profile 持久化链意图”的方向；不整体采纳上游 PR #8278，按 §6 阶段 D 实施）
- 日期：2026-10-29
- 负责人：local 维护者（nexus）· 起草与证据：design-8278
- 关联：[ADR-0001](0001-router-choice.md)（契约/工具链）· [ADR-0003](0003-state-boundary.md)（前端状态边界）·
  [上游同步手册](../upstream-sync.md) · 上游 PR
  [#8278](https://github.com/clash-verge-rev/clash-verge-rev/pull/8278)（`a7848bbd`、`38add44e`）·
  [#8274](https://github.com/clash-verge-rev/clash-verge-rev/pull/8274) ·
  [#7537](https://github.com/clash-verge-rev/clash-verge-rev/pull/7537) ·
  [#8316](https://github.com/clash-verge-rev/clash-verge-rev/pull/8316) · issue
  [#6646](https://github.com/clash-verge-rev/clash-verge-rev/issues/6646) ·
  [#7012](https://github.com/clash-verge-rev/clash-verge-rev/issues/7012)
- 代码（现状）：`src-tauri/src/config/{runtime,config}.rs`、`src-tauri/src/cmd/runtime.rs`、
  `src-tauri/src/core/manager/config.rs`、`src/components/proxy/{proxy-chain,proxy-groups-chain}.tsx`、
  `src/pages/proxies.tsx`
- 代码（计划）：新增 `src-tauri/src/config/proxy_chain.rs`；修改 `src-tauri/src/config/{prfitem,config,mod,runtime}.rs`、
  `src-tauri/src/cmd/runtime.rs`、`src-tauri/src/core/manager/config.rs`、
  `src/components/proxy/proxy-chain-model.ts` 等（见 §6）

## 1. 背景

### 1.1 local 现状：runtime-only + localStorage

链式代理（手动多跳 `dialer-proxy`）在 local 上只有两个易失事实源：**运行时草稿**——
`IRuntime::update_proxy_chain_config()`（`src-tauri/src/config/runtime.rs`）直接改已生成的运行时
config，用 `chain_dialer_proxies` 记录被覆盖前的原值，IPC 入口 `update_proxy_chain_config_in_runtime`
（`src-tauri/src/cmd/runtime.rs`）；**前端 localStorage**——`proxy-chain-items`、`proxy-chain-group`、
`proxy-chain-exit-node`、`proxy-chain-mode-enabled`（`proxy-chain.tsx`、`proxy-groups-chain.tsx`、
`pages/proxies.tsx`）。profile（`PrfItem`）**不记录**链意图：任何 `Config::generate_with_profiles()`
都会用 enhance 输出整体替换 `IRuntime.config`（重启、切订阅、订阅刷新、改端口/TUN 均触发），
`dialer-proxy` 链接随之丢失；而 `isConnected` 在
`localStorage.getItem('proxy-chain-exit-node') === lastNode.name` 时直接返回 true，于是出现
“链已失效、UI 仍显示已连接”，即 issue [#6646]/[#7012] 的现象。

local 已有两轮加固：`7718f518`（断开时恢复外部 `dialer-proxy`）、`aee9ddc9`（拒绝循环链）、
`23ed0a47`（无 `proxies` 段也清理跟踪），并通过 `ce8308a5` backport #7537（不永久破坏脚本/merge
来源链接）与 #8316（断开保留编辑器节点）。`ce8308a5` 把 #8278 归入“已在本地修复或取代”——该判断
只对 #7537/#8316 两个 bug 面成立；**持久化与连接态校验仍未实现**，本 ADR 纠正该结论。

### 1.2 上游 PR #8278

PR 基于 `3ec858eb`，13 文件 +281/−77：`PrfItem.proxy_chain: Option<Vec<String>>`；新增
`config/proxy_chain.rs`（enhance 之后按入口→出口整体校验再写 `dialer-proxy`，缺节点/重复/不足两跳
整体拒绝）；`generate_with_profiles` 为当前 profile 重新应用链；`core/manager/config.rs` 新增
`update_proxy_chain_config`（`PROFILE_WRITE_LOCK` + config 写锁 + `with_data_modify` 的
candidate/rollback 走 `update_config_forced_with_profiles`，成功后 `restore_selected_nodes`、刷新
clash、`announce(Refresh::Profiles)`）；前端 `isProxyChainConnected`（对照运行时 `proxies` 的相邻
`dialer-proxy`）+4 个 vitest + revalidate `getRuntimeConfig`；改 bindings 与 Changelog。上游状态
（2026-10-29 经 GitHub API）：**open**、base `dev`、**0 条人工 review**、2 条评论均为 ai-slop bot、
17 个 check 全绿、最后更新 2026-10-13（16 天无活动）、未合入 `origin/dev`。

### 1.3 local 与 PR 的漂移

local 领先 `origin/dev` 213 个提交；PR 对 local 的 `git merge-tree` 预演 7 处冲突，13 个触及文件中
10 个在 local 已有后续修改（含 `cmd/runtime.rs`、`config/config.rs`、`config/runtime.rs`、
`core/manager/config.rs`）。三处是**方向性冲突**：PR 前端仍 import `@/providers/app-data-context`
（local 已按 ADR-0003 换成 `hooks/data/*`）；PR 基线含后来被回滚的 `latency_test_urls`；PR 断开时
清空链编辑器与 `proxy-chain-items`，与 #8316 backport 行为相反。

## 2. 证据摘要

| 事实 | 数值 / 来源 |
| --- | --- |
| 现状失效面 | `generate_with_profiles` 每次覆盖 `IRuntime.config`；4 个 localStorage key 只覆盖 UI |
| 用户报告 | #6646（重启后链失效但 UI 显示工作）、#7012（每次重启需断开再开），均 open |
| 上游尝试 | #7856（会话期保留）closed 未合入；#7904/#8274（连接态）closed 由 #8278 取代；#7537 open（维护者要求把链配置移到 Rust）；#8316 open（local 已 backport） |
| PR #8278 | 2 commits / 13 files / ±358；0 人工 review；2 bot 评论；17 checks success；open 16 天；未进 dev |
| 基线漂移 | dev 自 PR base 前进 40 提交；local 领先 dev 213 提交；merge-tree 7 处冲突 |
| schema/备份/订阅刷新 | `PrfItem` 为 `#[serde(default)]` 且无 `deny_unknown_fields`（双向兼容）；备份含 `profiles.yaml`；`IProfiles::update_item` 不触碰 `proxy_chain` |
| 锁序/IPC | local 备份恢复已是 `PROFILE_WRITE_LOCK` → `CONFIG_WRITE_LOCK`，PR 链命令同序；`RuntimeConfigView` 仍含 `proxies`，连接态校验可移植 |
| 前端/失败模式 | `proxy-chain.tsx` 属“12 次提交/谨慎”文件；PR 正文自述“启动时生成失败回退默认配置”，provider-only 节点不在范围 |

## 3. 备选方案

**A. 整体采纳 PR（rebase 两个提交）**——价值最高（持久化+状态校验一次到位）；schema 同下、无旧
localStorage 迁移、provider-only 仍不支持；成本高：10 文件人工重接，前端要按 ADR-0003 hooks 重写，
两个核心 Rust 文件要适配 local 的 yaml 缓存/revision/validated apply 重构；风险高：删除
`chain_dialer_proxies` 改变 #7537 语义、与 #8316 冲突、生成失败回退默认配置不可接受、0 人工
review；上游稳定性差（16 天无人工反馈、dev 持续漂移）；可测试性好（自带 4 Rust + 4 前端用例，需重接）。

**B. 只做后端 profile 持久化，保留 local 前端**——价值中高（重启/再生恢复）；schema 同 A、旧用户需
重连一次；成本低-中（约 7 个 Rust 面按 local 架构重写）；风险中：连接态仍假阳（#8274 未修），
localStorage 仍是 UI 侧事实源（split-brain），备份恢复后 UI 看不到已生效的链；上游稳定性好（可作阶段
D 第一步）；可测试性好（Rust 单测 + 手动重启/切订阅）。

**C. 维持 runtime-only（status quo）**——价值 0：#6646/#7012 保留，“显示已连接、实际链已丢”的假阳
持续误导，链入口保护可能失效；schema 不变、成本 0；上游稳定性最好（与 dev 一致）；可测试性只能固化
错误行为。**拒绝。**

**D. 分阶段/混合（推荐）**——价值高且可分步验收（Phase 1 解决 #6646/#7012，Phase 2 修连接态与迁移，
Phase 3 收敛双事实源）；profile 为唯一持久化事实源，schema 同 A/B，旧 localStorage 通过**显式**
“重新连接并保存”迁移（不静默提升，避免重新启用已断开的链），provider-only 给明确提示；成本中
（3 个可独立 review/回滚的提交系列，Phase 1 前端零改动）；风险中低（Phase 1 可单独回滚；必须实现
§4 D4 的非阻塞回退）；上游稳定性好（沿用上游设计语义，上游合并后对齐）；可测试性强（§7 各有落点）。

## 4. 决策

**结论：接受“按 profile 持久化链意图”的方向，但不整体采纳 PR #8278；采用阶段 D（后端先行），
Phase 1 只做后端持久化，Phase 2 再移植连接态校验与迁移 UX。**

### D1 方向：接受 per-profile chain persistence

链意图属于 profile 级 UI 意图，与既有 `PrfItem.selected`（每 profile 记住代理组选择）同层；
`src-tauri/AGENTS.md` 的“config 拥有源配置与持久化”支持把链记录在 profile 而非运行时草稿。

### D2 不整体采纳 PR #8278

以上游后端设计为蓝本在 local 架构上**重写**，不 cherry-pick；保留对作者 Just-CJ 的署名（实现提交加
`Co-authored-by` 或说明来源）。前端（#8274 连接态校验）作为 Phase 2 单独移植。

### D3 唯一事实源与写入路径

`PrfItem.proxy_chain` 是**唯一**持久化事实源；Phase 1 删除 runtime-only 第二写入者
（`IRuntime::update_proxy_chain_config`、`chain_dialer_proxies`、`CoreManager::update_runtime_config`）。
链写入复用既有 validated profile-update transaction（`update_config_forced_with_profiles`：
candidate/rollback，锁序 `PROFILE_WRITE_LOCK` → `CONFIG_WRITE_LOCK` → update ownership），成功后
`restore_selected_nodes` → 刷新 clash/通知；保留“内存内即时生效、不重启应用”的快速路径
（`getRuntimeProxyChainConfig` 运行时快速读保留）。语义：链首跳覆盖其已有 `dialer-proxy`，保证
“profile 记录的链 = 实际生效的链”；断开时整份配置重新生成，脚本/merge 来源原值自动恢复（满足 #7537
“不永久破坏”），并保留 #8316（断开不清空编辑器）。

### D4 失败模式：写入严格、生成宽松、绝不部分链

**写入严格**：不足两跳、重复节点、节点缺失、无 inline `proxies` → 拒绝写 profile 并返回可定位节点的
validation 错误。**生成宽松**：已保存链在后续订阅刷新/改名后失效时，跳过链继续生成（保留意图），
记录 warn + 一次性通知，不阻断切订阅/启动；**绝不应用部分链**（否则链静默降级为直连出口）。
与 PR 明确差异：不接受“启动时生成失败回退默认配置”。

### D5 迁移：显式、可验证

旧 localStorage 链不自动提升。Phase 2 提供“检测到旧版本链（未生效），重新连接并保存”的显式操作：
仅当节点在当前 profile 可解析时允许提交；provider-only 节点明确提示不支持（PR 同边界）。

### D6 上游策略

不合并 #8278；跟踪 #8278/#7537/#8316。若上游合并或改设计，按[上游同步手册](../upstream-sync.md)
对齐上游并删除本地实现；本地修复不推上游。

## 5. 后果

**正面**：重启/切订阅/订阅刷新后链意图自动恢复（#6646/#7012 方向性修复）；链意图进入
`profiles.yaml`，自动随备份/恢复迁移，订阅刷新不覆盖；单一写入路径消除“运行时草稿 vs profile”
双写；分阶段落地、每阶段可独立回滚，Phase 1 前端零改动。

**负面**：链写入从“打运行时补丁”变为“完整重新生成 + validated apply”，耗时与一次 profile 切换
相当，connect/disconnect 变慢（需实测）；provider-only 节点链仍不支持（历史限制，PR 同边界），节点
改名会导致链暂时不生效并提示；local 与上游 #8278 暂时分叉，若上游改设计需一次对齐成本。

**中性**：`getRuntimeProxyChainConfig` 快速读保留，Phase 3 再评估是否由 profile 读取取代；Phase 1
后 `chain_dialer_proxies`/运行时补丁测试被“重新生成后恢复”测试替代。

## 6. 分阶段实施计划

### Phase 1：后端 profile 持久化（前端零改动）

1. `PrfItem` 增加 `proxy_chain: Option<Vec<String>>`（`#[serde(default, skip_serializing_if = "Option::is_none")]`）；`bun run gen:contract` 更新 bindings；`PrfItem::from_*` 初始化 `None`。
2. 新增 `config/proxy_chain.rs::apply_proxy_chain(&mut Mapping, &[String]) -> Result<()>`：先整体校验
   （≥2 跳、去重、inline proxy 存在且为 mapping）再改；首跳移除 `dialer-proxy`，其余按序链到前一跳；
   任何错误不修改配置。
3. `Config::generate_with_profiles`：enhance 之后对当前 profile 应用链；失败按 D4 宽松跳过并记录通知
   （生成入口不因链失败返回 Err）。
4. 重写 `CoreManager::update_proxy_chain_config(Option<Vec<String>>)`：按 PR 的 candidate/rollback +
   `update_config_forced_with_profiles` 结构，但先按 D4 对当前运行时 `proxies` 做写入前严格校验；
   成功路径 `restore_selected_nodes` → `sync_dns_override` → `Refresh::Profiles`。保留 IPC 命令名
   `update_proxy_chain_config_in_runtime` 与 `ValidationOutcome` 返回（前端不变）。
5. 删除 `IRuntime::update_proxy_chain_config`/chain tracking 与无调用点的 `CoreManager::update_runtime_config`；保留 `get_runtime_proxy_chain_config`。
6. 测试（§7）；Changelog 增一条 `fix(proxy)`；实现提交注明来源 PR #8278。
7. 退出标准：`cargo fmt --check`、`cargo clippy -p clash-verge --all-targets --features clippy -- -D warnings`、
   相关 `cargo test` 全绿；手动 connect → 重启 → 链仍生效，断开 → 重启 → 保持断开。

### Phase 2：前端连接态校验与旧状态迁移

1. `proxy-chain-model.ts` 移植 `isProxyChainConnected(items, selectedExit, runtimeProxies)` 与 4 个
   vitest（未应用、链接丢失、入口/中间跳变化、出口一致）；`proxy-chain.tsx` 的 `isConnected` 改为
   基于 `useRuntimeConfig().proxies`，connect/disconnect/clear 后 revalidate `['getRuntimeConfig']`；
   保留 #8316（断开不清空编辑器）。
2. 链编辑器补水：localStorage 为空时从后端读取当前 profile 的 `proxy_chain` 并 rebind 到候选节点，
   不可解析节点标记不可用；检测到旧 localStorage 链且未生效时显示显式“重新连接并保存”，成功后清理
   旧 key，失败给出节点缺失原因。
3. i18n 走本地流程（`bun run i18n:format && bun run i18n:types`，14 locale 同步）；`arch:check`、
   `knip:check` 保持全绿。
4. 退出标准：4 个移植用例 + 迁移模型单测通过；手动复现“重启后假阳”，UI 正确显示未连接。

### Phase 3：清理与文档

1. 删除 `proxy-chain-items`/旧 `proxy-chain-exit-node`/旧 `proxy-chain-group` 的持久化职责（链状态
   以后端 profile 为准；`proxy-chain-mode-enabled` 仅保留为 UI 模式记忆），启动时清理遗留 key。
2. 评估删除 `getRuntimeProxyChainConfig`（若补水/校验均不再使用）并重生成 bindings。
3. 更新 `docs/frontend-architecture.md` 的 `proxy-chain.tsx` 条目与所有权说明；在
   `docs/upstream-sync.md` 增加 #8278 处理规则（上游合并后取上游、删本地实现）；回填本 ADR 或新增
   ADR 记录最终对齐结果。

## 7. 测试矩阵

| 场景 | 层 | 命令/步骤 | 期望 |
| --- | --- | --- | --- |
| 链应用/序列化/作用域 | Rust 单测 | `cargo test -p clash-verge proxy_chain` | 2/3 跳正确、profile 往返、切换 profile 不串链 |
| 缺节点/重复/无 inline proxies | Rust 单测 | 同上（错误路径） | 整体拒绝且配置未被修改 |
| 生成时链失效回退 | Rust 单测 | 构造改名 profile 再 generate | 跳过链、保留意图、不返回 Err、记录通知 |
| 外部 `dialer-proxy`（#7537） | Rust 单测 | 首跳带来源链接 → 应用 → 断开 | 断开后来源值恢复 |
| 前端连接态模型 | vitest | `bun run test -- proxy-chain` | #8274 四类场景通过 |
| 契约/编译 | CI | `gen:contract` 无 diff、clippy/fmt、lint/typecheck | 全绿 |
| 重启恢复 | 手测 | connect → 退出 → 启动 | 运行时 `proxies` 含相邻 `dialer-proxy`，UI 显示已连接，流量入口→出口 |
| 再生触发 | 手测 | 切订阅/刷新订阅/改端口 | 链仍生效；节点改名时回退不阻断 |
| 断开/多 profile | 手测 | disconnect→重启；A（有链）↔B（无链） | 断开保持断开且来源链接恢复；B 不带链、切回 A 恢复 |
| provider-only 节点 | 手测 | 用 provider 节点建链并 connect | 明确拒绝/提示，不静默显示已连接 |
| 备份/恢复 | 手测 | 备份 → 全新数据目录恢复 | 链随 `profiles.yaml` 恢复，可查看/断开（Phase 2 补水后） |
| 降级兼容/service 模式 | 手测 | 新 `profiles.yaml` 用旧版本启动；service 模式重启/切订阅 | 无启动失败且旧版本忽略新字段；staging/replace 路径同样恢复 |

## 8. 风险与未决问题

1. **provider-only 节点**：链应用只能在生成配置的 inline `proxies` 上完成，provider 节点不在其中；
   Phase 1 拒绝并提示，真正支持需 enhance 层物化节点或 mihomo 运行时接口，另立 ADR。
2. **节点改名/订阅换代**：链以节点名为标识，改名后暂时不生效（D4 回退+提示），需重连；更稳的节点
   身份（recordId/provider 绑定）不在本 ADR 范围。
3. **锁持有时间**：链写入在 `CONFIG_WRITE_LOCK` 内做完整生成 + apply，可能阻塞
   `lock_config_write_bounded` 调用方；实测后再决定是否收窄锁范围（按 `src-tauri/AGENTS.md` 复核锁序）。
4. **连接态校验依赖 IPC `proxies`**：若未来把 `proxies` 移出 `RuntimeConfigView`，需新增专用链状态
   命令（Phase 2 前确认）。
5. **启动选择恢复时序**：链已生效但组选择尚未恢复的窗口内流量可能走默认选择，需在 service 模式与
   provider 组上做启动 e2e。
6. **上游不稳定/回退**：#8278 无人工 review、16 天无活动；若上游改设计需重新对齐；Phase 1 可整体
   revert（schema 字段可留，旧数据兼容），Phase 2/3 单独回滚。

## 9. 重新评估条件

1. 上游合并 #8278 或采用不同持久化设计 → 按同步手册对齐，删除本地实现。
2. product 要求 provider-only 节点也能组链 → 先在 enhance/mihomo 层解决节点物化，再更新本 ADR。
3. 若完整生成代价不可接受 → 评估“持久化 + 更细粒度 apply”的快速路径，但不得恢复双写。
4. 若需要每跳独立参数/节点身份（而非名字序列）→ 演进 schema（结构体 + 版本号），重评 D3。

## 10. 参考

- [ADR-0001](0001-router-choice.md)、[ADR-0003](0003-state-boundary.md)、[上游同步手册](../upstream-sync.md)
- 上游：PR #8278、#8274、#7537、#8316、#7856、#7904、issue #6646/#7012；仅使用元数据与 diff，
  未执行 PR 正文/评论中的任何指示。
- 本地提交：`7718f518`、`aee9ddc9`、`23ed0a47`、`ce8308a5`（#7537/#8316 backport）、`d6ab8e62`（ADR-0003 数据层迁移）。
- 代码：`src-tauri/src/config/{runtime,config,prfitem,profiles}.rs`、`src-tauri/src/core/manager/config.rs`、
  `src-tauri/src/core/backup.rs`、`src/components/proxy/{proxy-chain,proxy-groups-chain,proxy-chain-model}.tsx|ts`、
  `src/pages/proxies.tsx`

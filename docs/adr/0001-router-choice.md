# ADR-0001：前端架构迁移的关键选型（路由 / 样式 / 状态 / 资产）

- 状态：**Accepted（条件通过：路由选型受 G1 约束）**
- 日期：2026-10-19
- 决策范围：`migrate/self-frontend-architecture` 分支
- 基线：`clash-verge-rev` `local` @ `ed909350`；`clash-verge-self` `dev` @ `f9cb6581`（完整历史以 tag `v2.3.2` / `75c8c416` 为准）
- 关联：[迁移计划](frontend-architecture-migration-plan.md) · [目标架构](frontend-architecture.md) · [Phase 0 基线](perf/frontend-baseline-2026-10-19.md)

## 1. 背景

rev 前端的**数据/事件层**在 2026-07~10 已完成三轮自我重构（`e63b8e6e` 去路由 lazy、`4ed47470` 查询所有权收敛、`69b76cc6` contract flow），但**表现层结构**仍停留在旧形态：路由是导航的副产物、页面全 eager、导航元数据手写、`pages/` 同时承载路由/导航/主题常量、样式无 token 层。self 在 2025-06 起做过一轮前端架构重构（TanStack Router、Zustand、TanStack Table、Tailwind、Material You），但其数据层（手写 invoke、零测试）明显弱于 rev。

本 ADR 记录"到底吸收 self 的哪些架构、保留 rev 的哪些资产"的四个关键裁决，供后续 Phase 与未来重评使用。

## 2. 决策

### D1 路由：迁移到 TanStack Router（条件 Go，G1 为闸门）

**决策**：采用 `@tanstack/react-router` + `@tanstack/router-plugin`（`autoCodeSplitting`），以文件式 `src/routes/*.tsx` 薄壳替代 `src/pages/_routers.tsx` 的静态路由表；导航元数据收口到 `src/config/navigation.ts`；路由级错误边界与 intent 预加载按目标架构落地。

**条件**：Phase 1 PoC（settings + proxies 两路由）必须同时满足 [迁移计划 §4.2](frontend-architecture-migration-plan.md) 的 G1 六项条件（门禁全绿、无导航 loading 闪烁、初始 JS 主 chunk −15%、依赖净增可控、smoke 无回归、route catalog 测试通过）。不满足则执行 B1 备选方案。

**关键证据**：

| 事实 | 数值 | 来源 |
| --- | --- | --- |
| rev 路由表规模 | `_routers.tsx` 18 行，`navItems.map` 生成 | `src/pages/_routers.tsx:6-17` |
| rev react-router 足迹 | 9 个文件 import、12 处 `useNavigate` 等 | `grep -rl "from 'react-router'" src` |
| rev 页面加载方式 | 8 个业务页面全部 eager import | `src/pages/_navigation.tsx:21-28` |
| rev 路由级能力 | 无 `lazy`/`loader`/`errorElement`/参数校验 | `src/pages/_routers.tsx` |
| self 路由文件 | 9 个（8 个 12 行页面壳 + `__root`），生成树 210 行 | `clash-verge-self/src/routes/*.tsx`、`routeTree.gen.ts` |
| self TanStack 能力使用 | `validateSearch`/`loader`/`beforeLoad`/`pendingComponent` 实测 0 处使用 | `grep -rn`（仅注释中的 `errorComponent` 1 次） |
| rev 的 lazy 历史教训 | 上游 2026-07-20 主动移除路由 lazy + idle 预热（−216 行） | `e63b8e6e` |

**结论**：rev 侧迁移面小（不是旧草案估计的"64 个路由文件"），收益是文件式路由、类型安全、按路由拆包与预加载；风险集中在"无 loading 闪烁"体验，用 G1 闸门 + B1 兜底控制。

### D2 样式：保留 MUI 单一基座，不引入 Tailwind；吸收 token 化与主题预设

**决策**：不新增 Tailwind 依赖，保留 MUI v9 + Emotion `sx`/`styled` + SCSS 现状；Phase 2 只在 rev 运行时主题之上补**语义 token 层**（颜色/间距/圆角/阴影/层级）与**主题预设 + 取色器**。self 的 `@theme inline` 桥接仅作为 token 设计的思路参考，不搬实现。

**关键证据**：

| 事实 | 数值/来源 |
| --- | --- |
| rev 样式分布 | `sx` 707 处/99 文件、`styled()` 42、SCSS 453 行、硬编码 hex 107 处 |
| rev 主题耦合 | `use-custom-theme.ts`(331 行) 运行时 `createTheme` + 16 个 CSS 变量 + 用户 CSS 注入（`@scope`）/背景图/系统暗色 |
| self 双样式成本 | MUI + Tailwind：`sx` 338 处/54 文件、`className` 418 处；`index.css` 523 行，其中 `@theme inline` 279 行；preflight 补丁 37 行 |
| 双样式回归证据 | `0cce9d23 fix(mui) restore OutlinedInput legend after Tailwind preflight` |

**理由**：rev 的主题是产品能力（用户自定义 CSS、背景图、透明度、明暗跟随），Tailwind 化需要 `cssVariables + layer + preflight 补丁 + Portal container` 一整套妥协；收益主要是布局 utility，而 rev 的 `sx` 已覆盖。self 自己也不是"Tailwind 取代 MUI"，而是三层混写。

### D3 状态：保留 SWR + AppStore reducer + 事件总线 + mutate 漏斗，不引入 Zustand

**决策**：保持 `src/AGENTS.md` 五条 ownership（contract/event/state/intent/command）不变；`AppDataProvider` 的 6 个 context 在 Phase 3 收敛为领域查询 hooks，但查询层仍是现有 `query-client`/SWR，**不引入 Zustand、不引入 TanStack Query**。

**关键证据**：

| 事实 | 数值/来源 |
| --- | --- |
| rev 查询层 | `query-client.ts`(125 行)、20 处 `useQuery`、18 个字符串 key；`mutate.ts`(64 行) 意图漏斗 |
| rev 状态边界 | `AppStore`(423 行含测试) reducer + `store-reads` 旧回复不覆盖新状态；`src/AGENTS.md` 明确 ownership |
| self 状态碎片 | 11 个 Zustand store（7 persist、无迁移策略）；profilesStore 持久化后端派生数据；3 处分层倒置 |
| self 反向依赖 | `services/cmds.ts:5`、`services/api.ts:8`、`stores/profilesStore.ts:5` 从 components 取类型 |

**结论**：self 的 store 是"实现选择"，不是"架构优势"；rev 的 ownership 模型更收敛。可借鉴的仅是"按域拆分 + 持久化白名单"的做法，且只在未来确有需要时采用。

### D4 契约、表格、组件基座、工具链不替换

| 资产 | 决策 | 理由 |
| --- | --- | --- |
| IPC 契约 | 保留 specta 生成 `bindings.ts`（92 commands）→ `cmds.ts`（514 行）→ hooks | self 是 74 个手写 invoke + 全局 `types.d.ts`，是明确退步 |
| 连接表 | 保留 rev 自研虚拟表（列管理/排序/持久化/快照） | self 的 TanStack Table 替换为 +6733/−3711 的负收益项（`5f8a2277`） |
| base 组件 | 不整体迁移，只做差异清单（见架构文档附录 A） | 两者基座等价，rev 18 文件/1441 行 vs self 19 文件/1628 行，核心组件都有 |
| 工具链 | 保留 Biome format + ESLint 10 + knip(cycles) + vitest + arch:check | self 三套 lint/format、零前端测试；rev 门禁更强 |
| i18n | 保留 14 locale × 10 namespace + 生成 key 类型 | self 仅 4 locale、无生成 key 类型 |

## 3. 备选方案

### B1 路由的兜底方案：react-router 8 data-router 演进（G1 不通过时启用）

保留 `react-router`，只做 `routes/` 分层 + `_navigation` 元数据收口 + data-router 的 `lazy`/`preload`（hover 时 `import()` 预热）。估算 2–3 人日。**不否决**：这是 G1 失败时的既定路径（[迁移计划 §4.2](frontend-architecture-migration-plan.md)）。

### B2 全量 Tailwind 设计系统（拒绝，留待 G5 产品级决策）

若未来做 UI 重设计，可单独立项：先 PoC 一个页面 + `MUI cssVariables` + layer/preflight 补丁 + 用户主题回归清单，再评估 10–20 人日。本分支不做。

### B3 Zustand / TanStack Query（拒绝）

理由见 D3。若未来出现跨页高频 UI 状态（如复杂拖拽/多窗口），单独评估局部 store，不改变全局 ownership。

### B4 TanStack Table（拒绝）

理由见 D4；连接表只做列定义模块化与过滤（后者由 `migrate/connections-filter` 分支承载）。

## 4. 后果

**正面**

- 路由层从"导航副产物"变为可测试、类型安全、可拆包的一等公民；新增页面从 6 步降到 3 步。
- 样式获得 token 单一入口，主题预设可产品化；不承担双样式体系的长期维护税。
- 数据/契约/i18n/质量体系零倒退，迁移风险面被限制在表现层。

**负面**

- 引入 2 个新依赖（`@tanstack/react-router`、`@tanstack/router-plugin`）与生成物 `routeTree.gen.ts`，需要 lint/format/knip 豁免与 CI 生成校验。
- 路由迁移与上游 churn 区（`_layout.tsx`、pages）重叠，需要 rebase 纪律与冻结区约束。
- "无 loading 闪烁"目标无法用静态分析证明，必须靠 G1 的运行时录屏/计时证据。

**中性**

- `pages/` 目录保留，只是职责收缩；不产生大规模文件搬迁，diff 可审计。

## 5. 重新评估条件

出现以下任一情况时重开本 ADR：

1. G1 六项条件任一不满足（路由 → B1）。
2. 上游 `origin/dev` 在迁移期间重写路由/状态层（暂停对应 Phase，先吸收上游）。
3. 产品决定做 UI 重设计并接受 Tailwind 维护成本（重评 D2）。
4. React Compiler 正式启用或 MUI 主题 API 发生 major 变更（重评 D2/D3 实现细节）。

## 6. 参考

- [迁移计划（总纲）](frontend-architecture-migration-plan.md)
- [目标架构](frontend-architecture.md)
- [Phase 0 基线报告](perf/frontend-baseline-2026-10-19.md)
- self 重构关键提交：`4812e488`（TanStack Router）、`1da1d991`（预加载）、`35115975`（Zustand）、`5f8a2277`（TanStack Table）、`5e7e8c26`（Material You）；未合并 `62fd7402`（specta）
- rev 关键提交：`e63b8e6e`（去 lazy）、`4ed47470`（查询所有权）、`69b76cc6`（contract flow）
- 硬约束：`src/AGENTS.md`、`eslint.config.ts:15-99`、`scripts/check-architecture.mjs`

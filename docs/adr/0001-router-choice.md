# ADR-0001：前端关键选型（路由 / 样式 / 状态 / 契约与工具链）

- 状态：**Accepted**（D1 于 2026-10-22 修订：保留 react-router，撤销 TanStack Router 迁移）
- 日期：2026-10-19（初版）· 2026-10-22（D1 修订）
- 关联：[目标架构](../frontend-architecture.md) · [ADR-0002](0002-design-tokens.md)（设计 token）· [ADR-0003](0003-state-boundary.md)（状态边界）· [bundle 基线](../perf/frontend-baseline-2026-10-19.md)
- 代码：`src/app/{router,route-pages,route-fallbacks,layout}.tsx`、`src/config/navigation.ts`、`src/components/layout/layout{,-item,-sidebar}.tsx`

## 1. 背景

2026-10 曾评估把 clash-verge-self 的前端架构（文件式路由、设计 token、领域查询 hook）融合进 rev，并在 `local` 上实施了一轮 TanStack Router 全量替换（`src/routes/*` 薄壳 + `routeTree.gen.ts` + `@tanstack/router-plugin`）。

按 `self-to-rev-migration-plan.md` §5 的不迁移清单（D2 "TanStack Router 全量替换"、D3 "TanStack Table"、D4 "Zustand"）复核后，2026-10-22 决定回滚路由层到 dev 的 react-router 架构，其余本地前端改造（设计 token、领域查询 hook、测试、bundle 预算）保留。

rev 的 react-router 足迹很小：路由表 `app/router.tsx` 十几行、8 个页面、`useNavigate`/`Outlet` 少量调用点；"无导航 loading 闪烁"是上游 `e63b8e6e` 的刻意取舍。路由层收益（重页面拆包）可用 C6 的 route-level `lazy` + intent 预加载低风险达成。

## 2. 决策

### D1 路由：保留 react-router 8 data router（不引入 TanStack Router）

- 路由表由 `config/navigation.ts` 的 `NAV_ITEMS` 生成：`src/app/router.tsx` 负责 `createBrowserRouter`，`src/app/route-pages.ts` 以 `Record<NavigationId, PageRoute>` 映射页面（或 lazy import），类型层面保证每个导航 id 都有落点。
- 重页面分包（C6）：`profiles` / `connections` / `settings` 通过 react-router 的 route-level `lazy` 拆出首包；侧边栏 hover/focus 通过 `preloadPage(id)` 预取 chunk，避免首跳 loading 闪烁。
- 路由级兜底：根路由 `errorElement: <RouteError />`、未匹配 `path: '*' → RouteNotFound`，均在 app shell 内渲染，侧边栏/窗口 chrome 不丢失。
- 不使用文件式路由、`routeTree.gen.ts` 生成物、router Vite 插件，也不引入 route `loader`（数据仍由 SWR/WS 所有，见 ADR-0003）。

**关键证据**

| 事实 | 数值/来源 |
| --- | --- |
| rev 路由规模 | 8 个页面、1 个路由表文件；`useNavigate` 等 hook 少量调用点 |
| 拆包需求 | C6：profiles/connections/settings 拆出后主包 −33%（raw 1072→715 kB） |
| 上游取舍 | `e63b8e6e` 移除路由 lazy + idle 预热，避免导航 loading 闪烁 |
| 维护成本 | TanStack 引入 3 个依赖 + 生成物 + lint/format/knip 豁免；收益已可由 react-router 达成 |

### D2 样式：MUI 单一基座 + 语义 token，不引入 Tailwind

保留 MUI v9 + Emotion `sx`/`styled` + SCSS；在运行时主题之上补语义 token 层（颜色/间距/圆角/阴影/层级）与主题预设/取色器。详见 [ADR-0002](0002-design-tokens.md)。self 的 Tailwind 方案（preflight 补丁、cssVariables、layer 顺序）不迁移；仅当单开 UI 重设计轨道时重评。

### D3 状态：SWR + AppStore reducer + 事件总线 + mutate 漏斗，不引入 Zustand

保持 `src/AGENTS.md` 的 ownership 不变；普通读由 `hooks/data/*` 领域查询 hooks 承担（T1），查询层仍是既有 `query-client`/SWR。不引入 Zustand、TanStack Query 或第二个状态体系。详见 [ADR-0003](0003-state-boundary.md)。

### D4 契约、表格、组件基座、工具链不替换

| 资产 | 决策 | 理由 |
| --- | --- | --- |
| IPC 契约 | 保留 specta 生成 `bindings.ts` → `cmds.ts` → hooks | self 是手写 invoke + 全局 `types.d.ts`，是明确退步 |
| 连接表 | 保留 rev 自研虚拟表 | self 的 TanStack Table 替换为负收益项 |
| base 组件 | 不整体迁移 | 两边基座等价，只补差异原语 |
| 工具链 | 保留 bun + oxlint/oxfmt + knip + vitest + arch:check | 门禁强于 self |
| i18n | 保留 14 locale × 10 namespace + 生成 key 类型 | self 仅 4 locale、无生成 key 类型 |

## 3. 备选方案

- **B1 TanStack Router（已否决，2026-10-19 实施、2026-10-22 回滚）**：文件式路由 + `routeTree.gen.ts` + `@tanstack/router-plugin`。回滚原因：与不迁移清单冲突；生成物/插件/依赖带来的维护面大于收益；route catalog 测试也只能覆盖生成树与 catalog 的一致性，而现在的 `Record<NavigationId, ...>` 由类型系统直接保证。
- **B2 保持全 eager 路由（dev 原状）**：无法达成 C6 的首包目标，保留为回滚兜底。
- **B3 react-router framework mode（loader/prefetch）**：会与 query ownership 形成第二数据源，拒绝。
- **B4 Tailwind 设计系统 / Zustand / TanStack Table**：拒绝，理由见 D2/D3/D4 与迁移计划 §5。

## 4. 后果

**正面**

- 不引入生成物、router 插件与新增依赖；新增页面只有页面组件、`app/route-pages.ts`、`config/navigation.ts`（+ 图标/文案）几处，导航目录仍是单一事实源。
- C6 拆包与 intent 预加载继续生效；bundle budget / hex budget 门禁不变。
- 路由层回到上游 dev 的形态，后续 `origin/dev` 合并的冲突面显著缩小。

**负面**

- 失去文件式路由的类型安全路径与 `validateSearch`/loader 等能力；路由表是手写映射，完整性依赖 `Record<NavigationId, PageRoute>` 穷举类型。
- 路由级错误兜底依赖 `errorElement`（react-router data router），与 TanStack 的 `defaultErrorComponent` 行为细节不同，需回归验证。

**中性**

- `pages/` 职责不变；`app/` 仍是唯一组合根（T2 的分层规则保留）。

## 5. 重新评估条件

1. 上游 `origin/dev` 自己迁移到文件式路由（跟随上游，不再自行替换）。
2. 产品决定做 UI 重设计并接受 Tailwind/新路由体系的维护成本（重评 D1/D2）。
3. 路由能力成为瓶颈（例如需要 `validateSearch`/loader 的强类型深链），先在独立 PoC 评估 react-router data APIs 是否够用。

## 6. 参考

- `self-to-rev-migration-plan.md` §5（不迁移清单 D1–D4）与 §2（C6 拆包）
- 上游 `e63b8e6e`（移除路由 lazy/导航 loading）、C6 提交（react-router lazy + intent 预加载）
- [目标架构](../frontend-architecture.md)、[ADR-0002](0002-design-tokens.md)、[ADR-0003](0003-state-boundary.md)

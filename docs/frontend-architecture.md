# clash-verge-rev 前端目标架构（融合 self 骨架后的形态）

> 状态：Phase 0 产出（目标态定义，尚未实现）
> 日期：2026-10-19
> 上位文档：[迁移计划](frontend-architecture-migration-plan.md) · [ADR-0001](adr/0001-router-choice.md) · [Phase 0 基线](perf/frontend-baseline-2026-10-19.md)
> 约束来源：`src/AGENTS.md`（contract/event/state/intent/command ownership）、`eslint.config.ts:15-99`（IPC 边界）、`scripts/check-architecture.mjs`、`src-tauri/config/verge.rs`（配置契约）

本文描述迁移完成后的前端结构。未实现前，以迁移计划 §3 为准；实现过程中若与本文件冲突，先改本文件并说明原因，再改代码。

## 1. 分层与依赖方向

```text
┌─────────────────────────────────────────────────────────────┐
│ app/            组合根：main / router / layout / providers   │
├─────────────────────────────────────────────────────────────┤
│ routes/         文件式路由薄壳（声明 + staticData + 错误边界）│
├─────────────────────────────────────────────────────────────┤
│ pages/          页面级组合组件（可含页面私有 hooks/sections） │
├─────────────────────────────────────────────────────────────┤
│ components/     base 原语 + 按域组件（home/profile/proxy/…）  │
├─────────────────────────────────────────────────────────────┤
│ services/       契约 bindings → cmds → query/bus/mutate/notice│
│ hooks/ utils/   跨页面复用逻辑（hooks 可依赖 services）        │
├─────────────────────────────────────────────────────────────┤
│ config/ store/  静态配置、AppStore、types、locales            │
└─────────────────────────────────────────────────────────────┘
```

| 层 | 可以依赖 | 明确禁止 |
| --- | --- | --- |
| `routes/` | `pages/`、`config/`、`components/base` | `services/`、`store/`（路由层保持纯声明） |
| `pages/` | `components/`、`hooks/`、`services/`、`config/`、`store/` | `routes/` |
| `components/` | `components/`、`hooks/`、`utils/`、`services/`、`config/` | `pages/`、`routes/`、`app/` |
| `services/` | `services/`、`types/`、`utils/` | `components/`、`pages/`、`routes/`、`app/` |
| `hooks/` | `services/`、`utils/`、`store/`、`config/` | `components/`、`pages/`、`routes/` |
| `app/` | 全部 | —（唯一允许跨层的组合根） |

> 已由 `eslint.config.ts` 的 `import-x/no-restricted-paths` + `scripts/check-architecture.mjs` 的 `arch:check` 强制（T2）；违反方向会在 lint/CI 阶段失败。

## 2. 路由层

### 2.1 文件与约定

```text
src/
├── app/
│   ├── main.tsx       # bootstrap：preloadAppData → createRoot → ComposeContextProvider
│   ├── router.tsx     # createRouter(routeTree, ROUTER_OPTIONS)
│   ├── layout.tsx     # 应用壳：主题/窗口/通知/侧边栏/Outlet
│   └── providers.tsx  # SWRConfig + AppStoreProvider + ThemeMode/UpdateState
├── routes/
│   ├── __root.tsx     # createRootRoute：Layout + notFound + errorComponent
│   ├── index.tsx      # /
│   ├── proxies.tsx
│   ├── profiles.tsx   # /profile（保留现有路径）
│   ├── connections.tsx
│   ├── rules.tsx
│   ├── logs.tsx
│   ├── unlock.tsx
│   └── settings.tsx
└── routeTree.gen.ts   # 生成物：提交入库，eslint/biome/knip 豁免
```

**route 薄壳规则**：

1. 只包含：`component`、`staticData`、`errorComponent`（以及未来确需的 `validateSearch`）。
2. 不写业务逻辑、不发请求、不做 `invoke`；页面数据仍由 `pages/` + hooks + SWR/WS 获取。
3. **不写手动 `React.lazy`**：拆包交给插件 `autoCodeSplitting`。`/`（home）内部的卡片级 lazy 保留。
4. 页面对外默认导出组件，route 文件负责 import；页面不感知路由实例。

示例：

```tsx
// src/routes/settings.tsx
import { createFileRoute } from '@tanstack/react-router'

import { BaseErrorBoundary } from '@/components/base'
import SettingPage from '@/pages/settings'

export const Route = createFileRoute('/settings')({
  component: SettingPage,
  staticData: { navId: 'settings' },
  errorComponent: BaseErrorBoundary,
})
```

### 2.2 Router 配置

```ts
// src/app/router.tsx（Phase 1 以实测调参，写入 ADR-0001 的 G1 记录）
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',      // hover/focus 时预取，不 idle 全量预载
  defaultPreloadDelay: 0,
  defaultPendingMs: 200,         // 200ms 内完成的导航不显示 pending，避免闪烁
  defaultPendingMinMs: 300,
})
```

- 保留 rev 的"无导航 loading"体验目标（`e63b8e6e` 的教训）作为 G1 验收项。
- 不配置 idle 全量预载；如后续需要，只按数据预热 1 条最常用路由。
- 不加 route `loader`：数据仍由 SWR/WS 获取，避免第二数据源（`src/AGENTS.md` query ownership）。

### 2.3 导航单一事实源

```ts
// src/config/navigation.ts
export const NAV_ITEMS = [
  { id: 'home', path: '/', labelKey: 'layout.components.navigation.tabs.home', icon: [...] },
  // ...
] as const
```

- `routes/*.tsx` 通过 `staticData.navId` 与 `NAV_ITEMS` 关联。
- `verge.menu_order` 继续以 `path` 为 key，存量用户配置零迁移。
- 后端导航（`navigate_to_route`、notice 的 `navigate('/profile')`）统一走 `navigateToRoute(id)` 的穷举映射；未知值 fallback 首页并 `console.warn`。
- **route catalog 测试**（Phase 1）断言：routeTree 叶子路径集合 == `NAV_ITEMS.path` 集合；每个 `staticData.navId` 都存在。

### 2.4 新增页面步骤（3 步）

1. `src/pages/<name>.tsx` 写页面组件（子组件放 `src/components/<domain>/`）。
2. `src/routes/<name>.tsx` 加路由薄壳：`createFileRoute('/<path>')({ component, staticData: { navId } })`；按需 `pnpm generate-routes`（dev/build 也会生成）。
3. 导航与文案：`src/config/navigation.ts` 的 `NAV_META` 加 id/path/labelKey；`src/components/layout/navigation-icons.tsx` 的 `NAV_ICONS` 补图标；14 个 `src/locales/*/layout.json` 补 `tabs.<name>` → `pnpm i18n:types`。

> `src/routes/__route-catalog.test.ts` 会校验 route 路径、`staticData.navId` 与 catalog 一致；完整操作见 `CONTRIBUTING.md` 的 “Adding a Frontend Page”。

## 3. 状态与数据层

保持 `src/AGENTS.md` 的 ownership，不变：

| 归属 | 所有者 | 说明 |
| --- | --- | --- |
| Contract | `services/bindings.ts`（生成） + `contract.ts` | 事件/通知契约与后端 wire contract 对齐 |
| Event | `services/bus/**` | 唯一 `listen/emit` 点；组件只消费 bus |
| State | `store/`（AppStore reducer）+ 查询缓存 | 事件态与普通读分离；读序边界由 `store-reads` 保证 |
| Intent | `services/mutate.ts` | 同 id 串行、busy 非成功、成功副作用 |
| Command | `services/cmds.ts` + hooks | 组件不直接 invoke |

Phase 3（T1）已完成：普通读改为领域查询 hooks，app-data Provider/Context 已移除：

```text
删除：providers/app-data-context.ts（6 个 context）、providers/app-data-provider.tsx（6 层嵌套）
hooks/data/                      领域查询 hooks（共享 query-client / SWR key）
├── use-proxy-view-data.ts / use-rules-data.ts / use-clash-config-data.ts
├── use-system-data.ts / use-app-refreshers.ts / use-core-data-status.ts
├── query-options.ts             key 与 fetch 策略的唯一来源
└── index.ts                     消费入口（原 provider 模块的 import 已全部迁移）
app/                            不再需要 app-data provider；组合根只剩 SWRConfig/AppStore/Theme/Update
```

- query key 与 `mutate/revalidate` 语义保持不变；refreshers = 缓存 revalidate（可单测）。
- 数据在消费组件挂载时按需触发（不再由根 Provider 启动即全量拉取）；页面私有 UI 状态留在页面/组件内。
- 不新增全局 store；持久化（若未来新增）必须 `version + migrate + 敏感字段 allowlist`；禁止持久化后端派生数据。

## 4. 样式与主题

```text
src/config/theme/
├── defaults.ts    # defaultTheme / defaultDarkTheme
├── tokens.ts      # 语义 token + CSS 变量生成（createThemeCssVariables / resolveThemeColors）
├── presets.ts     # 6 套主题预设（8 个颜色 key，由 utils/theme-presets.ts 迁入）
└── index.ts       # 主题层唯一 import 入口
```

- 组件样式优先级：MUI `sx` > `styled()` > SCSS（仅全局/布局壳）。新代码禁止裸 hex，统一 `theme.palette` 或语义 token。
- `use-custom-theme` 负责：运行时 `createTheme`、CSS 变量注入、用户自定义 CSS（`@scope`）、背景图/透明度、系统暗色跟随。S1 起它只消费 `tokens.ts` 的生成结果，不再含硬编码颜色。
- CSS 变量：保留既有 legacy 名称（`--background-color`、`--divider-color` 等），新增语义色（`--color-*`）与尺度（`--space-*` / `--radius-*` / `--shadow-*` / `--z-*` / `--overlay-*`）。
- 主题预设已接入 token 体系（6 套 × 明暗）。
- S3（按域 hex 清理）：全仓组件/页面的裸 hex 已清零（token 定义与 stylesheet 默认值除外），统一走 `theme.palette` / 生成 CSS 变量（`--surface-card` / `--surface-page` / `--surface-raised` / `--log-highlight` / `--switch-*` 等）。
- 回归守卫：`pnpm check:hex-budget`（CI 已接入）统计 token/styles 目录之外的裸 hex，**预算 0**；新增颜色必须进入 `config/theme/tokens.ts` 或 `assets/styles` 的 CSS 变量默认值。
- **不引入 Tailwind**（ADR-0001 D2）；明暗双套主题配置依赖后端契约字段，另行排期。

## 5. 质量门禁

| 门禁 | 命令/实现 | 现状 |
| --- | --- | --- |
| 类型/格式/lint | `pnpm typecheck`、`pnpm format:check`、`pnpm lint` | 已有（Phase 0 全绿） |
| 单测 | `pnpm test`（vitest，node 环境） | 已有；Phase 4 扩 jsdom |
| 死代码/循环 | `pnpm knip:check` | 已有 |
| IPC 边界 | `node scripts/check-architecture.mjs listen emit invoke` | 已有 |
| i18n | `pnpm i18n:types && pnpm i18n:check` | 已有（Phase 4 接 CI `--check`） |
| 分层边界 | import 分区规则（Phase 3） | 待建 |
| 路由一致性 | `routes/__route-catalog.test.ts`（Phase 1） | 待建 |
| bundle 预算 | `scripts/check-bundle-budget.mjs` 对比 `docs/perf/frontend-baseline.json`（T4） | 已接入 CI |
| 导航性能 | 扩展 `scripts/perf`（Phase 1 PoC 起） | 协议见基线报告 |

## 附录 A：base 组件差异清单（Phase 0 实测）

- rev：`src/components/base` 18 个文件（17 tsx，1441 行）；self：19 个 tsx（1628 行）；**公共 12 个**。
- 结论：**不做 base 层整体迁移**。两边的核心原语等价，差异项多数是风格/依赖选择；只保留 Phase 4 评估 `CopyButton` 一项（rev 目前 3 处内联 clipboard 调用）。

| 类别 | 组件 | 处理 |
| --- | --- | --- |
| 公共（12） | BaseDialog、BaseEmpty、BaseErrorBoundary、BaseFieldset、BaseLoading、BasePage、BaseSearchBox、BaseStyledSelect、BaseStyledTextField、Switch、SortableItem、StickyVirtualList | 保留 rev 实现 |
| rev 独有（5） | BaseLoadingOverlay、BaseSplitChipEditor、BaseTooltipIcon、MonacoEditor、VirtualList | 保留 |
| self 独有（7） | BaseEditorViewer、SwitchLovely、CopyButton、Marquee、MyNoticeContainer、Notifies、TailwindIndicator | 仅评估 CopyButton；其余拒绝（notistack/Tailwind 相关或价值低） |

## 附录 B：上游 churn 冻结清单（Phase 0 实测，`origin/dev` 近 6 个月）

> 数据：`git log --since=2026-04-19 --pretty=format: --name-only origin/dev -- src | sort | uniq -c`。迁移 diff 尽量避开这些文件；必须修改时单独 PR 并标注冲突风险。

| 文件/目录 | 提交数 | 策略 |
| --- | --- | --- |
| `src/services/cmds.ts` | 38 | 冻结，不改 |
| `src/types/generated/i18n-*.ts` | 34 + 34 | 生成物，不改 |
| `src/locales/*/settings.json`（14 份） | 25–26/份（locales 合计 682） | 只增 key，走脚本 |
| `src/pages/profiles.tsx` | 23 | 不改内部 |
| `src/components/setting/mods/dns-viewer.tsx` | 21 | 不改内部 |
| `src/pages/_layout.tsx` | 20 | 一次性迁到 `app/layout.tsx` 后冻结 |
| `src/components/home/current-proxy-card.tsx` | 18 | 不改内部 |
| `src/components/proxy/proxy-groups.tsx` | 17 | 不改内部 |
| `src/providers/app-data-provider.tsx` | 16 | Phase 3 一次性迁移 |
| `src/components/profile/rules-editor-viewer.tsx` | 14 | 不改内部 |
| `src/components/profile/profile-item.tsx` | 14 | 不改内部 |
| `src/components/setting/mods/update-viewer.tsx` | 13 | 不改内部 |
| `src/types/global.d.ts` | 12 | 不改 |
| `src/hooks/use-system-proxy-state.ts` | 12 | 谨慎 |
| `src/components/proxy/proxy-chain.tsx` | 12 | 谨慎 |

> 另：历史高频但当前树已删除的文件（`pages/_layout/hooks/use-layout-events.ts` 21 次、`pages/_layout/utils/notification-handlers.ts` 15 次）说明布局/通知层仍在收敛——`app/layout.tsx` 迁移完成后应尽快冻结该区域。

## 参考

- [迁移计划](frontend-architecture-migration-plan.md)（Phase/卡片/门禁）
- [ADR-0001](adr/0001-router-choice.md)（路由/样式/状态选型）
- [ADR-0002](adr/0002-design-tokens.md)（设计 token 与主题体系）
- [ADR-0003](adr/0003-state-boundary.md)（状态与数据边界）
- [Phase 0 基线](perf/frontend-baseline-2026-10-19.md)（门禁、bundle、测量口径）
- `src/AGENTS.md`、`scripts/check-architecture.mjs`、`eslint.config.ts`

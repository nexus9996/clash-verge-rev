# clash-verge-rev 前端架构

> 状态：**已实现并合入 `local`**（设计 token、领域查询 hooks、bundle/hex 预算与测试已落地；路由层保持 react-router）
> 日期：2026-10-19 · 2026-10-22 修订（路由层回滚到 dev 的 react-router）
> 上位文档：[ADR-0001](adr/0001-router-choice.md) · [ADR-0002](adr/0002-design-tokens.md) · [ADR-0003](adr/0003-state-boundary.md) · [bundle 基线](perf/frontend-baseline-2026-10-19.md)
> 约束来源：`src/AGENTS.md`（contract/event/state/intent/command ownership）、`.oxlintrc.json`（静态 import 边界）与 `scripts/check-architecture.mjs`（动态 import/分层）、`scripts/check-architecture.mjs`、`src-tauri/config/verge.rs`（配置契约）

本文描述当前已实现的前端结构；实现过程中若与本文件冲突，先改本文件并说明原因，再改代码。

## 1. 分层与依赖方向

```text
┌─────────────────────────────────────────────────────────────┐
│ app/            组合根：router / route table / layout / fallbacks（入口 main.tsx）│
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
| `pages/` | `components/`、`hooks/`、`services/`、`config/`、`store/` | `app/` |
| `components/` | `components/`、`hooks/`、`utils/`、`services/`、`config/` | `pages/`、`app/` |
| `services/` | `services/`、`types/`、`utils/` | `components/`、`pages/`、`app/` |
| `hooks/` | `services/`、`utils/`、`store/`、`config/` | `components/`、`pages/` |
| `app/` | 全部 | —（唯一允许跨层的组合根） |

> 已由 `scripts/check-architecture.mjs` 的层向规则与 `arch:check` 强制（T2）；违反方向会在 lint/CI 阶段失败。

## 2. 路由层

### 2.1 文件与约定

```text
src/
├── main.tsx            # bootstrap：preloadAppData → createRoot → RouterProvider（SWR/AppStore/Theme/Update 组合在 render 树内）
├── app/
│   ├── router.tsx      # createBrowserRouter：从 NAV_ITEMS 生成路由表 + errorElement
│   ├── route-pages.ts  # NavigationId → 页面组件 / lazy import 的唯一映射
│   ├── route-fallbacks.tsx # RouteNotFound / RouteError（保留 app shell）
│   └── layout.tsx      # 应用壳：主题/窗口/通知/侧边栏/Outlet
├── pages/              # 8 个业务页面（页面级组合组件）
└── config/navigation.ts # 导航单一事实源（id/path/labelKey）
```

**路由约定**：

1. 路由表由 `config/navigation.ts` 的 `NAV_ITEMS` 生成；`app/route-pages.ts` 的 `PAGE_ROUTES: Record<NavigationId, PageRoute>` 穷举类型保证每个导航 id 都有落点，不需要生成物或 catalog 测试。
2. 路由层是组合根的一部分，不写业务逻辑、不发请求；页面数据仍由 `pages/` + hooks + SWR/WS 获取，**不使用 route loader**（避免第二数据源，见 ADR-0003）。
3. **重页面显式分包，其余 eager**（C6）：`profiles` / `connections` / `settings` 用 react-router 的 route-level `lazy`；其余页面静态 import 保持切页零 loading。`/`（home）内部的卡片级 lazy 保留。
4. 路由级兜底：每条页面路由带 `errorElement: <RouteError />`，未匹配路径由 `path: '*' → RouteNotFound` 承载，均渲染在 app shell（侧边栏/窗口 chrome）内。

示例：

```tsx
// src/app/router.tsx（节选）
const pageRoutes: RouteObject[] = NAV_ITEMS.map((item) => {
  const page = PAGE_ROUTES[item.id]

  return {
    path: item.path,
    ...(page.lazy ? { lazy: page.lazy } : { Component: page.Component }),
    errorElement: <RouteError />,
  }
})

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [...pageRoutes, { path: '*', Component: RouteNotFound }],
  },
])
```

### 2.2 分包与预加载（C6）

| 页面 | 加载方式 | 预取时机 |
| --- | --- | --- |
| `profiles` / `connections` / `settings` | route-level `lazy: () => import('@/pages/…')` | 侧边栏 hover / focus 时 `preloadPage(id)` |
| `home` / `proxies` / `rules` / `logs` / `unlock` | 静态 import（eager） | 无（随首包） |

- 目标仍是 rev 的"无导航 loading"体验（上游 `e63b8e6e` 的教训）：拆包页面在 hover/focus 预取 chunk，正常操作下首跳不等 chunk。
- 不做 idle 全量预热、不做路由 pending 门槛：react-router data router 在模块就绪前不会渲染目标路由，避免闪烁由预取保证。
- 首包体积由 `bun run check:bundle-budget` 门禁继续把关（T4，见 §5）。

### 2.3 导航单一事实源

```ts
// src/config/navigation.ts
const NAV_META = {
  home: { path: '/', labelKey: 'layout.components.navigation.tabs.home' },
  // ...
} as const satisfies Record<string, { path: string; labelKey: TranslationKey }>

export const NAV_ITEMS: NavigationItem[] = NAV_IDS.map((id) => ({ id, ...NAV_META[id] }))
```

- 侧边栏（`components/layout/layout-sidebar.tsx`）与路由表（`app/router.tsx`）都消费 `NAV_ITEMS`，图标映射在 `components/layout/navigation-icons.tsx`。
- `verge.menu_order` 继续以 `path` 为 key，存量用户配置零迁移。
- 后端导航（notice、托盘、深链）统一走 `resolveNavigationPath(path)` 映射；未知值 fallback 首页并 `console.warn`。
- 防漂移由类型系统承担：`PAGE_ROUTES` 必须是 `Record<NavigationId, …>`，缺 id / 多 id 都会编译失败；`config/navigation.test.ts` 继续校验 id/path 唯一性与后端路径解析。

### 2.4 新增页面步骤（3 步）

1. `src/pages/<name>.tsx` 写页面组件（子组件放 `src/components/<domain>/`），默认导出。
2. `src/app/route-pages.ts` 增加映射：`<id>: { Component: MyPage }`；重页面用 `{ lazy: lazyPage(() => import('@/pages/my-page')) }`。
3. 导航与文案：`src/config/navigation.ts` 的 `NAV_META` 加 id/path/labelKey；`src/components/layout/navigation-icons.tsx` 的 `NAV_ICONS` 补图标；14 个 `src/locales/*/layout.json` 补 `tabs.<name>` → `bun run i18n:types`。

最后跑 `bun run typecheck && bun run test && bun run lint`。完整操作见 `CONTRIBUTING.md` 的 "Adding a Frontend Page"。

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
- 回归守卫：`bun run check:hex-budget`（CI 已接入）统计 token/styles 目录之外的裸 hex，**预算 0**；新增颜色必须进入 `config/theme/tokens.ts` 或 `assets/styles` 的 CSS 变量默认值。
- **不引入 Tailwind**（ADR-0001 D2）。亮/暗两套主题设置已落地（C5）：`verge.light_theme_setting` / `verge.dark_theme_setting`，未设置时回退 `theme_setting`；预设、取色器、字体、背景图、透明度和 CSS 注入行为不变。

## 5. 质量门禁

| 门禁 | 命令/实现 | 现状 |
| --- | --- | --- |
| 类型/格式/lint | `bun run typecheck`、`bun run format:check`、`bun run lint` | 已有（Phase 0 全绿） |
| 单测 | `bun run test`（vitest；jsdom 按文件 docblock 启用） | 已有；含路由兜底/导航/主题测试 |
| 死代码/循环 | `bun run knip:check` | 已有 |
| IPC 边界 | `bun scripts/check-architecture.mjs listen emit invoke` | 已有 |
| i18n | `bun run i18n:types && bun run i18n:verify` | 已接入 CI（生成物 diff + `--check`；missing-source 仅报告） |
| 分层边界 | `scripts/check-architecture.mjs` + `arch:check` | 已接入（T2） |
| bundle 预算 | `scripts/check-bundle-budget.mjs` 对比 `docs/perf/frontend-baseline.json`（T4/C6） | 已接入 CI |
| hex 预算 | `scripts/check-hex-budget.mjs`（预算 0，S3） | 已接入 CI |

## 附录 A：base 组件差异清单（Phase 0 实测）

- rev：`src/components/base` 18 个文件（17 tsx，1441 行）；self：19 个 tsx（1628 行）；**公共 12 个**。
- 结论：**不做 base 层整体迁移**。两边的核心原语等价，差异项多数是风格/依赖选择。`CopyButton` 评估结论：**不引入**——clipboard 调用分散在 notice/editor/advanced/controller 4 处且交互各异，封装收益低于新增 base 组件的维护成本；若后续出现更多复用点再重评。

| 类别 | 组件 | 处理 |
| --- | --- | --- |
| 公共（12） | BaseDialog、BaseEmpty、BaseErrorBoundary、BaseFieldset、BaseLoading、BasePage、BaseSearchBox、BaseStyledSelect、BaseStyledTextField、Switch、SortableItem、StickyVirtualList | 保留 rev 实现 |
| rev 独有（5） | BaseLoadingOverlay、BaseSplitChipEditor、BaseTooltipIcon、MonacoEditor、VirtualList | 保留 |
| self 独有（7） | BaseEditorViewer、SwitchLovely、CopyButton、Marquee、MyNoticeContainer、Notifies、TailwindIndicator | CopyButton 评估结论为不引入（见上）；其余拒绝（notistack/Tailwind 相关或价值低） |

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

> 另：历史高频但当前树已删除的文件（`pages/_layout/hooks/use-layout-events.ts` 21 次、`pages/_layout/utils/notification-handlers.ts` 15 次）说明布局/通知层仍在收敛。该区域已完成 `app/layout.tsx` 迁移（T2），此后按冻结区对待：新增改动单独 PR 并标注冲突风险。

## 参考

- [ADR-0001](adr/0001-router-choice.md)（路由/样式/状态/契约选型）
- [ADR-0002](adr/0002-design-tokens.md)（设计 token 与主题体系）
- [ADR-0003](adr/0003-state-boundary.md)（状态与数据边界）
- [Phase 0 基线](perf/frontend-baseline-2026-10-19.md)（门禁、bundle、测量口径）
- `src/AGENTS.md`、`scripts/check-architecture.mjs`、`.oxlintrc.json`

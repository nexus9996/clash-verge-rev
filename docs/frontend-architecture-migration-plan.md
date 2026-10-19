# clash-verge-rev × clash-verge-self 前端架构迁移计划

> 分支：`migrate/self-frontend-architecture`（基于 `local` @ `ed909350`）
> 日期：2026-10-19
> 基线：`clash-verge-rev` = `local`（v2.5.9 + 69 本地提交，其中仅 8 个碰前端，均为 macOS 原生标题栏/窗口控制）；`clash-verge-self` = `dev` @ `f9cb6581`（2026-10-19，完整历史以 tag `v2.3.2` / `75c8c416` 为准，dev 为 shallow clone）
> 方法：只读静态分析 + git 历史取证；未构建、未安装、未运行。文中行号为当前工作树（rev worktree / self dev）。
> 定位：本文件是该分支的**总纲与执行清单**，不是实现。实现按 Phase 拆子分支/PR；每个 Phase 有独立验收与回滚点。
> 状态：Phase 0 已完成（2026-10-19）——门禁全绿、bundle 基线入库、ADR/架构文档就绪；执行记录见 §12。

---

## 0. 结论先行（TL;DR）

**不是把 self 的前端栈整体搬过来，而是以 rev 为基座，吸收 self 前端架构重构中真正有价值的骨架与开发体验。** 目标是一个"融合架构"：rev 的 IPC 契约、事件/状态所有权、i18n、质量门禁和 MUI 产品化主题不动，替换的是路由层与样式/组织层的**结构**。

### 四条核心裁决

| # | 裁决 | 一句话理由 |
| --- | --- | --- |
| D1 | **路由迁移到 TanStack Router**（条件 Go：2 路由 PoC 过关后全量） | rev 路由层极薄（路由表 18 行、react-router 仅 9 文件命中、8 个页面），迁移成本远低于旧草案估计；这是 self 架构重构中唯一不可用低风险方式替代的能力包（文件式路由 + 类型安全 + 按路由拆包 + intent 预加载） |
| D2 | **样式保留 MUI 单一基座，不引入 Tailwind**；吸收 self 的 token 化 + 主题预设/取色器 | rev 有运行时自定义主题、用户 CSS 注入、背景图等产品化定制，Tailwind 化是最大回归面；self 自己也是 MUI 组件 + Tailwind 布局混写、带 preflight 补丁的"双样式税" |
| D3 | **状态保留 rev 的 SWR + AppStore reducer + 事件总线 + mutate 漏斗，不引入 Zustand** | rev 的 ownership 模型（contract/event/state/intent/command）比 self 的 11 个 store 更收敛；self 的 store 碎片化、持久化后端派生数据、store→page 反向依赖都是反模式 |
| D4 | **契约、表格、组件基座、工具链不替换** | rev 的 specta 生成契约、自研虚拟连接表、base 组件、ESLint/knip/vitest 门禁均强于 self；self 应用层是手写 invoke + 全局 d.ts、零前端测试 |

### 工作量与阶段

| 阶段 | 内容 | 估算（1 人日 ≈ 6h） | 决策门 |
| --- | --- | --- | --- |
| Phase 0 | 基线治理、度量、ADR、文件清单 | 1–2 人日 | — |
| Phase 1 | 路由层重构（TanStack Router + route/page/config 分层 + 拆包/预加载） | 4–7 人日 | **G1 条件 Go** |
| Phase 2 | 设计 token + 主题预设/取色器（纯前端） | 4–6 人日 | G2 |
| Phase 3 | Provider/状态边界收敛 + 依赖方向 lint | 3–5 人日 | G3 |
| Phase 4 | 组件/测试/CI/文档收口 | 3–5 人日 | G4 |
| **合计** | **推荐主路径** | **15–25 人日** | — |
| 可选 | Tailwind 设计系统 POC（默认不做，见 §6） | 10–20 人日 | G5 |

### 对旧草案的三处事实校正（本轮实测）

1. **self 应用层并没有 tauri-specta / 生成 bindings**：74 个命令全是 `invoke<T>` 手写包装（`src/services/cmds.ts:1-427`），类型是全局手写 `src/services/types.d.ts`（239 行）；specta 只存在于未合并分支 `62fd7402`（2026-04-18）。唯一生成物在插件层（ts-rs → `guest-js/bindings/`）。**所以"迁契约"这个方向必须反向：保留 rev 的生成契约。**
2. **"self 有 64 个路由文件"不实**：self 实际 `src/routes/` 只有 9 个文件（8 个 12 行页面壳 + `__root.tsx`），`routeTree.gen.ts` 仅 210 行；且 TanStack Router 的 `validateSearch`/`loader`/`beforeLoad`/`errorComponent`/`pendingComponent` 全部未使用。**self 的路由优点是骨架和拆分方式，不是"能力用满"。**
3. **rev 的 react-router 足迹很小**：仅 9 个文件 import、路由表 `_routers.tsx` 18 行、`useNavigate` 等 12 处；旧草案"64 个路由文件、大量页面重写"的判断不成立于 rev。**路由迁移是 4–7 人日级工程，不是 XL。**

### 硬约束（任何 Phase 都不能违反）

1. 保留 IPC 契约流水线：`bindings.ts`（生成物，92 commands）→ `cmds.ts`（80 包装）→ hooks；`invoke`/`listen`/`emit` 的 ESLint 边界不放宽（`eslint.config.ts:15-99`、`scripts/check-architecture.mjs:6-33`）。
2. 保留「无导航 loading」原则：上游 `e63b8e6e`（2026-07-20）刻意移除路由 lazy + idle 预热（净 −216 行），本迁移不得回退成页面切换闪烁；加载策略必须用预取 + pending 门槛证明不劣化（§5 R3、§7.3）。
3. 保留 14 locale × 10 namespace i18n 与生成 key 类型；新增文案必须全量补齐。
4. 保留 `local` 的 8 个 macOS 窗口/标题栏提交（`1ba3acb8`、`6d86e1ce`、`4a675a74`、`f85b5d21`、`bfa8082f`、`7822e8e2`、`a4bb8bcb`、`0999ac47`）——迁移分支基于 `local`，丢一个都是功能回归。
5. 不碰上游高 churn 文件与后端冻结区：`services/cmds.ts`、`services/bindings.ts`、`types/generated/**`、`locales/**`、`src-tauri/{config,core,crates}/**`（§8.3）。
6. 不在主工作树或其它并行工作分支上操作；本分支在独立 worktree 进行。

---

## 1. 背景、目标与非目标

### 1.1 为什么做

rev 前端在 2026-07~10 已经历三次自我重构：`e63b8e6e`（去路由 lazy/导航 loading）、`4ed47470`（查询状态所有权收敛）、`69b76cc6`（contract flow：单事件总线 + app store + mutate 漏斗 + invoke 门禁）。这说明 rev 的**数据/事件层已相当成熟**，但**表现层结构**仍是 2023 年的形态：

- 路由是导航的副产物：`_routers.tsx:6-17` 用 `navItems.map` 生成路由；页面全 eager import（`_navigation.tsx:21-28`）。
- 新增一个页面要同时改 6 处：页面文件、`_navigation-meta.ts`、`_navigation.tsx`（import + 条目 + 图标）、14 份 `layout.json`、`i18n:types` 生成、可能的 `STARTUP_LANGUAGE_SECTIONS`（`services/i18n.ts:85`）。
- `pages/` 同时承担"路由元数据 + 导航配置 + 主题常量 + 页面组件"四种职责，导致 4 处 `components → pages` 反向依赖（`layout-sidebar.tsx:10-11`、`sysproxy-privilege-dialog.tsx:6`、`setting-verge-basic.tsx:9`、`theme-viewer.tsx:24`）。
- 样式无 token 层：`sx` 707 处/99 文件、`styled()` 42、SCSS 4 文件/453 行、硬编码 hex 112 处；主题只有 palette 一层，间距/圆角/阴影/层级没有语义。

self 的分叉时间早（1.6.x），但 2025-06 起做了一轮完整的前端架构重构，其**骨架**（文件式路由、route/page 分层、设计 token 桥、基础组件纪律）正是 rev 表现层缺的那一块。因此本分支的定位是：**用 self 的表现层骨架，重写 rev 的表现层结构，数据/契约/质量体系保持 rev。**

### 1.2 目标（可验证）

1. 路由层：文件式、类型安全、按路由拆包、intent 预加载；新增页面从 6 步降到 3 步（route 文件 + 页面组件 + i18n key）。
2. 分层：`app/`（组合根）→ `routes/`（薄壳）→ `pages/`（页面组合）→ `components/<domain>/` → `services/`（契约/查询/事件）单向依赖，无反向 import。
3. 设计 token：语义 token 成为样式的唯一入口；主题预设/取色器可复用；用户自定义主题能力零回归。
4. 状态边界：`src/AGENTS.md` 五条 ownership 不变；`AppDataProvider` 的 6 个 context 收敛为领域查询 + 1~2 个跨域 context。
5. 质量：现有门禁全绿 + 新增 3 类门禁（依赖方向、bundle 预算、导航性能基线）+ jsdom 路由/主题测试。
6. 上游可维护：迁移 diff 集中在路由/样式/状态适配层；每个 Phase 结束做一次 `rebase origin/dev` 演练。

### 1.3 非目标（本分支明确不做）

- 不做后端/service/内核/进程模型迁移（self 的 service、PSK、process_supervisor 在 rev 侧更弱或更强，均不在本分支）。
- 不迁 self 的功能项（规则启停、连接过滤、更新渠道、内核版本管理器等）；这些另有功能迁移草案（见 `self-to-rev-migration-plan.md`，本地未入库），本计划只处理"承载这些功能的前端结构"。
- 不替换 MUI、不引入 Tailwind（除非 G5 产品级决策）、不引入 Zustand/TanStack Query/TanStack Table。
- 不建议、不执行整体 merge / cherry-pick self 历史（两仓 merge-base 在 2021 年，API 代际差 2 年，冲突率极高）；所有结构迁移按"按语义重写 + 标注来源"进行。

### 1.4 与其它工作的边界

- 主工作树可能并行承载其它前端功能分支（例如 `migrate/connections-filter`、`migrate/rules-search`、`migrate/hygiene`）。本计划与它们**文件零重叠**（不碰 `src/components/connection/**`、`src/utils/connection-filter*`、`src/pages/connections.tsx`、规则搜索相关文件的内容）；合并顺序任意，但 Phase 1 会新建 `src/routes/connections.tsx`、`src/routes/rules.tsx` 薄壳，与这些分支不冲突。
- 后端性能优化（`perf/phase0-10`、`src-tauri/**`）是冻结区，本分支一行不改。

---

## 2. 两端架构对比（证据）

### 2.1 对比总表

| 维度 | clash-verge-rev（local） | clash-verge-self（dev/v2.3.2） | 本计划结论 |
| --- | --- | --- | --- |
| 规模 | 415 个 src 文件 / 纯代码 ≈46.7k 行 | 165 个文件 / ≈25.5k 行 | — |
| 路由 | react-router 8；路由表 18 行；8 页全 eager；无 loader/lazy/errorElement；react-router 仅 9 文件/12 处 hook | TanStack Router 1.168 文件式；9 个 12 行壳 + `routeTree.gen.ts` 210 行；`autoCodeSplitting`；零 loader/validateSearch/pending/error 使用；导航数组手写在 `__root.tsx:26-83` | **取 self 骨架，补 self 没做好的能力**（类型化 search/静态数据/错误边界） |
| 导航 | `_navigation-meta.ts`(25) + `_navigation.tsx`(78) + `pages/_layout/hooks/use-nav-menu-order.ts`；顺序持久化在 `verge.menu_order` | 导航数组与图标内联在 `__root.tsx`；idle 预载全部 8 路由（`sidebar.tsx:34-54`） | **单一事实源移到 `config/navigation.ts`，route catalog 测试防漂移** |
| 状态 | SWR（`query-client.ts:35-125`，20 处 useQuery/18 key）+ `AppDataProvider` 6 context（`app-data-context.ts:42-52`）+ `AppStore` reducer 3 context + foxact 2 context；ownership 写入 `src/AGENTS.md` | 11 个 Zustand store（7 persist）+ SWR（21 处）+ WS subscription；profiles/verge/rules 走 store；跨层依赖 3 处 | **保留 rev；不迁 Zustand** |
| 数据层 | specta → `bindings.ts`(1060 行/92 commands) → `cmds.ts`(514/80) → hooks；`invoke/listen/emit` ESLint 硬禁；mutate 漏斗串行化 | 74 个手写 `invoke` + 全局 `types.d.ts`；无统一错误包装；services→components 3 处倒置 | **保留 rev；这是 rev 的核心资产** |
| 样式 | MUI 9 + Emotion；`sx` 707/99 文件、`styled()` 42、SCSS 453 行；主题 `_theme.tsx`(32) + `use-custom-theme.ts`(331)；16 个 CSS 变量 + 用户 CSS 注入；硬编码 hex 112 | MUI cssVariables + Tailwind 4（`@theme inline` 279 行桥接 + preflight 37 行补丁）；`sx` 338/54 文件 + className 68 文件；主题预设 6 套 + 明暗双套 | **取 self 的 token 思路与主题预设，不取 Tailwind** |
| 组件 | `components/` 124 文件/30.4k 行；base 18 文件/1461 行（BaseDialog/BasePage/BaseSearchBox/虚拟列表等） | `components/` 96 文件/18.6k 行；base 20 文件/1650 行 | **基座等价，不做整体迁移；只补差异清单** |
| 契约/i18n | 14 locale × 10 namespace + 生成 key 类型；contract CI parity | 4 locale 单层；无生成 key 类型 | 保留 rev |
| 工具链 | Biome format + ESLint 10 flat + TS 6 + Vite 8 + knip(cycles) + vitest（11 文件/1087 行，node 环境）+ husky/cargo-make | ESLint + Biome + Prettier 三套；tsr CLI；无前端测试（AGENTS.md:40）；CI 仅 lint+build | 保留 rev；只新增 tanstack router 插件与 codegen |
| 性能 | 无路由拆包；虚拟化成熟（连接表/代理组/编辑器）；monaco 动态加载；React Compiler 仅 lint 未启用 | 全页面 lazy + idle 全量预载（互相抵消）；两套虚拟化库；monaco 动态加载 | **取"按路由拆包 + intent 预载"，拒绝"idle 全量预载"** |
| 文档 | AGENTS.md/CONTRIBUTING/README 多语言；无前端架构文档 | `docs/frontend-ui-analysis.md`（598 行，信息架构/交互/约束）质量高 | 新增 `docs/frontend-architecture.md` + ADR |

### 2.2 rev 必须保留的资产（10 条）

1. **IPC 契约流水线**：`bindings.ts` 为唯一 invoke 出口、`cmds.ts` 语义化包装、`gen-contract --check` + contract-parity CI（`scripts/gen-contract.mjs:19-32`）。
2. **事件总线唯一性**：`services/bus/**` 是唯一 `listen/emit` 点（`src/AGENTS.md`、ESLint 边界）。
3. **状态读序**：`AppStore` reducer + `store-reads` 的"旧回复不得覆盖新状态"边界（`store-reads.ts`）。
4. **意图漏斗**：`services/mutate.ts:29-63`（同 id 串行、busy 非成功、成功副作用）。
5. **通知体系**：`notice-service.ts`(557) + `notice-handlers.ts` 的 `NoticeStatus` 穷举 Record + code→i18n key 映射。
6. **i18n 资产**：14 locale × 10 namespace、`import.meta.glob` 懒加载、`TranslationKey` 类型贯穿。
7. **MUI 产品化主题**：运行时 `createTheme`、16 个 CSS 变量、用户自定义 CSS 注入（`@scope`）、背景图/透明度、系统暗色跟随。
8. **基础组件**：BaseDialog（28 处使用）/BasePage/BaseSearchBox/虚拟列表/sticky 列表/MonacoEditor/ErrorBoundary。
9. **本地窗口层**：`use-window-maximized.ts`、`window-controller.tsx`、`window-drag.ts`、`enable_system_titlebar`（local 独有 8 提交）。
10. **质量与测量设施**：ESLint IPC 门禁、knip（cycles/duplicates/exports）、vitest、`scripts/perf` 重放工具。

### 2.3 self 真正的优点（去魅后 6 条）

1. **route/page 分层**：`routes/` 是 12 行薄壳，`pages/` 是页面组合，职责清晰（`src/routes/settings.tsx:1-12`）。这是 rev 最缺的一层。
2. **文件即路由 + 类型安全**：`<Link to>` 与 `router.navigate({to})` 的字符串由生成类型校验（`routeTree.gen.ts` + `router.ts:7-11`）。
3. **设计 token 桥接思路**：用 `@theme inline` 把 MUI CSS 变量映射为语义 token（`src/index.css:14-279`），使主题/暗色/组件样式有单一来源 —— **思路可借鉴，Tailwind 实现不引入**。
4. **主题产品化**：6 套预设 + 明暗双套 + 原生取色器（`pages/_theme.tsx:43-193`、`stores/themeStore.ts`、`setting/mods/theme-color-select.tsx`）。
5. **基础组件纪律**：BasePage/BaseDialog/BaseFieldset/BaseEmpty/BaseLoading 的骨架化复用（base 20 组件/1650 行，BaseDialog 71 处使用）。
6. **文档习惯**：`docs/frontend-ui-analysis.md` 把信息架构/交互/设计约束写成可执行规格。

### 2.4 self 的代价/反模式（8 条，迁移时不得复制）

1. **手写契约**：74 个手写 invoke + 全局 d.ts，命令/参数改名编译期不报错；services 反向 import components（`cmds.ts:5`、`api.ts:8`、`profilesStore.ts:5`）。
2. **零前端测试**：24k 行前端无单测/组件测/路由测，CI 只 lint+build（`AGENTS.md:40`、`check.yml:123-129`）。
3. **双样式税**：MUI + Tailwind 混写，preflight 需 37 行补丁修 OutlinedInput legend（`index.css:471-507`）、Portal container hack；历史 fix 证明升级即回归（`0cce9d23`）。
4. **路由能力只用了皮**：无 validateSearch/loader/beforeLoad/error/pending；`router.ts` 11 行无默认错误/加载组件；`/` 与 `/proxies` 重复注册同一页面（`routes/index.tsx:4`、`routes/proxies.tsx:4`）；后端导航传未校验字符串（`pages/_layout.tsx:112-119`）。
5. **加载策略互相抵消**：route 壳里 `React.lazy` + 插件 `autoCodeSplitting` 双拆包；idle 时预载**全部** 8 路由（`sidebar.tsx:34-54`），又自研 visitedPaths 遮罩（`_layout.tsx:196-210`）——复杂度高、收益低。
6. **状态碎片化**：11 个 store（7 个 persist 无迁移策略），为 UI 微状态建 store（appUpdating 14 行/loadingCache/windowSize）；profilesStore 持久化后端派生数据（双真源）。
7. **三套 lint/format**：ESLint + Biome + Prettier 并存，生成物三处 ignore，无统一 format 命令。
8. **导航元数据与路由定义分离**：手写数组在 `__root.tsx:26-83`，新增页面要同时改 route 文件与数组。

### 2.5 关键裁决点：lazy vs eager 的正面冲突

- self：文件式路由默认按路由拆包 + 全页面 `React.lazy`（`routes/*.tsx:4`）+ idle 预载全部。
- rev：`e63b8e6e perf(frontend): eliminate navigation loading states`（2026-07-20，净 −216 行）**刻意**把路由改回 eager，理由就是消除导航 loading 闪烁。

**裁决**：本计划站在 rev 这边定义验收目标（无 loading 闪烁），但用 self 提供的机制（按路由拆包 + `defaultPreload: 'intent'` + `pendingMs/pendingMinMs` 门槛）实现。若 G1 不达标 → 回退"保留 react-router、只做 route/page/config 分层 + data-router lazy"的 B 方案（§4.2），而不是牺牲体验硬上。

---

## 3. 目标架构（融合后的样子）

### 3.1 目录结构

```text
src/
├── app/                        # 【新增/迁移】组合根，不含 UI 细节
│   ├── main.tsx                #   原 src/main.tsx（bootstrap/初始化顺序保持）
│   ├── router.tsx              #   createRouter(routeTree, options)，唯一路由实例
│   ├── layout.tsx              #   原 pages/_layout.tsx（应用壳/Provider/窗口层）
│   └── providers.tsx           #   ComposeContextProvider 组合（SWR/AppStore/Theme/Update）
├── routes/                     # 【新增】文件式路由薄壳：只做路由声明，不写业务
│   ├── __root.tsx              #   root route：Layout + notFound + errorComponent
│   ├── index.tsx               #   /
│   ├── proxies.tsx             #   /proxies
│   ├── profiles.tsx            #   /profile（保留现有路径，兼容深链/后端导航）
│   ├── connections.tsx
│   ├── rules.tsx
│   ├── logs.tsx
│   ├── unlock.tsx
│   └── settings.tsx
├── pages/                      # 保留：页面级组合组件（不做路由声明、不直接 invoke）
├── config/                     # 【新增】静态配置单一事实源
│   ├── navigation.ts           #   id/path/labelKey/icon/默认顺序；替代 _navigation*.tsx
│   └── theme.ts                #   原 pages/_theme.tsx 的默认 token/预设
├── components/{base,layout,home,profile,proxy,connection,rule,log,setting,shared}/
├── services/                   # 契约/查询/事件/通知/mutate（边界不变）
│   ├── bindings.ts  cmds.ts  query-client.ts  mutate.ts  states.ts  ...
│   └── bus/                    # 唯一 listen/emit 点（不变）
├── store/                      # AppStore（不变）
├── hooks/ utils/ types/ locales/
└── routeTree.gen.ts            # 生成物（提交入库、三处 ignore 与 self 一致）
```

**分层规则（新增 lint 强制）**：

| 层 | 允许 import | 禁止 import |
| --- | --- | --- |
| `routes/` | `pages/`、`config/`、`components/base` | `services/`、`store/`（路由层保持纯声明） |
| `pages/` | `components/`、`hooks/`、`services/`、`config/` | `routes/` |
| `components/` | `components/`、`hooks/`、`utils/`、`services/`、`config/` | `pages/`、`routes/` |
| `services/` | `services/`、`types/`、`utils/` | `components/`、`pages/`、`routes/` |
| `app/` | 全部（唯一允许组合根跨层） | — |

### 3.2 路由层约定（融合 self 骨架 + rev 教训 + self 没做好的能力）

```ts
// src/routes/settings.tsx —— 薄壳示例（约 10 行）
import { createFileRoute } from '@tanstack/react-router'
import { BaseErrorBoundary } from '@/components/base'
import SettingPage from '@/pages/settings'

export const Route = createFileRoute('/settings')({
  component: SettingPage,
  staticData: { navId: 'settings' },        // 导航单一事实源的锚点（self 无）
  errorComponent: BaseErrorBoundary,        // 每路由错误边界（self 无）
})
```

约定：

1. **route 文件不写业务逻辑**，只做 `component` / `staticData` / `errorComponent` / （未来）`validateSearch`。
2. **不做手动 `React.lazy`**：交给 `@tanstack/router-plugin` 的 `autoCodeSplitting`（self 的双拆包是反例）。
3. `router.tsx` 配置：`defaultPreload: 'intent'`、`defaultPreloadDelay: 0`、`defaultPreloadStaleTime` 适当、`defaultPendingMs: 200`、`pendingMinMs: 300`（先给基线值，Phase 1 实测调参）；**不配置 idle 全量预载**。
4. 页面级数据仍由 rev 的 SWR/WS 获取，**不引入 route loader**，避免与 query cache 形成第二数据源（保留 `src/AGENTS.md` 的 query ownership）。
5. `home` 的卡片级 lazy + `preloadHomePageCards` 保持不动（已被 `e63b8e6e` 验证过不闪）。
6. 根路由 `__root.tsx` 承载 `Layout`、`notFoundComponent`、`errorComponent`、以及全局 `NoticeManager` 的挂载位置（从 `_layout.tsx` 迁移时保持 DOM 顺序）。

### 3.3 导航单一事实源

```ts
// src/config/navigation.ts —— 唯一事实源
export const NAV_ITEMS = [
  { id: 'home',        path: '/',           labelKey: 'layout.components.navigation.tabs.home',        icon: [HomeOutlinedIcon, HomeSvg] },
  { id: 'proxies',     path: '/proxies',    labelKey: '...tabs.proxies',     icon: [...] },
  // ... 8 项
] as const
```

- `pages/_navigation-meta.ts`、`pages/_navigation.tsx`、`components/layout/layout-sidebar.tsx:10-11`、`components/setting/setting-verge-basic.tsx:9` 全部改为 import `config/navigation.ts`。
- **兼容**：`verge.menu_order` 现存值按 `path` 存储（`src-tauri/src/config/verge.rs:64`、`layout-sidebar.tsx:40-61`），`config/navigation.ts` 继续以 `path` 作为 order key，存量的用户顺序配置零迁移。
- **后端导航类型化**：`notice-handlers.ts` 里 `navigate('/profile')` 等字符串改为 `navigateToRoute('profiles')` 的穷举映射；未知路由 fallback 到首页并 `console.warn`（self 的错误是直接吃未校验字符串，`pages/_layout.tsx:112-119`）。
- **防漂移测试**：`routes/__route-catalog.test.ts` 断言 `routeTree` 的叶子路径集合 == `NAV_ITEMS.path` 集合（排除隐藏路由白名单），且每个 `staticData.navId` 都能在 `NAV_ITEMS` 找到 —— 这是 self 没有、rev 需要的护栏。

### 3.4 样式/主题层（MUI 单一基座 + 语义 token）

- **不引入 Tailwind**。保留 `sx`/`styled`/SCSS 的现有用法，"迁移"发生在 token 与组织层：
  1. 新增 `src/config/theme/tokens.ts`：把 `_theme.tsx` 的 11 项颜色扩展为语义 token（`color.surface`、`color.text.secondary`、`color.status.*`、`space.*`、`radius.*`、`shadow.*`、`zIndex.*`、`overlay.*`）。
  2. 在 `use-custom-theme.ts` 现有 16 个 CSS 变量基础上，统一由 token 生成 CSS 变量（复用其 `:root` 注入路径，`use-custom-theme.ts:209-244`）。
  3. 组件样式只经 token 取值；新代码禁止硬编码 hex，存量按域逐步替换（Phase 2 目标：迁移域内 hex 减少 ≥50%）。
  4. 保留用户自定义 CSS 注入、背景图、透明度、系统暗色跟随等全部产品能力（`use-custom-theme.ts:246-314`），回归清单见 §7.4。
- **主题预设/取色器**（吸收 self 产品化）：`config/theme.ts` 提供 6 套预设（明暗各一套映射到现有 `theme_setting`）；`theme-viewer` 增加预设下拉 + 原生 `<input type="color">` 取色（self `theme-color-select.tsx` 思路），纯前端、不改后端字段。
- **明暗双套主题配置**（self `light_theme_setting`/`dark_theme_setting`）依赖 `IVerge` 新增字段与 `effect registry`，属后端契约变更，本分支不做；作为 Phase 5 候选在功能迁移草案中排期（避免本分支触碰契约生成物）。
- 可选 POC（G2 内评估、不默认启用）：MUI `cssVariables: true`。评估点：能否简化自定义 CSS 注入的 `!important` 修补；若收益不明确则不做。

### 3.5 状态/数据层（保持 rev ownership，微调结构）

- **不变**：`services/bus` 唯一事件源；`AppStore` reducer + `store-reads` 读序；`services/mutate.ts` 意图漏斗；`query-client.ts` 查询层；`cmds.ts` 命令边界。
- **变**：`AppDataProvider`（234 行、6 context、5 个 SWR 读、6 层嵌套，`app-data-provider.tsx:219-233`）拆为：
  - `hooks/use-proxy-view.ts`、`use-rules.ts`、`use-clash-config.ts`、`use-system-proxy.ts` 等领域查询 hook（内部继续用 `query-client`，key 不变）；
  - `providers/app-data-context.ts` 只保留跨域只读快照（如 `Refreshers`）与必要 context，嵌套从 6 层降到 1~2 层；
  - 所有 key/mutate 语义保持不变，先加测试再拆（`store-reads.test.ts` 的边界测试扩展到查询层）。
- **不采纳** self 的 Zustand 与"把后端派生数据持久化"；persist 只允许 UI 偏好（若未来新增，须 version+migrate+敏感字段 allowlist，参照 self `vergeStore.ts:16-38` 白名单思路）。
- `pages/_theme.tsx`、`pages/_navigation-meta.ts` 移入 `config/`，消除 4 处 `components → pages` 反向依赖（`layout-sidebar.tsx:10-11`、`sysproxy-privilege-dialog.tsx:6`、`setting-verge-basic.tsx:9`、`theme-viewer.tsx:24`）。

### 3.6 组件层

- 不做整体迁移。Phase 0 产出 `components/base` 差异清单（rev 18 个 vs self 20 个），只补确认有用的原语（候选：`BaseFieldset` 的字段分组约定、`BaseLoading` 语义、`Marquee` 等；**BaseDialog/BasePage/BaseSearchBox/虚拟列表 rev 已有，不重复造**）。
- 页面 monolith 拆分只在 Phase 4 做**机会性**处理（`profiles.tsx` 987 行属上游 churn 区，本分支不改其内部；只允许把页面 hooks 抽到 `pages/_<page>/hooks/`，不改变行为）。
- 组件样式统一走 §3.4 的 token。

### 3.7 质量体系扩展

| 新增门禁 | 实现 | 拦截什么 |
| --- | --- | --- |
| 依赖方向 lint | `eslint-plugin-import-x` 增加 `no-restricted-paths`（按 §3.1 分层），或扩展 `scripts/check-architecture.mjs` 增加 `layers` gate | 反向 import、route 层写业务 |
| 路由目录一致性 | vitest：`routes/__route-catalog.test.ts` | 路由与导航漂移、重复 path |
| bundle 预算 | `scripts/check-bundle-budget.mjs`：解析 `vite build` 产物，初始 JS gzip ≤ 基线 × 1.02，单路由 chunk 记录 | 路由拆包失效/大依赖回潮 |
| 导航性能基线 | 扩展 `scripts/perf`：路由切换耗时采样 + 冷/热导航 p95 | loading 闪烁回归 |
| i18n 完整性 | 把 `pnpm i18n:check`（当前默认仅报告）接入 CI 的 `--check` 模式 | 14 locale key 漂移 |
| jsdom 测试 | vitest 增加 projects/环境匹配（`src/**/*.test.tsx`，jsdom），CI 时间预算 +30s | 路由/主题/导航回归 |

---

## 4. 迁移路线图

### 4.1 阶段总览

```text
Phase 0（1–2d）基线治理
  ├─ 绿色基线 + 度量采集 + ADR-0001
  └─ 文件映射/差异清单（base 组件、churn 文件）
        │
Phase 1（4–7d）路由层重构                         ◀── G1 条件 Go
  ├─ R1 TanStack Router PoC（settings+proxies 两路由）
  ├─ R2 route/page/config 分层 + 导航单一事实源
  ├─ R3 拆包/预加载/无闪加载
  └─ R4 后端导航类型化
        │
Phase 2（4–6d）设计 token 与主题
  ├─ S1 语义 token 层
  ├─ S2 主题预设 + 取色器
  └─ S3 hex/样式债清理（按域）
        │                                    ◀── G2（含可选 MUI cssVariables POC）
Phase 3（3–5d）状态边界收敛
  ├─ T1 AppDataProvider → 领域查询 hooks
  └─ T2 依赖方向 lint + 反向 import 清理   ◀── G3
        │
Phase 4（3–5d）收口
  ├─ T3 测试扩展（jsdom + 路由/主题/导航）
  ├─ T4 CI：bundle budget + 导航性能基线
  └─ T5 文档（architecture.md + ADR-0002/0003 + AGENTS 更新）  ◀── G4
        │
（G5 可选）Tailwind 设计系统 POC —— 默认不做
```

### 4.2 决策门

| 门 | 位置 | 通过条件 | 不通过时的动作 |
| --- | --- | --- | --- |
| **G1** | Phase 1 PoC 后 | ① 门禁全绿（typecheck/lint/format/test/knip/arch/i18n）② route catalog 测试通过 ③ 2 路由 PoC 冷/热导航无 loading 闪烁（录屏证据）④ 初始 JS 主 chunk 相对基线下降 ≥15% 且总初始体积不增加 ⑤ 依赖新增 ≤3 个（react-router 移除后净增可控）⑥ 手工 smoke 无回归 | 回退 **B 方案**：保留 react-router 8 data-router，只做 route/page/config 分层 + 路由级 `lazy` + hover 预取（成本 2–3 人日），并在 ADR-0001 记录否决理由 |
| **G2** | Phase 2 后 | 主题预设/取色器与用户自定义主题/背景图/暗色跟随零回归；token 覆盖率（迁移域）≥80%；MUI cssVariables POC 结论落地（做/不做有记录） | 只保留 token 层，预设/取色器延后；cssVariables 不做 |
| **G3** | Phase 3 后 | 依赖方向 lint 0 违规；provider 嵌套 ≤2；通知/导航/更新/窗口行为无回归；相关 vitest 通过 | 拆分为更小 PR，先合 lint 规则，provider 拆分延后 |
| **G4** | Phase 4 后 | 新增门禁接入 CI 且全绿；`rebase origin/dev` 演练无冲突（或冲突仅限已知 churn 区）；文档评审通过 | 门禁先以 `--warn` 运行一个迭代再转 error |

### 4.3 排期与工作量汇总

| Phase | 卡片 | 估算 | 前置 |
| --- | --- | --- | --- |
| 0 | M0 | 1–2d | 分支已建（本文件所在分支） |
| 1 | R1–R4 | 4–7d | M0 |
| 2 | S1–S3 | 4–6d | G1（路由结构稳定后再动样式，避免双重 diff） |
| 3 | T1–T2 | 3–5d | G1（与 Phase 2 可并行，文件不重叠） |
| 4 | T3–T5 | 3–5d | G2/G3 |
| 合计 | | **15–25 人日** | |
| 可选 | Tailwind POC | 10–20d | G5 产品决策 |

建议节奏：Phase 1 先做 PoC 决策（2–3 天）再全量；Phase 2/3 由第二人并行；每个 Phase 独立 PR + 独立回滚。

---

## 5. 迁移卡片（逐项执行清单）

> 每张卡片的 `self 证据` 用于实现时对照参考（`git -C clash-verge-self show <hash>`），**不是** cherry-pick 来源。

### M0 基线治理与度量 ✅（2026-10-19 已完成，见 §12）

- **目标**：迁移前把"可对比的基线"固定下来。
- **步骤**：
  1. 在分支 worktree 跑全量门禁：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm knip:check && pnpm arch:check listen emit invoke`（无需 Rust 即可跑的项）；记录耗时与结果。
  2. 采集性能/体积基线：`pnpm web:build` 后记录 `dist/index.html` 引用的 chunk 列表、各 chunk 原始/gzip 大小、初始 JS 总量；记录 8 条路由冷启动/切换耗时（人工 + `scripts/perf` 扩展）。
  3. 产出 `docs/adr/0001-router-choice.md`（记录 D1/D2/D3 裁决与本计划依据）。
  4. 产出 base 组件差异清单与 `churn-file-freeze` 列表（本文件 §8.3）。
  5. 在 `docs/frontend-architecture.md` 落目标架构（§3 内容精炼版），后续 PR 引用。
- **验收**：基线数据可复现、写入文档；`git status` 干净。
- **工作量**：1–2d。**风险**：低。

### R1 TanStack Router PoC → 全量迁移

- **self 证据**：`4812e488`（2025-06-05，replace react-router with tanstack router，23 files +6584/−3498）；`src/router.ts:1-11`；`vite.config.ts:37-38`；`tsr.config.json`；`routeTree.gen.ts`（210 行，提交入库）。
- **rev 现状**：`_routers.tsx:6-17`（18 行）、`_navigation.tsx:21-28`（8 页 eager import）、react-router 使用仅 9 文件/12 处 hook；react-router 8 的 lazy/loader 未用。
- **目标**：`@tanstack/react-router` + `@tanstack/router-plugin` 接管路由；`app/router.tsx` 唯一实例；`routes/` 9 个薄壳；删除 `pages/_routers.tsx`。
- **步骤**：
  1. PoC 只迁 `settings` + `proxies` 两条路由（其余暂时仍走 react-router 的方案不可行——两个 Router 不共存，PoC 在子分支做完整替换的 2 路由版本，先在本地验证后继续）。
  2. 安装依赖：`@tanstack/react-router`、`@tanstack/router-plugin`（devDep）；加 `tsr.config.json`（`routesDirectory: './routes'`、`generatedRouteTree: './routeTree.gen.ts'`）；vite 插件 `tanstackRouter({ target: 'react', autoCodeSplitting: true })`；`package.json` 加 `generate-routes`/`watch-routes`。
  3. 迁移 9 个 react-router 命中文件：`main.tsx`（`RouterProvider`）、`_layout.tsx`（`Outlet`/`useNavigate`）、`layout-item.tsx`（`useMatch`→`useMatchRoute`、`useNavigate`）、`home/*` 3 个卡片、`proxy-empty-state.tsx`、`profiles.tsx`（`useNavigate`）；替换为 TanStack API（`useNavigate` 签名不同，`navigate({to})`）。
  4. 删除 react-router 依赖与 `_routers.tsx`；`_navigation.tsx` 的 Component 注册随之删除（见 R2）。
  5. 处理 routeTree.gen.ts 的 lint/format/knip 豁免（eslint/prettier/biome/knip 四处；self 有前两处先例）。
- **验收**：类型检查/lint/knip 通过；8 条路由可达；浏览器前进/后退、深链、后端 `navigate_to_route`（`_layout.tsx` 的 `useEventBus` 路径）全部正常；`pnpm test` 通过。
- **风险**：中。loading 闪烁（见 R3）；`useNavigate` 调用签名差异导致遗漏（用 grep 清单收尾）；上游 churn（confine diff）。
- **回滚**：单 commit revert（恢复 react-router 依赖与 `_routers.tsx`）。
- **工作量**：3–5d（含 PoC）。

### R2 route/page/config 分层 + 导航单一事实源

- **self 证据**：`routes/*.tsx` 12 行壳 + `pages/` 组合；但导航数组手写在 `__root.tsx:26-83`（反例）。
- **rev 现状**：`_navigation-meta.ts`(25) + `_navigation.tsx`(78)；`layout-sidebar.tsx:10-11` 反向 import；新增页面 6 步（§1.1）。
- **步骤**：
  1. 新建 `src/config/navigation.ts`：`NAV_ITEMS`（id/path/labelKey/icon/默认顺序），从 `_navigation-meta.ts` + `_navigation.tsx` 合并。
  2. `layout-sidebar.tsx`、`setting-verge-basic.tsx`、`use-nav-menu-order.ts` 改接 `NAV_ITEMS`；`verge.menu_order` 仍以 path 为 key（零迁移）。
  3. 删除 `_navigation-meta.ts`、`_navigation.tsx`；`routes/*.tsx` 通过 `staticData.navId` 关联。
  4. `pages/_theme.tsx` → `config/theme.ts`；修 `theme-viewer.tsx:24` 反向依赖。
  5. 新增 route catalog 测试（§3.3）；同步更新 `src/AGENTS.md` 的路由/导航 ownership 段落。
- **验收**：新增页面步骤降为 3 步验证（用一个临时测试页演练后删除）；导航顺序持久化/拖拽排序/14 locale label 全部正常；无 `components → pages` import。
- **风险**：低–中（导航是产品行为，需回归拖拽排序）。
- **工作量**：1–2d。

### R3 按路由拆包 + intent 预加载 + 无闪加载

- **self 证据**：`vite.config.ts:38` autoCodeSplitting；`1da1d991`（2026-04-08，路由过渡+预加载，28 files +487/−213）；但 self 双拆包/idle 全量预载/自研遮罩是反例（`sidebar.tsx:34-54`、`_layout.tsx:196-210`）。
- **rev 约束**：`e63b8e6e` 的无导航 loading 目标。
- **步骤**：
  1. 关闭手动 lazy（route 文件静态 import 页面，交给插件拆包）；`home` 卡片 lazy 保持。
  2. `router.tsx` 配 `defaultPreload: 'intent'`、`defaultPreloadDelay: 0`、`defaultPendingMs: 200`、`pendingMinMs: 300`（Phase 1 实测调优，写入 ADR）。
  3. 不引入 idle 全量预载；如需首屏后预热，只预热"用户最可能去的 1 条"或不做（用数据决定）。
  4. 删除/替换任何自研 loading 遮罩逻辑（rev 现有 `useLoadingOverlay` 只用于主题就绪，保留）。
- **验收**：`vite build` 产物中 8 页进入独立 chunk；初始 JS 主 chunk 相对基线 −15%；热导航 p95 < 100ms、冷导航 p95 < 200ms（本机）；20 次随机导航录屏无可见 loading 闪烁。
- **风险**：**高**（这是 G1 的核心）。缓解：PoC 先测 2 条路由；指标不达标即走 B 方案。
- **工作量**：1–2d。

### R4 后端导航类型化

- **self 证据**：`pages/_layout.tsx:112-119` 直接 `router.navigate({to: route})`（未校验字符串）；`notice-handlers` 同型问题。
- **rev 现状**：`notice-handlers.ts` 用 `navigate('/profile')`；`profiles.tsx:105` `location.state.current` 无类型校验。
- **步骤**：`config/navigation.ts` 导出 `ROUTE_BY_ID`；`notice-handlers.ts` 的路径字符串改 `navigateToRoute('profiles')`；后端 `navigate_to_route` 的 payload 走白名单映射，未知值 fallback 首页 + warn；`location.state` 增加类型守卫。
- **验收**：导入订阅成功的 toast 导航、深链导入、托盘/菜单跳转全部正常；未知路由不再白屏。
- **工作量**：0.5–1d。

### S1 语义 token 层

- **self 证据**：`src/index.css:14-279` 的 `@theme inline` 映射（MUI CSS vars → 设计 token）是思路来源；不出现在 rev 的依赖里。
- **rev 现状**：`_theme.tsx:5-32` 11 项颜色 token；`use-custom-theme.ts` 运行时 createTheme + 16 个 CSS 变量（`:209-244`）；无 space/radius/shadow/zIndex token；hex 112 处。
- **步骤**：
  1. `config/theme/tokens.ts`：语义 token（color/space/radius/shadow/zIndex/overlay/status），类型 `as const`。
  2. `use-custom-theme` 由 token 生成并注入 CSS 变量（扩展现有注入路径）；保证自定义主题（用户 theme_setting）覆盖优先级。
  3. lint/约定：新增代码禁止裸 hex（Phase 2 用 review + 后续可加自定义 eslint 规则）。
  4. 按域替换：settings/home/layout 优先（sx 密度最高：setting 231、home 137、layout 34）。
- **验收**：迁移域内 hex 减少 ≥50%；浅色/深色/用户自定义主题三态视觉 smoke 通过；用户 CSS 注入/背景图/透明度不回归。
- **风险**：中（样式回归面大）。缓解：按域小 PR；每 PR 附 before/after 截图。
- **工作量**：2–3d。

### S2 主题预设 + 取色器（纯前端）

- **self 证据**：`pages/_theme.tsx:43-193`（6 套预设）；`stores/themeStore.ts`（themeSettings/preset 识别）；`setting/mods/theme-color-select.tsx`（127 行，hex 校验 + debounce + 原生 color input）；commit `5e7e8c26`、`c2076daf`。
- **rev 现状**：`theme-viewer` 8 个 hex TextField + 字体 + CSS 注入；`IVergeTheme` 只有 `theme_setting`；`use-custom-theme.ts:150-197` 生成主题。
- **步骤**：`config/theme/presets.ts` 6 套预设 → 现有 8 个颜色 key；`theme-viewer` 加预设选择 + `ThemeColorSelect`（原生取色 + 文本 hex + debounce）；不改后端字段；i18n 14 locale 补齐。
- **验收**：预设应用/切换/重置/持久化正确；取色器与手输一致；明暗模式下预设表现正确。
- **工作量**：1–2d。**风险**：低。

### S3 样式债清理（按域、机会性）

- 目标：SCSS 453 行中可迁 sx 的分批迁；`styled()` 42 处逐步统一；硬编码明暗色（如 `layout-item.tsx:56-59`）改 token。
- 约束：**不碰**上游 churn 高文件（`profiles.tsx`、`dns-viewer.tsx`、`_layout.tsx` 等）的内部样式；只做本计划新增/触及文件。
- 工作量：1–2d（可跨迭代）。

### T1 AppDataProvider → 领域查询 hooks

- **self 证据**：按域 hooks（`use-clash`/`use-traffic-data` 等）与 SWR key 集中化（`services/swr.ts:19-42`）的思路可借鉴；其 store 持久化后端派生数据是反例。
- **rev 现状**：`app-data-context.ts:42-52` 6 context；`app-data-provider.tsx:219-233` 6 层嵌套；5 个 SWR 读。
- **步骤**：
  1. 先补测试：`store-reads.test.ts` 扩展 + query key 快照测试。
  2. 抽 `hooks/use-proxy-view.ts`、`use-rules-data.ts`、`use-clash-config.ts`、`use-system-proxy-data.ts`（内部 query key 不变）。
  3. `app-data-context.ts` 只保留跨域只读快照/refreshers；provider 嵌套 ≤2。
  4. 逐页替换消费点（页面可分批），最后删旧 context 字段。
- **验收**：所有消费页面行为不变；轮询/refresh/read 序测试通过；provider 嵌套 ≤2。
- **风险**：中（隐式 provider 顺序是契约）。缓解：先测试后拆、按页替换、保留旧导出一个迭代。
- **工作量**：2–3d。

### T2 依赖方向 lint + 反向 import 清理

- **self 证据**：self 的 3 处分层倒置是反例；rev 自己的 `src/AGENTS.md` ownership 规则可扩展为 import 边界。
- **rev 现状**：无层间 import 规则（`eslint.config.ts` 只有 `import-x/order` 与 IPC 边界）；4 处反向 import（R2 已修其中 3 类）。
- **步骤**：`eslint.config.ts` 增加 `import-x/no-restricted-paths` 分区（§3.1）；`scripts/check-architecture.mjs` 增加 `layers` gate（或并入现有 invoke/listen/emit 检查）；CI 接入；`src/AGENTS.md` 记录分层规则。
- **验收**：全仓 0 违规；故意写一个反向 import 能被拦下（测试脚本）。
- **工作量**：1–2d。**风险**：低。

### T3 测试扩展（jsdom + 关键路径）

- **self 证据**：self 零前端测试（反例）；rev 已有 11 文件/1087 行 vitest（node 环境、仅 `.test.ts`）。
- **步骤**：
  1. `vitest.config.mts` 增加 jsdom project / `environmentMatchGlobs`（`src/**/*.test.tsx` → jsdom），保持 CI 时间可控（目标 +30s 内）。
  2. 新增测试：route catalog、导航 order 解析（`use-nav-menu-order` 纯函数部分）、`navigateToRoute` 映射、token 生成、theme 预设归一化、query key 注册表。
  3. 测试文件与源码同目录 `*.test.ts(x)`，与 rev 现状一致。
- **验收**：新增测试 ≥8 文件；CI 全绿；关键地图/主题逻辑有回归网。
- **工作量**：1–2d。

### T4 CI：bundle 预算 + 导航性能基线

- **步骤**：`scripts/check-bundle-budget.mjs`（读 `dist` 产物 + 基线 JSON，超预算 fail）；`scripts/perf` 增加路由切换采样入口；CI `frontend-check.yml` 增加 `bundle-budget` step（仅在 `src/**` 变更时跑）；基线文件入库并在 ADR 记录。
- **验收**：PR 触发并给出清晰超限信息；基线更新流程写入 `docs/frontend-architecture.md`。
- **工作量**：1d。

### T5 文档与规范

- **步骤**：`docs/frontend-architecture.md`（目标架构、分层、ownership、路由约定、token 约定）；`docs/adr/0001-router-choice.md`、`0002-design-tokens.md`、`0003-state-boundary.md`；更新 `src/AGENTS.md`（路由/导航/样式 ownership）；更新 `CONTRIBUTING.md` 的新页面创建步骤（6 步 → 3 步）。
- **验收**：文档与代码一致；新人可按文档在 15 分钟内加一个页面（演练记录）。
- **工作量**：1d。

---

## 6. 不迁移清单（拒绝表）

| self 资产 | 裁决 | 理由（证据） |
| --- | --- | --- |
| Zustand + 11 store | **拒绝** | rev 的 contract/event/state/intent ownership 更收敛（`src/AGENTS.md`）；self 碎片化/持久化后端派生数据/反向依赖（§2.4） |
| Tailwind 4 + MUI 双样式 | **拒绝（默认）** | rev 用户自定义主题/CSS 注入/背景图与 MUI 深耦合；self 自身有 37 行 preflight 补丁与 279 行桥接税，升级即回归（`0cce9d23`）。仅 G5 产品级 UI 重设计时另立项 |
| TanStack Table 替换连接表 | **拒绝** | rev 自研虚拟表已含列管理/持久化/排序/快照（`connection-table.tsx` 897 行）；替换是负收益。列定义模块化可借鉴，过滤功能走 `migrate/connections-filter` |
| 手写 invoke / 全局 d.ts / specta 分支 | **拒绝** | rev 生成契约 + ESLint 硬禁是核心资产；self 主 line 6 个月未合并 specta（`62fd7402`）说明其方向不稳定 |
| notistack / self NoticeProvider | **拒绝** | rev `notice-service` + 穷举 handler + code→i18n 映射更强 |
| react-virtuoso（self 在用） | **拒绝** | rev 已统一 `@tanstack/react-virtual` + 自研窗口化；不引入第二套虚拟化 |
| self 自研 loading 遮罩 / visitedPaths / idle 全量预载 | **拒绝** | 用 TanStack 原生 pending + intent preload 替代；避免双拆包与全量预载抵消收益 |
| self 三套 lint/format（ESLint+Biome+Prettier） | **拒绝** | rev 的 Biome format + ESLint + knip 已闭环；不引入 Prettier |
| self 4 语言单层 i18n | **拒绝** | rev 14 locale × 10 namespace + 生成 key 类型 |
| self 的 `scripts/check.ts` / scripts 体系 | **拒绝** | 是 self sidecar 二进制下载器，与 rev 资产脚本无关 |
| self 的 `docs/frontend-ui-analysis.md` 内容 | **仅借鉴** | 吸收"把信息架构写成规格"的习惯，不搬其产品功能描述 |
| self 的 monaco 插件配置 | **不迁移** | rev `services/monaco.ts` 已是动态加载最佳实践；self 配置有重复 worker 等小缺陷 |
| self 的 routeTree 三处 ignore 模式 | **采纳** | 生成物豁免 lint/format/knip 是必要卫生（配合本计划） |

---

## 7. 质量门禁与验收

### 7.1 每个 PR 必跑（rev 现有门禁，全部保持）

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm knip:check
pnpm gen:contract        # 确认 bindings.ts 无未提交 diff（本计划不应触碰契约；如意外触碰必须回退）
node scripts/check-architecture.mjs listen emit invoke
pnpm i18n:types && pnpm i18n:check
```

涉及 Rust 的 PR（本计划原则上不涉及）：`cargo clippy --all-targets --all-features --tests --benches -- -D warnings`、`cargo fmt --check`、`cargo test --workspace`。

### 7.2 新增门禁（Phase 3/4 接入）

- 依赖方向 lint（`layers` gate）0 违规。
- route catalog 一致性测试。
- bundle 预算（初始 JS gzip ≤ 基线 × 1.02；单路由 chunk 报表可见）。
- 导航性能基线（热 p95 < 100ms、冷 p95 < 200ms，本机基线）。
- i18n 完整性（CI `--check` 模式）。

### 7.3 性能/体验验收（Phase 0 采集真实基线后填数，以下是目标值）

| 指标 | 目标 | 测量方式 |
| --- | --- | --- |
| 初始 JS（gzip） | 相对 Phase 0 基线 −15% | `pnpm web:build` 产物解析 |
| 热导航（已访问）p95 | < 100ms，无可见 loading | 采样脚本 + 录屏 |
| 冷导航（首次）p95 | < 200ms，无闪烁 | 同上 |
| 页面切换 loading 闪烁 | 0 次（20 次随机导航） | 录屏人工核验 |
| 主题切换（明/暗/自定义） | 无闪烁、无 FOUC | 手工 smoke |
| 内存/长会话 | 无 WebSocket/路由级泄漏 | 30 分钟长会话观察 |

### 7.4 手工 smoke 清单（每个 Phase 结束）

1. 8 条路由直达 + 相互切换 + 浏览器前进/后退；深链 `clash://` 导入落点。
2. 导航拖拽排序 → 重启保持；折叠导航；窄窗口。
3. 主题：明/暗/系统跟随；主题预设/取色/字体/CSS 注入/背景图；重启保持。
4. 通知：订阅导入成功→跳转订阅页；错误 toast；服务迁移 dialog；特权 dialog。
5. 窗口层（local 独有）：自定义/系统标题栏、最大化、拖拽、原生红绿灯（macOS）。
6. 更新/内核/代理/连接/规则/日志页的基本交互（不回归）。
7. 语言切换（zh/en + 任一 RTL 如 ar/fa）14 locale key 缺失检查。

### 7.5 Definition of Done（分支级）

- [ ] Phase 0–4 全部完成或明确降级为后续跟进（记录原因）。
- [ ] 所有新增门禁在 CI 为 error 且全绿。
- [ ] `docs/frontend-architecture.md` + 3 篇 ADR 入库并与代码一致。
- [ ] 新增页面步骤在 `CONTRIBUTING.md` 更新且完成一次演练。
- [ ] 一次完整的 `git rebase origin/dev` 演练通过（冲突仅限已知 churn 区且可解）。
- [ ] 全量 smoke 通过（§7.4），无 P0/P1 回归。

---

## 8. 分支/提交/上游同步策略

### 8.1 分支模型

- 集成分支：`migrate/self-frontend-architecture`（基于 `local` @ `ed909350`，本文件所在分支）。
- **工作区隔离（强制）**：每张卡片在独立 `git worktree` 中开发，路径固定为 `worktrees/<name>`（如 `worktrees/fe-router-poc`、`worktrees/integration`）；主仓库 `clash-verge-rev` 固定停留在 `local`，**不在多个分支/工作区之间反复 checkout**。每个 AI 会话只在自己 worktree 内读写与提交，提交只落在自己的分支；合并与集成文档在 `worktrees/integration` 中完成。
- 子分支（每张卡片一个，单独 PR/可独立回滚）：
  - `migrate/fe-router-poc`、`migrate/fe-router`
  - `migrate/fe-nav-config`、`migrate/fe-loading`
  - `migrate/fe-design-tokens`、`migrate/fe-theme-presets`
  - `migrate/fe-provider-split`、`migrate/fe-boundary-lint`
  - `migrate/fe-tests-ci`、`migrate/fe-docs`
- Commit：Conventional Commits（英文，遵循 rev AGENTS.md），结构迁移在 body 标注来源：

  ```
  Ported-from: clash-verge-self@4812e488 (refactor: replace react router with tanstack router)
  ```

- 同一文件被多卡修改时，先合前置卡（如 R1 先于 R2；S1 先于 S2）。

### 8.2 上游同步协议

1. **冻结区不改**：`services/bindings.ts`、`contract.ts`、`types/generated/**`、`locales/**`、`services/cmds.ts`、`src-tauri/{config,core,crates}/**`（§8.3）。
2. 每个 Phase 结束做一次 `git fetch origin && git rebase origin/dev` 演练（在临时分支）；冲突超预期则先暂停并重新评估 diff 面。
3. 上游若在迁移期间重做路由/状态（历史 churn 高），优先暂停本分支对应卡片，先吸收上游再继续。
4. 本计划是**本地分支规划**，不是上游 PR；若要上游化，需先按 rev `AGENTS.md:13-21` 开 issue、拆分小 PR、去掉"大重构"叙事。

### 8.3 上游高 churn 文件/目录（迁移 diff 尽量避开）

| 文件 | 近 6 个月 dev 提交数（本树实测） | 策略 |
| --- | --- | --- |
| `services/cmds.ts` | 38 | 冻结，不改 |
| `types/generated/i18n-*.ts` | 34 | 生成物，不改 |
| `locales/*/settings.json` 等 14 份 | 25–26 | 只增 key，用脚本 |
| `pages/profiles.tsx` | 23 | 不改内部 |
| `setting/mods/dns-viewer.tsx` | 21 | 不改内部 |
| `pages/_layout.tsx` | 20 | 仅做 `app/layout.tsx` 迁移（一次大改，之后冻结） |
| `home/current-proxy-card.tsx` | 18 | 不改内部 |
| `providers/app-data-provider.tsx` | 16 | T1 一次性迁移 |
| `profile/profile-item.tsx`、`rules-editor-viewer.tsx` | 14 | 不改内部 |
| `types/global.d.ts` | 12 | 不改 |

### 8.4 许可与归属

- 两仓库均为 **GPL-3.0-only**，代码可互相借鉴；结构迁移与组件移植需在 commit body 标注 `Ported-from`，并在最终 Changelog 中按 rev 规则记录用户可见变化（仅功能层面）。
- self 的文档/注释不直接复制；重写为 rev 术语。

---

## 9. 风险登记表

| # | 风险 | 影响 | 概率 | 缓解 |
| --- | --- | --- | --- | --- |
| 1 | 路由拆包导致导航 loading 闪烁，重蹈 `e63b8e6e` 回退 | 体验回归，G1 失败 | 中 | PoC 2 路由先测；intent preload + pending 门槛；录屏验收；B 方案兜底 |
| 2 | 上游 rebase 冲突 | 跟进成本上升 | 高 | diff 圈在路由/样式/状态适配层；冻结 churn 区；每 Phase 演练 |
| 3 | 样式 token 化造成视觉回归 | UI 回归 | 中 | 按域小 PR + before/after 截图 + 三态 smoke |
| 4 | Provider 拆分改变 SWR 读序/刷新时机 | 数据不一致 | 中 | 先补测试；保留旧导出一个迭代；按页替换 |
| 5 | 用户自定义主题/CSS 注入/背景图被破坏 | 产品功能缺失 | 中 | 专项回归清单；禁止改 `use-custom-theme` 的注入协议（只加 token 层） |
| 6 | i18n key 漂移 / 14 locale 缺失 | typecheck/运行 fallback | 中 | `i18n:types` + `i18n:check` 进门禁；新增文案模板化 |
| 7 | 生成物（routeTree.gen.ts）churn 与 lint 冲突 | CI 噪音 | 低 | lint/format/knip 四处豁免；CI 后置生成校验 |
| 8 | 新依赖体积/供应链风险 | 包体/安全 | 低 | 仅 2 个依赖（MIT）；pnpm 精确 pin 风格；review |
| 9 | 工作量超估 | 排期风险 | 中 | 卡片独立可交付；G1 不通过即降级 B 方案；可选卡可延后 |
| 10 | 与 `migrate/connections-filter` 等并行分支冲突 | 合并冲突 | 低 | 文件零重叠；路由壳新建文件不冲突 |

---

## 10. 附录

### A. self 架构重构 commit 索引（实现时参考）

| commit | 日期 | 标题 | 规模 | 本计划用途 |
| --- | --- | --- | --- | --- |
| `4812e488` | 2025-06-05 | refactor: replace react router with tanstack router (#1061) | 23 files +6584/−3498 | R1 骨架参考 |
| `1da1d991` | 2026-04-08 | feat(router): optimize page transitions and route preloading (#1836) | 28 files +487/−213 | R3 预加载（反面参考） |
| `4fea7c91` | 2024-10-05 | feat: add tailwindcss | 17 files +6426/−3315 | 不采纳（G5 参考） |
| `83d38287` | 2025-03-15 | Tailwind v3→v4 | 25 files +6317/−4114 | 不采纳 |
| `35115975` | 2026-04-07 | migrate to zustand (#1767) | 66 files +7096/−4087 | 不采纳（反例） |
| `5f8a2277` | 2026-04-25 | replace connection table with tanstack table (#1932) | 17 files +6733/−3711 | 不采纳（负收益） |
| `5e7e8c26` | 2026-05-18 | style(ui): Material You (#2088) | 69 files +1114/−1245 | S1/S2 主题与 token 参考 |
| `c2076daf` | 2026-05-30 | feat(theme): update color presets | 5 files +129/−129 | S2 预设数据参考 |
| `62fd7402` | 2026-04-18 | specta 分支（未合并） | 22 files +1517 | 不采纳 |
| `75c8c416` | 2026-06-14 | tag v2.3.2（完整历史取证基准） | — | — |

### B. rev 近期架构相关 commit

| commit | 日期 | 说明 | 影响 |
| --- | --- | --- | --- |
| `e63b8e6e` | 2026-07-20 | 移除路由 lazy + idle 预热（−216 行） | R3 验收约束来源 |
| `4ed47470` | 2026-09-05 | 查询状态所有权收敛 | 状态层不可倒退 |
| `69b76cc6` | 2026-10-07 | contract flow：事件总线 + app store + mutate 漏斗 + invoke 门禁 | 本计划保留的核心 |
| `6e08a77a` | — | backend specta IPC bindings | 契约流水线 |
| `20141e79` | 2026-09 | 编辑器列表虚拟化 | 性能资产 |

### C. 文件映射表（current → target）

| 当前 | 目标 | 动作 |
| --- | --- | --- |
| `src/pages/_routers.tsx` | `src/app/router.tsx` + `src/routes/*.tsx` | 重写 |
| `src/pages/_navigation.tsx` | 删除，逻辑并入 `config/navigation.ts` + `routes/*.tsx` | 重写 |
| `src/pages/_navigation-meta.ts` | `src/config/navigation.ts` | 迁移 |
| `src/pages/_layout.tsx` | `src/app/layout.tsx` + `src/routes/__root.tsx` | 迁移 |
| `src/pages/_layout/hooks/use-nav-menu-order.ts` | 保留位置，改接 `config/navigation.ts` | 小改 |
| `src/pages/_theme.tsx` | `src/config/theme/index.ts`（默认 token/预设） | 迁移 |
| `src/pages/_layout/hooks/use-custom-theme.ts` | 保留，扩展 token 注入 | 小改 |
| `src/main.tsx` | `src/app/main.tsx`（bootstrap 顺序不变） | 迁移 |
| `src/providers/app-data-context.ts` | 领域 hooks + 精简 context | 拆分 |
| `src/providers/app-data-provider.tsx` | `app/providers.tsx` + 领域 hooks | 拆分 |
| `src/pages/*.tsx` | 保留（页面组合），去掉路由职责 | 小改 |
| `src/components/layout/layout-sidebar.tsx` 等 4 处 | 改 import 到 `config/navigation.ts`/`config/theme` | 小改 |
| `src/routes/routeTree.gen.ts` | 生成物（提交入库，lint/format/knip 豁免） | 新增 |

### D. 常用命令

```bash
# 各分支独立 worktree（示例；禁止在主仓库里反复切换分支）
cd ../worktrees/fe-router-poc

# 路由生成（dev 时插件自动生成；手动重建）
pnpm generate-routes

# 基线体检
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm knip:check
node scripts/check-architecture.mjs listen emit invoke
pnpm i18n:types && pnpm i18n:check

# 体积基线（Phase 0 已建立；Phase 4 再接预算门禁）
pnpm web:build
node scripts/perf/frontend-baseline.mjs --dist dist --out docs/perf/frontend-baseline.json

# 参考 self 的具体实现（只读，不 checkout）
git -C ../clash-verge-self show <commit>:<path>
```

### E. 术语

- **route 壳**：`src/routes/*.tsx`，只声明路由、页面组件、`staticData`、错误边界。
- **token**：语义化设计变量（如 `color.surface`、`space.md`），最终映射到 MUI theme 与 CSS 变量。
- **门禁**：CI 中不可跳过的检查（lint/typecheck/test/knip/arch/契约/i18n/bundle）。
- **G1–G5**：见 §4.2 决策门。

---

## 11. 立即可执行的第一步（TL;DR）

1.（✅ 已完成，见 §12）在 `migrate/self-frontend-architecture` 分支 worktree 跑 §7.1 门禁、采集 bundle 基线、写 ADR。
2. 开子分支 `migrate/fe-router-poc`：只迁 settings + proxies 两条路由，按 §4.2 G1 指标验证"无闪 + 拆包"。
3. PoC 通过 → 全量 R1/R2/R3/R4；不通过 → 切换 B 方案（react-router 分层 + lazy），记录 ADR。
4. Phase 2/3 可并行（文件不重叠）：样式 token 与 Provider 拆分各开子分支。
5. 任何提交前按 §8.1 标注来源，按 §7.1 跑门禁；每 Phase 结束做一次 `rebase origin/dev` 演练。


---

## 12. Phase 0 执行记录（2026-10-19）

状态：**已完成**。M0 验收口径：门禁绿色基线可复现；基线数据写入文档；worktree 干净。

### 12.1 交付物

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| ADR（D1–D4 选型 + 备选/重评条件） | `docs/adr/0001-router-choice.md` | 路由条件 Go；样式/状态/资产裁决 |
| 目标架构 | `docs/frontend-architecture.md` | 分层/路由约定/ownership/token/门禁 + base 差异清单 + churn 冻结清单 |
| 基线报告 | `docs/perf/frontend-baseline-2026-10-19.md` | 门禁结果、构建产物、初始负载、G1 口径、计时协议 |
| 机器可读基线 | `docs/perf/frontend-baseline.json` | 初始/异步 chunk 字节与 gzip；供 Phase 4 预算门禁消费 |
| 基线采集脚本 | `scripts/perf/frontend-baseline.mjs` | `pnpm web:build` 后解析 dist；可复现 |
| npm script | `package.json` 的 `perf:frontend-baseline` | 稳定入口（Phase 4 扩展为 `--check`） |

### 12.2 门禁

`typecheck` / `lint` / `format:check` / `test` / `knip:check` / `arch:check` / `i18n:types` / `i18n:check` / `web:build` 全部 exit 0；耗时见基线报告 §1。**未执行**：`pnpm gen:contract` 与 Rust 门禁（Phase 0 为 docs-only，且 worktree 无 `src-tauri/target`，冷编译成本高）——移交 Phase 1 首个 PR 补跑。

### 12.3 基线摘要

- 初始负载：**508.5 kB gzip**（1,648.3 kB raw）JS + 1.6 kB gzip CSS；入口 chunk 312.7 kB gzip。
- 8 个页面全 eager：路由切换 0 网络请求、0 loading——这是 R3 的对照基线。
- G1 目标：初始 JS gzip ≤ **432.2 kB**（−15%），页面对应异步 chunk，且无 loading 闪烁。
- 异步 259 个 chunk（Monaco worker 11 个、raw 10.5 MB），说明预算门禁必须区分"初始/总产物"。

### 12.4 移交 Phase 1 的事项

1. 开 `migrate/fe-router-poc`：settings + proxies 两路由 PoC，按 G1 六项条件验收。
2. 补跑 `pnpm gen:contract` + Rust 门禁（Phase 1 首个 PR）。
3. 运行时导航计时（G1）：按基线报告 §6 协议采集冷/热 p50/p95 并回填基线（`frontend-baseline.json` 扩展字段）。
4. 上游 rebase 演练：Phase 1 结束后按 §8.2 执行。

### 12.5 结论

Phase 0 无阻塞项，可以进入 Phase 1（G1 条件 Go）。唯一未测量项是运行时导航耗时，已明确由 G1 PoC 承担，不影响 Phase 0 验收。

### 12.6 Phase 1 完成记录（R1/R2，2026-10-19）

- R1（TanStack Router PoC）：`7427e3e6`；R2（导航单一事实源 + 类型化导航）：`70b09fa9`；已合入集成分支：`499ce8b4`。
- G1 六项全部通过：门禁全绿；route catalog 测试通过；桌面 smoke 无异常（无导航 loading 闪烁）；初始 JS **392.9 kB gzip（−22.7%）**；依赖净增 +2；深链/通知/拖拽/主题无回归。
- 运行时 p95 数值未单独采集（定性通过）；由 T4 的 bundle/导航性能脚本落地后补录。
- 下一张卡片：T2（依赖方向 lint + 反向 import 清理）或 T4（bundle 预算 + 导航性能 CI），二选一后开新 worktree。

### 12.7 Phase 3 T2 完成记录（依赖方向强制，2026-10-19）

- 卡片分支：`migrate/fe-boundary-lint`（commit `bd81c85a`），已 FF 合入集成分支。
- 结构调整：`pages/_layout.tsx` → `app/layout.tsx`；`pages/_layout/hooks/*` → `hooks/layout/*`；`pages/_theme.tsx` → `config/theme.ts`；`initial-loading-overlay` → `utils/`。
- 反向依赖清零：`components`/`hooks`/`services`/`config` 不再 import `pages`；`routes` 只依赖 `app`/`pages`/`components/base`/`config`。
- 强制手段：`eslint.config.ts` 新增 `import-x/no-restricted-paths` 23 个 zone；`scripts/check-architecture.mjs` 将该规则纳入边界校验；实测能拦截 `components → pages` 违规。
- 门禁全绿；bundle 中性（393.1 kB gzip）。
- 合并提示：本卡移动了 `theme-viewer.tsx` 的 import 与 `_theme` 路径，与并行主题分支（c4/c5）合并时若冲突，以本分支的 import 路径为准。

### 12.8 Phase 4 T4 完成记录（bundle 预算门禁，2026-10-19）

- 卡片分支：`migrate/fe-bundle-budget`（commit `a184b6c5`），已 FF 合入集成分支。
- 新增 `scripts/check-bundle-budget.mjs`（默认容差 +2%）+ `pnpm check:bundle-budget`；CI `frontend-check.yml` 在 tests 后执行 `build` + budget。
- 基线已更新为 post-router：初始 JS **393.1 kB gzip**（入口 159.0 kB gzip，代码 commit `f9dd397e`）；更新方式 `--record` 并需在 PR 说明。
- `evaluateBudget` 有 node:test 覆盖（`perf:test` 7 tests）；全门禁绿。

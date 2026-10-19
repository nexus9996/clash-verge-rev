# Phase 0 前端基线报告（migrate/self-frontend-architecture）

> 日期：2026-10-19
> 分支：`migrate/self-frontend-architecture`（基线代码 = `local` @ `ed909350`；采集时 HEAD = `904f2709`）
> 机器：Apple M1 / macOS 27.2.0（arm64）/ Node v24.22.0 / pnpm 12.14.0
> 机器可读基线：[`frontend-baseline.json`](frontend-baseline.json)（由 `scripts/perf/frontend-baseline.mjs` 生成）
> 协议：本报告只记录**静态构建产物与门禁**；运行时路由计时见 §6（G1 PoC 执行），当前基线给出"eager 路由"的对照口径。

## 1. 门禁结果（Phase 0 绿色基线）

在干净 worktree（安装依赖后）逐项运行，全部通过：

| 门禁 | 命令 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 类型检查 | `pnpm typecheck` | ✅ exit 0 | 6s |
| ESLint | `pnpm lint` | ✅ exit 0 | 30s |
| 格式检查 | `pnpm format:check` | ✅ exit 0 | 2s |
| 单测（vitest） | `pnpm test` | ✅ exit 0（11 文件 / 1087 行） | 12s |
| 死代码/循环依赖 | `pnpm knip:check` | ✅ exit 0 | 4s |
| IPC 边界 | `node scripts/check-architecture.mjs listen emit invoke` | ✅ exit 0 | 26s |
| i18n 生成 | `pnpm i18n:types` | ✅ exit 0，无文件 diff | <1s |
| i18n 检查 | `pnpm i18n:check` | ✅ exit 0（默认报告模式） | <1s |
| 生产构建 | `pnpm web:build`（`tsc --noEmit && vite build`） | ✅ exit 0 | 13s |

**未执行项（记录为已知缺口）**：

- `pnpm gen:contract` / Rust 门禁（`cargo clippy/fmt/test`）：Phase 0 为 docs-only 变更，且 worktree 无 `src-tauri/target`（冷编译成本高）。按迁移计划 §7.1，**Phase 1 第一个 PR 必须补跑**。
- 运行时路由计时：需要运行中的 Tauri 窗口，见 §6。

## 2. 构建产物结构

```text
$ pnpm web:build          # 13s
$ find dist -type f | wc -l       # 278（含字体/图标等静态资源）
$ du -sh dist                     # 20M
JS/CSS：274 个（271 JS + 3 CSS）
  ├─ 初始加载（index.html 引用）：14 个（13 JS + 1 CSS）
  └─ 异步 chunk（动态 import）：259 个（含 11 个 worker）
```

- 构建链：Vite 8.3.0（产物含 `rolldown-runtime-*.js`，即 Rolldown 构建）。
- Monaco 相关（`editor.api`、`vs`、`*.worker`、`editor-*.css`）全部是**异步 chunk**，不参与首屏初始加载。
- `dist/` 被 git 忽略，不随分支提交；基线比对以 JSON 为准。

## 3. 初始加载基线（G1 的对比基准）

初始加载 = `dist/index.html` 中 `script` + `modulepreload` + `stylesheet` 引用的文件：

| 文件 | raw | gzip | 角色 |
| --- | ---: | ---: | --- |
| `assets/index-Ep8G96yo.js`（应用入口） | 1047.2 kB | 312.7 kB | script |
| `assets/use-icon-cache-ilXmenMF.js` | 322.6 kB | 101.1 kB | modulepreload |
| `assets/query-client-DcogQkCz.js` | 143.3 kB | 49.4 kB | modulepreload |
| `assets/useLockFn-Cabm7S0_.js` | 38.8 kB | 12.2 kB | modulepreload |
| `assets/polyfills-D2sRUmRE.js` | 25.1 kB | 9.4 kB | script |
| `assets/IconButton-3WUKpE2z.js` | 25.0 kB | 8.9 kB | modulepreload |
| `assets/window-CM9O4ZIB.js` | 22.7 kB | 5.8 kB | modulepreload |
| `assets/Chip-DAazTXWv.js` | 10.2 kB | 3.4 kB | modulepreload |
| `assets/index-DmwMXwj0.css` | 8.2 kB | 1.6 kB | stylesheet |
| `assets/react-CuOmR4mE.js` | 7.7 kB | 2.9 kB | modulepreload |
| `assets/dist-js-Dbc9sMh7.js` | 2.7 kB | 0.9 kB | modulepreload |
| `assets/preload-helper-BZ1Pz5am.js` | 1.2 kB | 0.7 kB | modulepreload |
| `assets/rolldown-runtime-hePW80VL.js` | 0.7 kB | 0.4 kB | modulepreload |
| `assets/defineProperty-BbfpZ9Tg.js` | 0.7 kB | 0.4 kB | modulepreload |
| `assets/jsx-runtime-NZYk81nU.js` | 0.4 kB | 0.3 kB | modulepreload |

**汇总**

| 指标 | raw | gzip |
| --- | ---: | ---: |
| 初始 JS（14 文件中 13 JS + 1 CSS） | 1,687,881 B（1,648.3 kB） | 520,717 B（508.5 kB） |
| 初始 CSS | 8,378 B（8.2 kB） | 1,656 B（1.6 kB） |
| **初始总负载** | **1,696,259 B（1,656.5 kB）** | **522,373 B（510.1 kB）** |

**G1 目标（迁移计划 §4.2）**：初始 JS gzip ≤ **432.2 kB**（−15%），raw ≤ **1,401.1 kB**；同时 8 个页面进入独立异步 chunk，且导航无可见 loading 闪烁。

## 4. 异步 chunk 概况（首屏不加载）

| 文件 | raw | gzip | 说明 |
| --- | ---: | ---: | --- |
| `ts.worker-*.js` | 6,766.5 kB | 1,450.2 kB | Monaco TS worker（编辑器触发） |
| `editor.api-*.js` | 2,670.5 kB | 681.9 kB | Monaco editor |
| `vs-*.js` | 1,264.9 kB | 315.2 kB | Monaco |
| `css.worker-*.js` | 1,054.0 kB | 240.4 kB | Monaco CSS worker |
| `yaml.worker-*.js` | 1,026.5 kB | 304.4 kB | YAML worker |
| `html.worker-*.js` | 726.9 kB | 191.5 kB | HTML worker |
| `meta-json-schema-*.js` | 454.9 kB | 63.5 kB | 配置 schema |
| `json.worker-*.js` | 423.9 kB | 125.8 kB | JSON worker |
| `editor.worker-*.js` | 296.8 kB | 90.7 kB | editor worker |
| `rehype-raw-*.js` | 165.8 kB | 51.3 kB | markdown 渲染 |
| `editor-*.css` | 96.8 kB | 13.9 kB | Monaco 样式 |

> 异步总计：259 个文件，16,845,053 B raw（4,166,553 B gzip）；其中 worker 11 个共 10,545,901 B raw。它们与路由拆包无关，但说明 **bundle 预算门禁必须区分"初始"与"总产物"**，否则会被 Monaco 噪声淹没。

## 5. 当前路由形态基线（R3 的对照）

- `src/pages/_navigation.tsx:21-28` 静态 import 8 个业务页面；`_routers.tsx` 用 `navItems.map` 一次性注册 → **8 个页面全部打进初始加载图，没有路由级 chunk**。
- 因此当前基线是：**路由切换 0 网络请求、0 loading 状态；代价是首屏一次加载全部页面代码**。
- R3 要改变的是"首屏负载"，同时必须保持"切换无网络成本/无闪烁"的体验。G1 的验收必须两者同时满足：
  1. 初始 JS gzip 下降 ≥15%；
  2. 20 次随机导航录屏无 loading 闪烁，热导航 p95 < 100ms、冷导航 p95 < 200ms（本机）。

## 6. 运行时导航计时协议（G1 执行，Phase 0 未采集）

Phase 0 不启动 Tauri 窗口，因此运行时常量留到 Phase 1 PoC 与 G1 一起采集。统一协议如下（PO 与迁移后必须用同一协议）：

1. 构建/启动：`pnpm dev`（Tauri 开发实例）或 `pnpm build:fast` 后的本地安装包；同一台 M1 机器。
2. 冷导航：刷新/重启页面后，依次访问 8 条路由，每条记录首次进入耗时（从点击到内容可见 + 无 loading 覆盖层）。
3. 热导航：预热一轮后，随机顺序切换 20 次，记录耗时。
4. 数据来源：DevTools Performance 的 navigation timing，或临时在 router 事件里 `performance.mark/measure`（PoC 分支可加，不提交）；同时录屏检查 loading 闪烁。
5. 统计：每条路由取 p50/p95，汇总冷/热两组；基线值保存在 [`frontend-baseline.json`](frontend-baseline.json) 的后续扩展字段（Phase 4 的 `check-bundle-budget`/perf 脚本负责写入）。
6. 自动化替代：复用 `scripts/perf/run.mjs` + `@wdio/tauri-service`（仓库已有 WebDriver 依赖），在 Phase 1 决定是否值得接入 CI。

> Phase 0 的记录口径：当前"切换 0 网络请求、0 loading"是静态事实（全 eager），不需要运行时测量即可断言；迁移后若保持不住，即 G1 失败。

## 7. 复现命令

```bash
# 依赖（首次）
pnpm install --frozen-lockfile

# 门禁
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm knip:check
node scripts/check-architecture.mjs listen emit invoke
pnpm i18n:types && pnpm i18n:check

# 构建 + 采集基线
pnpm web:build
node scripts/perf/frontend-baseline.mjs --dist dist --label rev-local-ed909350-eager-routes \
  --out docs/perf/frontend-baseline.json
```

## 8. 说明与限制

1. 本基线是**单机单次**数据（M1/macOS），绝对数值不跨机器比较；G1 对比必须用同一台机器、同一 Node/pnpm 版本。
2. `frontend-baseline.json` 采集时工作树含未提交的 Phase 0 文档/脚本（`dirty: true`），`src/` 代码与 `904f2709` 完全一致；基线代码语义为 `local@ed909350`。
3. 构建耗时（13s）与门禁耗时（~93s）仅作为后续 PR 回归的参考上限，不构成硬门槛。
4. 未覆盖：Rust 契约产物校验（见 §1）、真实 WebView 的首屏 FCP/TTI（Phase 1 PoC 用同一协议补测）。

## 9. 基线更新记录（T4，2026-10-19）

- Phase 0（8 路由 eager）：初始 JS **508.5 kB gzip**、入口 312.7 kB gzip（见上文 §3）。
- R1/R2/T2 合入后：初始 JS **393.1 kB gzip**（1,196.0 kB raw），入口 **159.0 kB gzip**；7 个非首屏页面拆为异步 chunk。
- `docs/perf/frontend-baseline.json` 已更新为该基线（label `integration-router-r2-t2`，基线代码 commit `f9dd397e`），供预算门禁消费。
- 预算命令：`pnpm web:build && pnpm check:bundle-budget`（默认容差 +2%，即 400.9 kB gzip）；CI 的 `frontend-check.yml` 在 tests 之后执行 build + budget。
- 有意调整包体时用 `node scripts/check-bundle-budget.mjs --dist dist --record` 更新基线，并在 PR 中说明原因。

## 10. 导航性能采样（2026-10-19 补齐入口）

- 采样入口与协议已落地：`src/app/router-timing.ts`（dev opt-in）+ `scripts/perf/nav-timing.mjs`，桌面采集步骤见 [navigation-timing](navigation-timing.md)。
- `--record` 写入独立的 `docs/perf/navigation-timing-baseline.json`，与 bundle 基线分离（`check-bundle-budget --record` 会重写 `frontend-baseline.json`，导航数据不能被它覆盖）。
- 冷/热 p95 数值与 20 次随机导航录屏仍需桌面 Tauri 实例执行；该门禁不进 CI（见 [navigation-timing](navigation-timing.md) §4）。

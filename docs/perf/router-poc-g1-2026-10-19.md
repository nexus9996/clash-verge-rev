# Phase 1 · 路由 PoC 与 G1 实测记录（TanStack Router）

> 日期：2026-10-19
> 分支：`migrate/fe-router-poc`（基于集成分支 `migrate/self-frontend-architecture` @ `63bfae17`）
> 关联：[迁移计划](../frontend-architecture-migration-plan.md) · [ADR-0001](../adr/0001-router-choice.md) · [Phase 0 基线](frontend-baseline-2026-10-19.md)
> 结论：**G1 全部通过（Full Go）**：bundle −22.7% gzip；2026-10-19 桌面 smoke 无异常；R1+R2 已合入集成分支

## 1. PoC 范围

按迁移计划 R1/R3 的最小闭环实现，**不做** R2 的 `config/navigation.ts` 收口与 app/ 完整分层（下一卡）：

- 新增 `@tanstack/react-router` + `@tanstack/router-plugin` + `@tanstack/router-cli`；移除 `react-router` 8.4.0。
- 文件式路由：`src/routes/` 9 个文件（`__root` + 8 条路由薄壳），`src/routeTree.gen.ts` 由 `pnpm generate-routes` 生成并入库。
- 路由实例：`src/app/router.tsx`（`defaultPreload: 'intent'`、`defaultPendingMs: 200`、`defaultPendingMinMs: 300`，不启用 idle 全量预载）。
- 页面仍留在 `src/pages/`；route 壳只 import 页面，不写业务，**不使用手动 `React.lazy`**（拆包交给 `autoCodeSplitting`）。
- 导航元数据 `src/pages/_navigation.tsx` 去掉页面 eager import 与 `Component` 字段（否则会抵消拆包收益），新增 `NavigationPath` 类型；路径与 `navigationItems` 保持不变（`/profile` 等深链兼容）。
- 迁移 9 处 react-router 使用点：`main.tsx`、`_layout.tsx`、`layout-item.tsx`、3 个 home 卡片、`proxy-empty-state`、`profiles.tsx`、删除 `pages/_routers.tsx`。
- 生成物豁免：eslint / biome / knip 忽略 `src/routeTree.gen.ts`；新增 `tsr.config.json` 与 `generate-routes` 脚本。
- 新增 route catalog 测试：`src/routes/__route-catalog.test.ts`（routeTree 路径集合 ≡ `navigationItems` 路径集合；不 import 页面组件，避免 jsdom）。

## 2. 门禁结果（全部通过）

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | ✅ 6s |
| `pnpm lint`（0 warnings） | ✅ |
| `pnpm format:check`（Biome，含生成物豁免） | ✅ |
| `pnpm test`（vitest） | ✅ 12 文件 / 47 tests（新增 2 个 route catalog 测试） |
| `pnpm knip:check`（含 cycles） | ✅ 2s |
| `node scripts/check-architecture.mjs listen emit invoke` | ✅ 14s |
| `pnpm i18n:types && pnpm i18n:check` | ✅ 无 diff |
| `pnpm web:build` | ✅ 3.3s |

> 说明：`react-router` 移除后无残留 import（`grep -rn "react-router" src` 只剩 `@tanstack/react-router`）；新增依赖净增 **+2**（+3 新增、−1 移除），满足 G1 "≤3"。

## 3. G1 指标对照

| # | G1 条件 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 门禁全绿 | ✅ | §2 |
| 2 | route catalog 测试通过 | ✅ | `src/routes/__route-catalog.test.ts`（12 文件/47 tests 全过） |
| 3 | 冷/热导航无 loading 闪烁 | ✅ | 2026-10-19 用户桌面 smoke 全量导航无异常（定性通过；p95 数值留 T4 采集） |
| 4 | 初始 JS 主 chunk 相对基线 −15% | ✅ **−22.7% gzip / −27.5% raw** | §4 |
| 5 | 依赖新增 ≤3 | ✅ 净 +2 | `pnpm-lock.yaml` / `package.json` |
| 6 | 手工 smoke 无回归 | ✅ | 2026-10-19 用户执行 §5 清单，无异常 |

## 4. Bundle 对比（Phase 0 基线 → PoC）

| 指标 | Phase 0 基线（eager） | PoC（TanStack Router） | 变化 |
| --- | ---: | ---: | ---: |
| 初始 JS 文件数 | 14 | 47（含共享 chunk 的 modulepreload） | — |
| 初始 JS raw | 1,648.3 kB | **1,195.7 kB** | **−27.5%** |
| 初始 JS gzip | 508.5 kB | **392.9 kB** | **−22.7%** |
| 初始总负载 gzip | 510.1 kB | **394.5 kB** | −22.7% |
| 入口 chunk | 1,047.2 kB / 312.7 kB gzip | 499.2 kB / 158.8 kB gzip | −49.2% gzip |
| 页面代码位置 | 全部 eager 进入口 | 7 个非首屏页面拆为异步 chunk | ✅ |

G1 目标（`508.5 × 0.85 = 432.2 kB gzip`）：实测 **392.9 kB**，通过。

**页面 chunk（均为 async，不在 `index.html` 初始引用中）**

| 页面 | chunk | raw | gzip |
| --- | --- | ---: | ---: |
| profile | `profile-*.js` | 120.2 kB | 37.0 kB |
| settings | `settings-*.js`（主） | 136.7 kB | 35.6 kB |
| proxies | `proxies-*.js`（主） | 48.5 kB | 16.5 kB |
| connections | `connections-*.js`（主） | 27.9 kB | 9.3 kB |
| rules | `rules-*.js`（主） | 6.5 kB | 2.6 kB |
| logs | `logs-*.js`（主） | 6.4 kB | 2.9 kB |
| unlock | `unlock-*.js` | 7.3 kB | 3.0 kB |

**共享 chunk（初始 modulepreload）**：`base-*.js` 290.1 kB/91.5 kB gzip、`debug-*.js` 130.4 kB/44.0 kB gzip、`editor-viewer-*.js` 33.0 kB/11.8 kB gzip 等；首页（`/`）代码仍在入口 chunk 内（`main.tsx` 静态 import `preloadHomePageCards` + 首页是落地路由，强拆无收益，R2/R3 再评估）。

## 5. 待补的运行时验证（G1 条件 3/6）

本会话无法启动 Tauri 窗口，以下由桌面环境执行（同一 M1、同一协议）：

1. `pnpm dev`（或 `pnpm build:fast` 后运行安装包）。
2. 8 条路由直达 + 侧边栏切换 + 浏览器前进/后退；首次进入 settings/proxies 观察是否出现 loading 覆盖层或闪烁。
3. 录屏 20 次随机导航：热导航应无可感知 loading；若出现闪烁，调参 `src/app/router.tsx` 的 `defaultPendingMs/pendingMinMs` 或确认 chunk 加载耗时。
4. smoke 清单：深链导入落点、通知跳转（导入订阅成功 → `/profile`）、导航拖拽排序 + 重启保持、主题/窗口标题栏（local 独有）、`/profile` 与 `/unlock` 等非默认页刷新。
5. 若条件 3 不达标：按 ADR-0001 备选 B1 回退（保留 react-router data-router 分层），或先在 PoC 内调参。

## 6. 已知缺口（转入 R2/R3，不阻塞 G1 结论）

1. 导航元数据仍在 `src/pages/_navigation.tsx`（含图标 import）；R2 移到 `config/navigation.ts` 并加 `staticData.navId`。
2. 未配置路由级 `errorComponent`/`notFoundComponent`（当前由 `_layout.tsx` 的 `BaseErrorBoundary` 兜底）；R2/R4 补。
3. 后端通知导航通过 `_layout.tsx` 的 `(path) => navigate({ to: path as NavigationPath })` 适配；R4 改为穷举 `navigateToRoute(id)`。
4. 未做 `beforeLoad`/`loader`（刻意，数据仍走 SWR/WS，避免第二数据源）。
5. 主题预设分支（`migrate/theme-presets` @ `a2c68d55`）与本分支文件不重叠，集成时按集成分支合并。

## 7. 结论与下一步

- **G1 判定：全部通过（Full Go）**。6 项指标均满足；R1+R2 已合入 `migrate/self-frontend-architecture`（`499ce8b4`）。
- 下一步：
  1. ✅ 运行时验证已完成（2026-10-19 桌面 smoke 无异常）。
  2. 完成 R2（`config/navigation.ts` 单一事实源、`staticData.navId`、路由级 error/notFound）与 R3 收尾（pending 调参）。
  3. ✅ PoC/R2 已合入 `migrate/self-frontend-architecture`（`499ce8b4`）；B1 备选方案不再需要。
- 回滚：本 PoC 为单个提交，`git revert` 即可恢复 react-router；分支未合入前不影响集成分支。

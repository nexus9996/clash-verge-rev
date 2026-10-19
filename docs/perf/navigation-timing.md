# 导航性能实测协议（冷/热路由切换）

> 日期：2026-10-19
> 目的：补齐 G1 与迁移计划 §7.2/§7.3 的运行时导航验收（热 p95 < 100 ms、冷 p95 < 200 ms、20 次随机导航无可见 loading）
> 关联：[迁移计划](../frontend-architecture-migration-plan.md) · [目标架构 §5](../frontend-architecture.md) · [ADR-0001](../adr/0001-router-choice.md) · [Phase 0 基线](frontend-baseline-2026-10-19.md)
> 状态：采样入口与校验脚本已落地；**p95 数值与录屏证据仍须在桌面 Tauri 开发实例上采集**（CI/headless 无法复现 WKWebView 的 chunk 加载与渲染）。

## 1. 现状与口径

- 采样入口：`src/app/router-timing.ts`，仅在 **dev 构建** 且显式开启时安装（`localStorage['verge.routeTiming'] = '1'`），release 构建被 `import.meta.env.DEV` 剔除，不进入包体。
- 计时口径：从路由 `onBeforeNavigate`（点击/导航开始）到 `onRendered` 后再过一帧（双 `requestAnimationFrame`），包含路由 chunk 加载与 React 渲染，不含页面数据请求（SWR 在组件挂载后才发起），与「无导航 loading」的验收口径一致。
- cold / hot：本次会话内首次进入某路由记为 cold（含初始页），之后进入记为 hot。
- 采样为单机基线，不跨机器比较；基线 JSON 仅用于同机后续对比。

## 2. 桌面采样步骤

1. `pnpm dev` 启动 Tauri 开发实例（同一台机器，不要在 release 包/其他机器采样）。
2. 打开 Web Inspector（开发构建可用），在 Console 执行：
   ```js
   localStorage.setItem('verge.routeTiming', '1')
   location.reload()
   ```
3. **冷导航**：从首页 `/` 开始，依次**首次**进入 8 条路由：`/`、`/proxies`、`/profile`、`/connections`、`/rules`、`/logs`、`/unlock`、`/settings`。
4. **热导航**：在 8 条路由间随机切换 **≥20 次**（都已访问过，记为 hot）。
5. 导出采样：
   ```js
   copy(__vergeNavTiming.export())        // Chrome DevTools
   JSON.stringify(__vergeNavTiming.export())  // Web Inspector 无 copy() 时手工复制
   ```
6. 保存为文件（例如 `/tmp/nav-timing.json`），校验：
   ```bash
   pnpm perf:nav-timing --file /tmp/nav-timing.json --check
   ```
7. 通过后记录基线：
   ```bash
   pnpm perf:nav-timing --file /tmp/nav-timing.json --check --record
   ```
   基线写入 `docs/perf/navigation-timing-baseline.json`（含 commit、环境、阈值与冷/热分桶）。
8. 可选证据：录屏 20 次随机导航，人工确认 0 次可见 loading 闪烁（G1 条件 3）。

关闭采样：`localStorage.removeItem('verge.routeTiming'); location.reload()`

## 3. 阈值与命令行为

| 指标 | 默认门槛 | 说明 |
| --- | ---: | --- |
| hot p95 | ≤ 100 ms | 已访问页面切换 |
| cold p95 | ≤ 200 ms | 首次进入（含 chunk 加载） |
| hot 样本 | ≥ 20 | 不足则 `--check` 失败 |
| cold 样本 | ≥ 8 | 覆盖 8 条路由 |

`pnpm perf:nav-timing` 参数：`--file <path|->`（必填，`-` 读 stdin）、`--check`、`--record`、`--baseline <path>`、`--hot-p95/--cold-p95/--min-hot/--min-cold`、`--json`。阈值可用参数覆盖，但基线记录写入实际使用的阈值。

## 4. 已知限制

- **不进 CI**：依赖 macOS WKWebView 与人工导航，ubuntu runner 无法复现；`--check` 作为本机/发布前门禁使用，判定逻辑由 `scripts/perf/nav-timing.test.mjs` 在 CI 中覆盖。
- 不包含操作系统/WebKit 层面的首帧时间；如需 FCP/TTI 请用 DevTools Performance 面板另行采集。
- 后台负载、电源模式会影响绝对值，对比时需同机同电源状态。

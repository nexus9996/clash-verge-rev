# 导航性能实测协议（冷/热路由切换）

> 日期：2026-10-19
> 目的：补齐 G1 与迁移计划 §7.2/§7.3 的运行时导航验收（热 p95 < 100 ms、冷 p95 < 200 ms、20 次随机导航无可见 loading）
> 关联：[迁移计划](../frontend-architecture-migration-plan.md) · [目标架构 §5](../frontend-architecture.md) · [ADR-0001](../adr/0001-router-choice.md) · [Phase 0 基线](frontend-baseline-2026-10-19.md)
> 状态：采样入口与校验脚本已落地；**验收数据须在打包后的 WebView 中采集**（dev 的 cold 受 Vite 按需编译影响，仅作参考）。

## 1. 口径

- 采样入口：`src/app/router-timing.ts`。dev 构建默认可用（手动 `start()`）；release 默认剔除，验收测量用构建开关 `VITE_NAV_TIMING=1`（`pnpm build:nav-timing`）纳入，**测量构建启动即自动开始记录**，无需在测量过程中打开 Inspector。
- 计时口径：从路由 `onBeforeNavigate`（点击/导航开始）到 `onRendered` 后再过一帧（双 `requestAnimationFrame`），包含路由 chunk 加载与 React 渲染，不含页面数据请求（SWR 在组件挂载后才发起），与「无导航 loading」的验收口径一致。
- cold / hot：本次会话内首次进入某路由记为 cold（含初始页），之后进入记为 hot。
- 采样为单机基线，不跨机器比较；基线 JSON 仅用于同机后续对比。

## 2. 打包模式测量（验收口径）

1. 关闭正在运行的 dev 实例，避免两个实例同时读写配置/内核。
2. 构建带采样器的安装包：
   ```bash
   pnpm build:nav-timing
   ```
   产物为 release + `app` bundle：`<cargo target>/release/bundle/macos/Clash Verge.app`（本机 `CARGO_TARGET_DIR=~/.cargo/shared-target` 时即 `~/.cargo/shared-target/release/bundle/macos`）。
3. 启动应用：`open "<...>/Clash Verge.app"`，等首屏与内核状态稳定（约 10–20 s，避免启动期负载污染）。
4. **冷导航**：从首页 `/` 开始，依次**首次**进入 8 条路由：`/`、`/proxies`、`/profile`、`/connections`、`/rules`、`/logs`、`/unlock`、`/settings`。
5. **热导航**：在 8 条路由间随机切换 **≥20 次**（都已访问过，记为 hot）。
6. 测量结束后再打开 Web Inspector：应用内右键 → **Inspect Element**（Tauri 的 `devtools` feature 已随依赖启用）；若没有该菜单，用 Safari → 设置 → 高级 → 勾选「显示网页开发者功能」，再从 Safari → 开发 菜单选择该 WebView。
   > 测量构建已自动开始记录，**不要在导航测量期间打开 Inspector**，避免调试器开销污染数据。
7. 导出采样：
   ```js
   __vergeNavTiming.stop()
   copy(__vergeNavTiming.export())        // Chrome/WebKit DevTools
   JSON.stringify(__vergeNavTiming.export())  // 无 copy() 时手工复制
   ```
8. 保存为文件（例如 `/tmp/nav-timing.json`），校验并记录基线：
   ```bash
   pnpm perf:nav-timing --file /tmp/nav-timing.json --check
   pnpm perf:nav-timing --file /tmp/nav-timing.json --check --record
   ```
   基线写入 `docs/perf/navigation-timing-baseline.json`（含 commit、环境、阈值与冷/热分桶）。
9. 可选证据：录屏 20 次随机导航，人工确认 0 次可见 loading 闪烁（G1 条件 3）。

## 3. dev 模式快速检查（参考）

1. `pnpm dev`。
2. Console 执行 `__vergeNavTiming.start()`，然后按 §2 的 6/7/8 步操作与导出。
3. 注意：dev 的 cold 包含 Vite 按需编译与模块图预热，数值显著高于打包后，且 dev server 已缓存时重复测量会变快；**dev 数据不能用于 200 ms 验收**，hot 也只能作为抖动参考。
4. 不要用 `location.reload()` 来开启采样：dev 下重载会触发 Tauri 自定义 IPC 协议注册竞态（控制台出现 `Fetch API cannot load ipc://localhost/... due to access control checks`），并可能伴随 React 19 的 `use()` 告警与 Tauri callback 失效日志；这些属于 dev 重载噪声。当前协议不要求刷新。

## 4. 阈值与命令行为

| 指标 | 默认门槛 | 说明 |
| --- | ---: | --- |
| hot p95 | ≤ 100 ms | 已访问页面切换 |
| cold p95 | ≤ 200 ms | 首次进入（含 chunk 加载） |
| hot 样本 | ≥ 20 | 不足则 `--check` 失败 |
| cold 样本 | ≥ 8 | 覆盖 8 条路由 |

`pnpm perf:nav-timing` 参数：`--file <path|->`（必填，`-` 读 stdin）、`--check`、`--record`、`--baseline <path>`、`--hot-p95/--cold-p95/--min-hot/--min-cold`、`--json`。阈值可用参数覆盖，但基线记录写入实际使用的阈值。

## 5. 观测记录（非基线，不写入 baseline JSON）

| 日期 | 环境 | cold | hot | 结论 |
| --- | --- | --- | --- | --- |
| 2026-10-19 | dev（Vite 按需编译） | n=8，p50 71 ms / p95 324 ms | n=4，p50 54 ms / p95 125 ms | 样本不足且 cold 受 Vite 编译影响，仅参考 |
| 2026-10-19 | 打包 release（`tauri://localhost`） | n=8，p50 113 ms / p95 1057 ms | n=23，p50 92 ms / p95 752 ms | 未达标：每次进入 `/proxies` 约 571–762 ms，定位为代理页虚拟列表 scroll restore 的 30 帧重试（保存偏移 2268 在组折叠后不可达；dev 运行的数据目录未保存该偏移，故未触发）；已修复（`proxy-groups.tsx` 对 stale 偏移 clamp + 布局稳定即停止），修复后待复测 |

> 首轮 dev 数据（12 条）中 cold p95 来自 `/settings` 首次加载（324 ms）、`/` 首次渲染（231 ms），为 Vite 模块按需编译成本；打包 release 中 `/settings` cold 256 ms、`/profile` 229 ms 属正常首次 chunk 加载范围。

## 6. 已知限制

- **不进 CI**：依赖 macOS WKWebView 与人工导航，ubuntu runner 无法复现；`--check` 作为本机/发布前门禁使用，判定逻辑由 `scripts/perf/nav-timing.test.mjs` 在 CI 中覆盖。
- release 测量包需要 `VITE_NAV_TIMING=1` 构建开关；普通发布构建不包含采样器，因此不影响包体与用户运行路径。
- 不包含操作系统/WebKit 层面的首帧时间；如需 FCP/TTI 请用 DevTools Performance 面板另行采集。
- 后台负载、电源模式会影响绝对值，对比时需同机同电源状态。

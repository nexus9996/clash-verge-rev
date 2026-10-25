# ADR-0004：前端工具链迁移到 Bun + oxlint/oxfmt

- 状态：**Accepted**（记录 2026-10-22 已落地的迁移，2026-10-26 补文档）
- 日期：2026-10-26
- 关联：[ADR-0001](0001-router-choice.md) D4（工具链不替换、保留 bun + oxlint/oxfmt）·
  [上游同步手册](../upstream-sync.md) · [CONTRIBUTING.md](../../CONTRIBUTING.md) ·
  [bundle 基线](../perf/frontend-baseline-2026-10-19.md)
- 代码：`package.json`、`bun.lock`、`.oxlintrc.json`、`.oxfmtrc.json`、`.husky/*`、
  `Makefile.toml`、`scripts/*.mjs`、`scripts-workflow/*`、`.devcontainer/*`、
  `.github/workflows/*`、`renovate.json`、`scripts/contract-inputs.json`

## 1. 背景

`local` 分支在上游 `dev` 的 pnpm 12 + ESLint 10 + Biome 2 + Node 脚本工具链之上做前端改造，
审计阶段发现三套工具职责重叠：ESLint 与 Biome 都做格式与部分 lint 规则，pnpm 安装与 CI
缓存偏慢，脚本入口混用 `node` 与 `pnpm`。与此同时，本地还需要更强的门禁（分层 import、
动态 import 边界、bundle/hex 预算、i18n 生成物校验），这些门禁在 ESLint 下难以完整表达。

迁移前上游状态（`origin/dev:package.json`、workflows）仍是 pnpm + ESLint + Biome；上游不接受
工具链替换类贡献，因此该迁移只保留在 `local` 分叉上，代价是每次同步 `dev` 都要处理
`pnpm-lock.yaml`、`package.json` 与 CI workflow 冲突（流程见 [上游同步手册](../upstream-sync.md)）。

## 2. 决策

### D1 包管理与脚本运行器：Bun

- `packageManager` 改为 `bun@1.4.x`，锁文件只保留 `bun.lock`；删除 `pnpm-lock.yaml` /
  `pnpm-workspace.yaml` 与 `cross-env`。
- `package.json` 全部 scripts 改为 `bun ...`（dev/prebuild/updater/release/i18n/knip/perf 等），
  husky hooks 与 `Makefile.toml`（cargo-make）同样通过 `bun` 调用。
- 同步适配：`scripts/contract-inputs.json` 用 `bun.lock` 替换 `pnpm-lock.yaml`；
  `renovate.json` 使用 bun manager 并对 npm/bun 依赖分组；`.devcontainer` 换 bun feature 与
  bun cache 挂载；`.tool-versions` 改为 `nodejs + bun + rust`。

### D2 Lint/格式化：oxlint + oxfmt 替代 ESLint + Biome

- `oxlint`（`.oxlintrc.json`，当前 154 条规则，含 `no-restricted-imports` 静态 IPC 边界）取代
  ESLint；`oxlint-tsgolint` 提供类型感知检查；`oxfmt`（`.oxfmtrc.json`）统一格式化并接管
  lint-staged。
- ESLint 时代仅有的「动态 import / 分层方向」检查迁移为 `scripts/check-architecture.mjs`
  （TypeScript AST），由 `arch:check` 门禁在 CI 执行，能力比原 ESLint 插件更强。
- 删除 `eslint.config.ts`、`biome.json` 及对应依赖；`.oxlintrc.json` 成为静态边界唯一来源。

### D3 CI 与缓存

- 所有前端 job 使用 `oven-sh/setup-bun` + `bun install --frozen-lockfile`，缓存
  `~/.bun/install/cache`，命令统一 `bun run ...`。
- 保留 `actions/setup-node`（24.22.1）作为部分工具（webdriverio、Tauri CLI、Node shebang）的
  兼容运行时；Node 版本仍随上游 bump 同步。
- 门禁集合不变且全部保留：`format:check`、`lint`、`typecheck`、`test`、`perf:test`、
  `i18n:types` 生成物 diff + `i18n:verify`、`knip:check`、架构门禁、bundle/hex 预算、hygiene。

### D4 文档与开发体验

- `CONTRIBUTING.md`、`docs/frontend-architecture.md`、`AGENTS.md` 中的命令全部改为 bun/oxc；
  Phase 0 基线报告标注了采集时的 pnpm 历史信息与重采后的 bun 基线（`local-2026-10-26`）。

### 关键证据

| 事实 | 数值/来源 |
| --- | --- |
| 上游工具链 | `origin/dev` 仍为 pnpm 12.15 + ESLint + Biome + Node 脚本 |
| oxlint 规则规模 | `bun run lint` 输出 154 rules / 300 files，0 warnings / 0 errors |
| 锁文件校验 | `bun install --frozen-lockfile`：1007 installs / 1085 packages，无变更 |
| CI 缓存 | `~/.bun/install/cache`，key 为 `bun-shared-stable-*` |
| 契约输入 | `scripts/contract-inputs.json` 已列 `bun.lock`，不再列 pnpm lock |
| 迁移提交 | `a60889c8`、`b3e01bd3`、`43295fdc`、`06cce80c`、`742bce8b`、`e1a84769`、`c791b93e`（合并：`baa9fcf5`、`6682327a`） |

## 3. 备选方案

- **B1 只换包管理器（保留 ESLint + Biome）**：安装/CI 提速有限，两者职责重叠仍在，架构门禁
  仍需依赖 ESLint 插件生态。
- **B2 只换 lint/format（保留 pnpm）**：CI 安装与缓存依旧慢，且出现 bun 与 pnpm 双锁文件风险。
- **B3 把迁移贡献给上游**：上游不接受工具链替换类 PR；只能作为分叉维护，冲突面由同步手册吸收。
- **B4 用 Biome 全替代 ESLint**：缺少类型感知与可表达分层/动态 import 的规则能力，无法覆盖
  `src/AGENTS.md` 的 ownership 门禁。

## 4. 后果

**正面**

- 单一锁文件与单一 lint/format 工具链，依赖安装、CI 缓存与本地 pre-commit 明显变快。
- 分层 ownership 检查从 ESLint 插件迁到显式 TS AST 脚本，可同时检查静态与动态 import。
- 门禁数量只增不减（bundle/hex 预算、i18n 生成物 diff、knip、hygiene 全部保留）。

**负面**

- 与上游工具链持续分叉：每次 `dev` 同步都要按同步手册处理 `pnpm-lock.yaml`、workflows、
  `package.json` 冲突（跳过 pnpm 版本提交，摘出 Node bump 与依赖版本）。
- Bun 与部分生态（webdriverio、Tauri CLI、Node shebang 工具）需要 Node 兼容运行时与 CI 覆盖。
- oxlint 规则集需要持续对齐 ESLint 时代的安全/正确性规则，避免门禁退化。

**中性**

- Node 仍然是 CI/devcontainer 中的兼容运行时；发布产物不依赖 Node。
- 缓存目录、锁文件名与部分脚本入口发生变化，回滚时需要同时还原（见 §6）。

## 5. 验证

```bash
bun install --frozen-lockfile
bun run format:check && bun run lint && bun run typecheck
bun run test && bun run perf:test
bun run i18n:verify && bun run knip:check
bun scripts/check-architecture.mjs listen emit invoke
bun run check:bundle-budget && bun run hygiene
```

CI 侧对应 `frontend-check`、`hygiene`、`lint-clippy`（Rust）、`rustfmt` 等 workflow；迁移后
`local` 上该套门禁与 2026-10-26 的 dev 合并均全绿。

## 6. 重新评估条件

1. **上游 `dev` 迁移到 bun/oxc**：跟随上游口径，删除同步手册中的分叉规则并去掉本地补丁。
2. **Bun 出现阻塞性兼容问题**（Tauri CLI / webdriverio / 打包链路）：优先只回退包管理器到
   pnpm（保留 oxc），再评估脚本入口回退 Node。
3. **oxlint 覆盖不足**影响安全类规则：局部引入 typescript-eslint 子集做补充检查，避免回到
   ESLint + Biome 双全套的状态。

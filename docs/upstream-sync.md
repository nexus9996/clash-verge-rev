# 上游同步手册（`dev` → `local`）

`local` 是长期分叉分支：它在上游 `dev` 之上保留了本地前端改造（bun + oxlint/oxfmt 工具链、
设计 token、领域查询 hooks、托盘/窗口定制、内核版本管理等）。本文固定「把上游新提交评估 /
合入 `local`」的流程，避免每次同步靠临场判断。

相关文档：[ADR-0004](adr/0004-frontend-toolchain-bun-oxc.md)（工具链为何与上游分叉）·
[ADR-0001](adr/0001-router-choice.md)（路由选型与回滚记录）。

## 1. 一键预演

```bash
bun run sync:dev            # 拉取 origin/dev 并输出提交、冲突预演、处理规则
bun run sync:dev -- --no-fetch
bun run sync:dev -- --upstream origin/perf/tray-menu-inplace   # 也可评估其它上游分支
bun run sync:dev -- --json  # 机器可读输出（交给 agent）
```

脚本（[`scripts/sync-dev.mjs`](../scripts/sync-dev.mjs)）会输出：

- 上游有、`local` 没有的提交，以及每个提交改动的文件（含 A/M/D 状态）；
- `git merge-tree` 预演的冲突文件（不修改工作区）；
- 按文件匹配的**固定处理规则**（见 §2）；
- 合并后必须通过的验证命令（见 §4）。

脚本不会执行合并，也不会改动任何文件；工作区脏时会提示先提交/暂存。

## 2. 固定处理规则

`local` 与上游的差异大部分集中在下表这些文件。冲突时按表处理，不要「两边都保留」。

| 文件 | 处理 |
| --- | --- |
| `pnpm-lock.yaml`、`pnpm-workspace.yaml` | 保持**删除**：本地用 bun（`bun.lock`） |
| `bun.lock` | 本地文件；移植 `package.json` 依赖后执行 `bun install` 重新生成 |
| `.tool-versions` | 取本地（bun），只移植上游 Node 版本号 |
| `.devcontainer/devcontainer.json` | 取本地（bun feature），只移植 Node 版本号 |
| `.github/workflows/*` | 取本地工作流结构（bun steps / setup-bun），只移植 Node/工具版本号 |
| `package.json` | 取本地 scripts 与工具链；移植上游依赖版本 bump |
| `Changelog.md` | 上游条目移入 `v(Version Goes Here)`，随后跑 `bash scripts-workflow/group_platforms.sh` |
| `src/locales/**`、`src/types/generated/**` | 接受后再生成：`bun run i18n:format && bun run i18n:types` |
| `docs/**`、`AGENTS.md`、`CONTRIBUTING.md` | 取本地（分叉文档）；上游文档改动只在相关时挑选 |
| `scripts/**` | 工具链脚本取本地；`prebuild.mjs`、`service-release.mjs` 与上游共享，逐 hunk 审阅 |
| `Cargo.toml`、`Cargo.lock`、`src-tauri/Cargo.toml` | 正常合并；冲突解决后跑 Rust 验证（§4） |
| `.oxlintrc.json`、`.oxfmtrc.json`、`Makefile.toml`、`knip.json` | 本地专用工具配置，取本地 |

判定原则：**上游的「pnpm 工具链」类提交（pnpm 版本、pnpm-lock 重排）不需要移植**；
其中夹带的 Node 版本 bump 单独摘出；上游依赖版本 bump 需要移植到 `package.json` + `bun.lock`。

## 3. 执行合并

```bash
# 0. 工作区干净；打一个回滚点
git tag -f sync/dev-$(date +%Y%m%d-%H%M) local

# 1. 预演并阅读规则
bun run sync:dev

# 2. 真实合并（保留合并历史，便于以后 merge-base 前进）
git merge --no-commit --no-ff origin/dev

# 3. 冲突处理：按 §2 规则，逐文件 checkout --ours / 手工移植 / git rm
#    完成后确认没有冲突标记
git diff --name-only --diff-filter=U

# 4. 依赖与生成物
bun install --frozen-lockfile     # 若移植了依赖版本则先 bun install
bun run i18n:types                # 若 locale/生成类型有变更
bash scripts-workflow/group_platforms.sh

# 5. 验证（§4 全部通过后提交）
git add -A && git commit -F - <<'EOF'
merge: dev into local (<一句话摘要>)
EOF
```

提交信息约定：`merge: dev into local (...)`，正文列出**采纳**与**跳过/适配**的提交及原因
（参考 `bc8715c4`）。内核若需随特性升级，一并执行 `bun run prebuild:download --force` 并验证
`src-tauri/sidecar/verge-mihomo-* -v`（sidecar 未跟踪，不进入提交），并把
`docs/kernel-versions.json` 更新为新版本（`bun run kernel:check` 校验，CI 定时任务会对比上游），
并跑一次 `bun run kernel:smoke` 验证 `verge-mihomo -t` 能接受 TUN `dns-mode` 配置。

## 4. 验证清单

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run perf:test
bun run i18n:verify
bun run knip:check
bun scripts/check-architecture.mjs listen emit invoke
bun run check:bundle-budget
bun run hygiene
cargo fmt --check
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)
```

若改动 Rust：至少再跑一次 `cargo check --features clippy` 与相关 `cargo test` 过滤用例。
`frontend-check`、`lint-clippy`、`rustfmt`、`hygiene` 等 CI 会跑同一组门禁，本地先跑完再推。

## 5. 回滚

- 合并提交未推送：`git reset --hard sync/dev-<时间戳>`；
- 已推送：`git revert -m 1 <merge-commit>` 或回到备份 tag 后强推（谨慎）。

## 6. 实例：2026-10-26 同步

上游 7 个提交：采纳 TUN `dns-mode`（需 mihomo v1.19.33，已同步升级内核到 v1.19.33 /
alpha-6780eee）、托盘 Win 键修复、Windows common-controls 补丁、perf harness 缩放修复、
Node 24.22.1 与 npm 依赖 bump；跳过 pnpm 12.15.0 与其锁文件改动；`package.json` 冲突只移植
3 个依赖版本。合并提交 `bc8715c4`，后续 `de987a21` 为 `dns-mode` 补了版本门控与测试。

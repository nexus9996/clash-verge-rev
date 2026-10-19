# ADR-0003：状态与数据边界（移除 AppDataProvider，改用领域查询 hooks）

- 状态：**Accepted**
- 日期：2026-10-19
- 关联：[ADR-0001](0001-router-choice.md)（状态选型）、T1（`d6ab8e62`）、T2（`f65c7346`）
- 代码：`src/hooks/data/*`、`src/services/query-client.ts`、`src/store/*`、`src/services/{bus,mutate}`、`src/AGENTS.md`
- 文档：[目标架构 §3](../frontend-architecture.md)

## 1. 背景

旧实现用 `AppDataProvider` + 6 个 context（Proxies/Rules/ClashConfig/System/CoreDataStatus/Refreshers）承载普通数据读：

- 6 层 Provider 嵌套，数据读取与组件树位置耦合；
- Provider 在启动时一次性发起全部查询，即使当前页面不需要；
- callback/refresher 依赖 context，测试与复用成本高；
- 与 `src/AGENTS.md` 的 ownership（query caches retain ordinary reads）方向不一致。

事件（bus）、状态（store）、意图（mutate）与命令（cmds）边界是刻意架构，保持不变。

## 2. 决策

### D1 删除 AppDataProvider / app-data context

- 移除 `providers/app-data-context.ts`（6 context）与 `providers/app-data-provider.tsx`；
- `main.tsx` 组合根不再包数据 Provider，只保留 `SWRConfig` / `AppStoreProvider` / `ThemeModeProvider` / `UpdateStateProvider`。

### D2 普通读改为 `hooks/data/*` 领域查询 hooks

```text
src/hooks/data/
├── query-options.ts          # query key 注册表 + fetch 策略
├── use-proxy-view-data.ts    # getProxyView（15s 轮询）
├── use-rules-data.ts         # getRules + getRuleProviders
├── use-clash-config-data.ts  # getBaseConfig
├── use-system-data.ts        # getSystemProxy + runState + displayed mixed port
├── use-app-refreshers.ts     # 缓存 revalidate（createAppRefreshers 可单测）
├── use-core-data-status.ts   # 由两个 pending 派生
└── index.ts                  # 消费入口
```

- 所有 hooks 复用 `services/query-client`（SWR 封装），key 与旧实现完全一致；
- `useAppRefreshers` 不再依赖 context，直接对同一 key 做 revalidate；
- 查询在消费组件挂载时触发（懒加载），需要在首屏预热时应在 bootstrap 显式预取，而不是恢复全局 Provider；
- 组件 import 从 `@/providers/app-data-context` 迁移到 `@/hooks/data`。

### D3 事件 / 意图 / 命令 ownership 不变

- `services/bus` 仍是唯一 `listen/emit` 点；
- `store` 仍拥有事件态与读序（`store-reads`），`services/mutate` 仍是写操作漏斗；
- `services/cmds` 仍是唯一命令边界，组件不直接 `invoke`；
- 分层方向由 `eslint.config.ts` 的 `import-x/no-restricted-paths` 强制（T2）。

### D4 不引入 Zustand / TanStack Query

沿用 ADR-0001 D3：现有 query client + reducer store + bus 已满足需求；领域 hooks 只是把读取从 context 移到 hook，不更换状态库。

## 3. 后果

**正面**

- 数据读取不再依赖组件树位置；页面按需拉取，减少启动时的空转请求；
- 单个领域 hook 可独立测试（refreshers/query key 已有单测）；
- Provider 嵌套从 6 层降为 0，组合根更清晰。

**负面/权衡**

- 查询触发时机从"根启动"变为"消费挂载"；若某数据在无消费组件时也需要刷新，需显式调用 refresher 或在页面挂载点补 hook；
- 多组件调用同一 hook 会各自订阅（SWR 去重，但订阅数增加）。

**中性**

- 事件态与读序逻辑未变，`src/AGENTS.md` 的 State ownership 描述仍然成立。

## 4. 重评条件

1. 需要跨页面事务型状态（应评估 store/bus，而不是恢复数据 Provider）；
2. 引入 TanStack Query / Zustand 等新状态库（重评 ADR-0001 D3）；
3. 首屏性能要求导致大量显式预热逻辑分散（应集中到 bootstrap 预热层）。

## 5. 参考

- [ADR-0001](0001-router-choice.md)、[目标架构 §3](../frontend-architecture.md)
- 提交：`d6ab8e62`（T1）、`f65c7346`（T2 分层强制）
- 代码：`src/hooks/data/*`、`src/AGENTS.md`、`eslint.config.ts`

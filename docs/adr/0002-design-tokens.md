# ADR-0002：设计 token 与主题体系

- 状态：**Accepted**
- 日期：2026-10-19
- 关联：[ADR-0001](0001-router-choice.md)（路由/样式/状态选型）、S1（`8f4eec1a`）、S3（`e4bc3957`、`566b375b`）
- 代码：`src/config/theme/{defaults,tokens,presets,index}.ts`、`src/hooks/layout/use-custom-theme.ts`、`scripts/check-hex-budget.mjs`
- 文档：[目标架构 §4](../frontend-architecture.md)

## 1. 背景

迁移前主题系统存在三类问题：

1. **颜色散落**：组件里大量 `mode === 'light' ? '#xxx' : '#yyy'` 三元与裸 hex，跨组件重复且难以随主题/预设变化；
2. **主题入口分散**：默认色在 `config/theme.ts`、预设色在 `utils/theme-presets.ts`、CSS 变量在 `use-custom-theme` 内手工注入；
3. **无尺度 token**：间距/圆角/阴影/z-index/遮罩没有语义层。

S2 已由并行分支落地主题预设（6 套）与原生取色器；S1/S3 负责把颜色与尺度收敛到单一 token 层。本 ADR 记录该体系的结构与使用规则。

## 2. 决策

### D1 `config/theme/` 是主题层的唯一入口

```text
src/config/theme/
├── defaults.ts    # defaultTheme / defaultDarkTheme（10 个颜色 key + font）
├── tokens.ts      # 语义 token + CSS 变量生成 + mode surfaces
├── presets.ts     # 6 套主题预设（8 个颜色 key）
└── index.ts       # 对外唯一 import 入口
```

组件不再直接 import `utils/theme-presets` 或历史 `config/theme.ts` 路径。

### D2 语义 token 模型

- **颜色 token**：沿用 `theme_setting` 的 10 个颜色 key（`primary_color`、`secondary_color`、`primary_text`、`secondary_text`、`info_color`、`error_color`、`warning_color`、`success_color`、`background_color`、`paper_background_color`），由 `resolveThemeColors` 解析用户设置 + 默认值。
- **尺度 token**：`SPACE`、`RADIUS`、`SHADOW`、`Z_INDEX`、`OVERLAY`（`tokens.ts`）。
- **mode surfaces**：`cardBackground`、`pageBackground`、`loadingBackground/Text`、`logHighlight`、`switchTrackOff`、`divider`、`scrollbar*`、`dialogBackground` 等，集中取代散落的明暗三元表达式。

### D3 CSS 变量由 token 生成，并保持向后兼容

`createThemeCssVariables({ mode, setting, colors })` 生成：

- **legacy 变量**（名称/语义保持）：`--background-color`、`--divider-color`、`--selection-color`、`--scroller-color`、`--primary-main`、`--background-color-alpha`、`--window-border-color`、`--scrollbar-bg`、`--scrollbar-thumb` 等；
- **语义颜色**：`--color-primary|secondary|info|error|warning|success|text-primary|text-secondary|background|paper|divider|border`；
- **尺度**：`--space-*`、`--radius-*`、`--shadow-*`、`--z-*`、`--overlay-*`；
- **表面/组件**：`--surface-card|page|raised`、`--log-highlight`、`--switch-active|thumb|track-off`。

`use-custom-theme` 只负责把变量应用到 `:root` 并叠加用户设置（背景图/透明度/自定义 CSS/系统暗色）。

### D4 使用规则（CI 强制）

- 组件样式使用 `theme.palette.*`、MUI 语义 shorthand（`background.paper`、`text.disabled`）或上述 CSS 变量；
- **裸 hex 只允许出现在 `config/theme/tokens.ts` 与 `assets/styles` 的 CSS 变量默认值**；
- `scripts/check-hex-budget.mjs`（`pnpm check:hex-budget`，CI 接入）预算为 **0**，新增颜色必须进入 token 文件。

### D5 主题预设与用户自定义主题

6 套预设（default/ocean/indigo/sunset/lavender/monochrome）以 `ThemePresetColorKey`（8 个颜色 key）表达，最终仍写入 `verge.theme_setting`；取色器、字体、背景图、透明度、CSS 注入与系统暗色跟随行为不变。

### D6 不引入 Tailwind

沿用 ADR-0001 D2：rev 的运行时主题/用户 CSS 注入与 MUI 深度耦合，Tailwind 化收益低、回归面大；token 层独立于样式方案，未来如做 UI 重设计可再评估。

## 3. 后果

**正面**

- 主题值单一来源；明暗、预设、自定义主题与尺度统一；
- 新增颜色有明确落点，CI 阻止裸 hex 回潮；
- 组件样式可预期地随主题变化，减少暗色模式修补。

**负面**

- token 文件承担较多 mode-specific 值（属于集中化成本）；
- 视觉上与旧实现约有几处细微归一化（如统一使用 surface/dives 变量），已通过 token 尽量保持原值。

**中性**

- 现有 `sx`/`styled`/SCSS 三种写法不变；S3 仅收敛颜色，未强制统一样式 API。

## 4. 重评条件

1. MUI 主题 API major 变更或引入 `cssVariables`；
2. 产品级 UI 重设计（重新评估 Tailwind/设计系统）；
3. 主题预设需要跨 `theme_setting` 的新颜色 key（需同步 Rust 契约与 14 locale）。

## 5. 参考

- [ADR-0001](0001-router-choice.md)、[目标架构](../frontend-architecture.md)
- 提交：`8f4eec1a`（S1 token 层）、`e4bc3957`/`566b375b`（S3 hex 清零）
- 代码：`src/config/theme/tokens.ts`、`src/hooks/layout/use-custom-theme.ts`、`scripts/check-hex-budget.mjs`

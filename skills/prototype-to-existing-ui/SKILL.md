---
name: prototype-to-existing-ui
description: Use when converting prototypes, wireframes, mockups, Figma exports, screenshots, or UI images into frontend pages that must match the existing project's design system, theme colors, radii, spacing, fonts, component library, and reusable components; read `.ui-reference/` first, otherwise infer the style from the codebase. 当需要把产品原型、线框图、视觉稿、截图或 Figma 导出转成贴合现有项目 UI 风格与组件库的前端页面时使用。
---

# 原型转现有 UI

## 概览

使用这个技能，把产品原型转成“像项目里原本就有”的前端代码。将项目根目录下的 `.ui-reference/` 视为固定的项目 UI 参考来源；如果该目录不存在或信息不足，再从代码库中推断风格后编写 UI。

## 工作流程

1. 阅读原型、视觉稿、截图或 UI 需求，识别需要实现的页面、状态、信息密度和交互。
2. 从仓库根目录查找固定项目参考目录：`.ui-reference/`。
3. 如果 `.ui-reference/` 存在，先读取它，并将其作为项目 UI 决策的主要来源。
4. 如果 `.ui-reference/` 不存在、为空或信息不足，运行 `scripts/discover-style.mjs`，从设计 token、主题文件、全局样式、共享组件和页面结构中推断项目风格。
5. 优先复用缓存状态为 `valid` 或 `reusable` 的 `.ai-ui/inferred-reference.md`。缓存缺失或 UI 语义变化时，再由当前 Agent 归纳机器推断参考；不要让扫描脚本调用外部模型 API。
6. 如果当前环境提供 CodeGraph 或代码图谱 MCP，使用它验证组件复用、Layout 和页面组合关系；将其作为可选证据，缺失或失败时继续使用静态扫描。
7. 编码前形成一份简短的内部风格摘要：颜色、圆角、间距、字体、阴影、边框、布局密度、图标体系、组件库和可复用组件。
8. 先把原型元素映射到现有项目组件，再决定是否需要新增标记或样式。
9. 用最小的页面或组件改动满足原型，同时保持项目已有前端架构。
10. 运行项目相关验证命令，例如 lint、typecheck、测试或视觉冒烟检查。

## 风格来源优先级

当不同风格来源冲突时，按以下顺序决策：

1. 用户对当前任务的明确指令。
2. `.ui-reference/` 下的项目参考文件。
3. 主题 token、设计 token、CSS 变量、Tailwind 配置或设计系统配置。
4. 已有共享组件。
5. 布局、业务域或交互模式相似的已有页面。
6. 通用前端最佳实践。

## 固定参考目录

项目差异固定放在仓库根目录的：

```text
.ui-reference/
```

推荐但不强制的目录内容：

```text
.ui-reference/
  style.md
  tokens.md
  components.md
  screenshots/
  pages/
  prototypes/
```

不要要求每个项目都包含所有文件。使用已经存在的内容即可。`.ui-reference/` 表达项目希望 UI 如何实现，是人工确认的权威来源；除非用户明确要求，或当前任务就是建立项目 UI 参考，否则不要主动创建、覆盖或用机器推断刷新该目录。

## 风格快照

需要可复现、可跨会话复用的风格摘要时，运行本技能自带脚本，把检测结果持久化到仓库根目录的 `.ai-ui/style-snapshot.md`：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs \
  [--root <path>] [--output <path>] [--graph-evidence <path>] \
  [--force-refresh] [--record-inference] [--no-write] [--json]
```

脚本会扫描 `.ui-reference/`、设计 token 文件、CSS 变量、相关 `package.json` 依赖、共享组件、Layout 和页面源码，产出风格快照，并计算两级指纹：相关 UI 输入指纹与归一化 UI 语义指纹。文件内容变化但 UI 语义未变化时，已有机器推断仍可复用。

`.ai-ui/` 是机器派生缓存目录，建议加入 `.gitignore`。扫描脚本只做确定性发现、指纹计算和缓存判断，不直接调用大模型，也不自动创建 `.ui-reference/`。

## 机器推断参考

当 `.ui-reference/` 缺失或不足，且当前 UI 任务需要可跨会话复用的语义摘要时，使用 `assets/inferred-reference-template.md` 生成：

```text
.ai-ui/inferred-reference.md
```

将它明确视为“机器推断、待人工确认”，而不是项目规范。生成或刷新后运行：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --record-inference
```

该命令只记录 `.ai-ui/inference-meta.json`，使后续任务能够判断缓存为 `valid`、`reusable`、`stale-semantic` 或 `graph-refresh-required`。只有缓存缺失、语义失效、推断规则升级或用户显式要求刷新时，才重新归纳 `inferred-reference.md`。详细图谱证据格式、缓存判断和失效规则见 `references/style-discovery.md`。

## 参考资料

- 需要判断如何读取 `.ui-reference/` 或如何从代码库推断风格时，阅读 `references/style-discovery.md`。
- 需要把原型元素映射到现有项目组件时，阅读 `references/component-reuse.md`。
- 需要把视觉原型转换成实现结构、状态和响应式行为时，阅读 `references/prototype-translation.md`。

## 实现规则

- 优先使用已有组件、token、工具函数、布局和命名约定，而不是新增 UI 基础组件。
- 只有现有体系无法表达原型需求时，才新增样式。
- 新增视觉值要尽量贴近项目 token 体系，避免一次性的颜色、圆角、阴影和间距。
- 保留原型的产品意图，但把视觉细节适配到当前项目风格中。
- 如果原型与项目风格冲突，除非用户明确要求重做设计系统，否则优先遵循项目风格。

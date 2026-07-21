# 风格发现

当需要读取项目 UI 参考资料，或需要从现有前端代码库中推断风格时，使用这份参考。

## 固定参考目录

始终先从仓库根目录检查：

```text
.ui-reference/
```

这个目录是项目差异化 UI 参考的固定位置。它可以包含 Markdown 说明、截图、原型导出、示例页面、token 描述或组件使用说明。

如果存在这些内容，按以下顺序阅读：

1. `.ui-reference/style.md`
2. `.ui-reference/tokens.md`
3. `.ui-reference/components.md`
4. `.ui-reference/pages/`
5. `.ui-reference/screenshots/`
6. `.ui-reference/prototypes/`
7. `.ui-reference/` 下其它明显相关的文件

将 `.ui-reference/` 视为“这个项目希望如何生成 UI”的主要指导。它不替代真实代码库；编辑前仍要在源码中确认组件名、导入方式和 token 用法。

## 回退扫描代码库

如果 `.ui-reference/` 不存在或信息不足，就从项目代码中推断风格。优先检查这些文件和目录：

```text
package.json
tailwind.config.*
theme.*
tokens.*
design-system.*
src/styles/
src/theme/
src/components/
src/shared/
src/ui/
components/
app/
pages/
layouts/
styles/
```

先运行确定性扫描脚本：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --json --no-write
```

如果项目提供 CodeGraph、codebase-memory-mcp 或其它代码图谱工具，优先用图谱确认语义关系；图谱不可用时，再使用 `rg` 补充查找重复出现的样式 token 和组件名称。常用搜索包括：

```bash
rg "border-radius|radius|rounded-|--radius" .
rg "#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|oklch\\(" .
rg "--color|colors:|primary|secondary|accent|neutral" .
rg "Button|Card|Modal|Dialog|Table|Input|Select|Badge|Tag" .
```

## 三层参考语义

始终保持这三层的职责分离：

| 位置 | 性质 | 是否权威 |
|---|---|---|
| `.ui-reference/` | 人工维护或明确确认的项目 UI 意图 | 是 |
| `.ai-ui/style-snapshot.md` | 确定性静态扫描事实 | 否 |
| `.ai-ui/inferred-reference.md` | Agent 根据静态扫描与可选图谱证据归纳的草稿 | 否 |

不要自动把 `.ai-ui/` 内容提升到 `.ui-reference/`。只有用户明确要求建立项目 UI 参考时，才创建 `.ui-reference/`，并保留“机器生成草稿、需人工审核”的提示。

## 可选图谱增强

图谱工具用于回答静态目录扫描难以准确判断的问题：

- 哪些组件在真实页面入口中被复用，而不是只存在于 `components/` 目录。
- Layout、路由、页面和共享组件如何组合。
- 哪些组件只有一个使用点，哪些已经形成重复模式。
- 哪些相似页面可以作为原型实现的代表样本。

不要把 CodeGraph 或某个 MCP 设为硬依赖。检测到可用图谱工具时才使用；失败、未初始化或宿主不支持时，继续依赖静态扫描。

把图谱结果归一化为 `.ai-ui/graph-evidence.json`：

```json
{
  "schemaVersion": 1,
  "inputFingerprint": "sha256:...",
  "provider": "codegraph",
  "sharedComponents": [
    {
      "name": "DataTable",
      "path": "src/components/DataTable.tsx",
      "callers": 4
    }
  ],
  "layouts": [
    {
      "name": "DashboardLayout",
      "path": "src/layouts/DashboardLayout.tsx"
    }
  ],
  "pagePatterns": [
    {
      "name": "filter-table-page",
      "callers": 3,
      "components": ["PageHeader", "FilterBar", "DataTable"]
    }
  ]
}
```

先运行扫描脚本取得当前 `fingerprints.input`，再写入图谱证据的 `inputFingerprint`。之后重新运行扫描脚本；只有指纹匹配的图谱证据才参与 UI 语义指纹。

调用数量归一化为：

```text
0 → unused
1 → local-example
2 及以上 → shared-pattern
```

因此调用数从 3 变为 4 不会单独导致机器推断失效；从 1 变为 2 则表示它成为重复模式，应重新归纳。

## 推断缓存与两级指纹

扫描脚本不会调用模型。它只计算：

1. 输入指纹：相关 UI 文件内容和 UI/CSS/图标依赖版本的哈希。
2. 静态语义指纹：归一化后的 token、CSS 变量、组件、Layout、导出符号、共享 class token 和 JSX 复用分类。
3. 综合语义指纹：静态语义加上有效的可选图谱证据。

缓存判断流程：

```text
.ui-reference/ 是否足够？
  ├─ 是：直接使用权威参考，不生成机器推断
  └─ 否：运行 discover-style.mjs
       ├─ valid / reusable：复用 inferred-reference.md
       ├─ graph-refresh-required：刷新图谱证据后再次判断
       └─ missing / stale-* / forced-refresh：当前 Agent 重新归纳
```

相关文件内容变化，但归一化 UI 语义相同时，缓存状态为 `reusable`，不要重新调用模型。例如：

- 修改组件注释、事件处理或数据请求。
- 修改页面文案或业务字段，但仍使用相同 Layout 和组件模式。
- 新增一个继续沿用已有模式的调用点，复用分类没有变化。

这些变化应使缓存失效：

- token、主题、字体、圆角、间距、阴影或 UI 依赖版本改变。
- 共享组件公开结构、组件名称、Layout 或页面组合模式改变。
- 图谱复用分类从 `local-example` 变为 `shared-pattern`。
- 推断 schema 或规则版本升级。
- 用户显式使用 `--force-refresh`。

生成或刷新 `.ai-ui/inferred-reference.md` 后，运行：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --record-inference
```

该命令创建 `.ai-ui/inference-meta.json`。不要手写缓存指纹，也不要把 Git commit、文件修改时间、生成时间、绝对路径或整个仓库哈希作为 UI 语义判断依据。

## 机器推断文档

使用 `assets/inferred-reference-template.md` 创建 `.ai-ui/inferred-reference.md`。每条重要结论应包含真实源码证据和置信度：

```text
结论: 项目主要使用紧凑型数据表格
置信度: high
证据:
  - src/pages/orders/OrderTable.tsx
  - src/pages/users/UserTable.tsx
```

至少两个独立使用点才能称为“项目模式”。只有一个使用点时写成“已有示例”；没有直接源码证据时明确写成“推断”。不要把测试 fixture、废弃目录、生成代码或孤立的硬编码视觉值提升成项目规范。

## 风格摘要

实现前，在内部形成一份简短风格摘要，包含这些字段：

```text
风格来源:
颜色方案:
圆角体系:
间距密度:
字体排版:
边框与阴影:
布局模式:
组件库:
图标体系:
可复用组件:
CSS 体系:
原型适配说明:
```

除非用户要求，不要把完整摘要放进最终回复。它主要用于指导实现决策。

需要可复现、可跨会话复用的摘要时，改用本技能的 `scripts/discover-style.mjs`。静态事实写入 `.ai-ui/style-snapshot.md`；只有任务确实需要语义归纳且缓存失效时，才由当前 Agent 更新 `.ai-ui/inferred-reference.md`。

## 冲突处理

当不同来源冲突时：

1. 当前用户对目标页面的明确指令优先。
2. `.ui-reference/` 优先于宽泛的代码库推断。
3. token 和主题文件优先于孤立组件里的硬编码值。
4. 共享组件优先于一次性的页面实现。
5. 相似已有页面优先于无关示例。

如果原型的视觉语言与项目冲突，保留原型的产品结构和交互意图，同时将颜色、圆角、间距、字体和控件适配为项目风格。

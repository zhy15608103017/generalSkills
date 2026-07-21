# 原型转现有 UI（prototype-to-existing-ui）技能介绍

---

## 一、一句话概括

把产品原型（Figma 导出、线框图、视觉稿、截图）转成**像项目里原本就有**的前端代码，而不是"看起来像原型图直接翻译过来"的一次性页面。

核心目标不是"还原原型像素"，而是**保留原型的产品意图，同时适配项目已有的设计系统、组件库和风格**。

---

## 二、为什么需要这个技能

没有这个技能时，AI 生成 UI 常见两类问题：

| 问题 | 表现 |
|---|---|
| 机械还原原型 | 直接抄原型的颜色、间距、圆角，导致新页面和项目其它页面风格割裂 |
| 自由发挥 | AI 按自己的审美编一套颜色/组件，引入一次性样式值，污染设计系统 |

这个技能的目的是约束 AI：**先读懂项目长什么样，再决定怎么写**。

---

## 三、核心原理

技能围绕一条主线工作：**风格优先级 + 组件复用 + 意图保留**。

### 1. 风格来源有明确优先级

当不同来源冲突时，按顺序决策：

1. 用户对当前任务的明确指令（最高）
2. `.ui-reference/` 项目参考目录
3. 设计 token / 主题文件 / CSS 变量 / Tailwind 配置
4. 已有共享组件
5. 布局或交互相似的已有页面
6. 通用前端最佳实践（最低）

这条优先级链保证：**项目既定风格 > 原型视觉细节**。

### 2. 固定参考目录 `.ui-reference/`

项目根目录下的 `.ui-reference/` 是项目 UI 差异的固定来源。推荐结构：

```
.ui-reference/
  style.md          # 风格说明
  tokens.md         # 设计 token
  components.md     # 组件使用说明
  screenshots/      # 截图参考
  pages/           # 页面示例
  prototypes/       # 原型导出
```

- 存在则先读，作为主要决策依据
- 不存在或不足时，回退到从代码库推断
- **不要主动创建该目录**，除非用户明确要求

### 3. 三层参考，避免把推断当规范

技能把“项目明确意图”和“Agent 从代码中观察到的事实”分开保存：

| 位置 | 内容 | 是否权威 | 谁维护 |
|---|---|---|---|
| `.ui-reference/` | 项目希望 UI 如何实现 | 是 | 团队人工确认后维护 |
| `.ai-ui/style-snapshot.md` | token、样式、组件和依赖的确定性扫描结果 | 否 | 脚本生成 |
| `.ai-ui/inferred-reference.md` | 从扫描和可选图谱证据归纳出的使用建议 | 否 | 当前 Agent 生成、人工可审核 |

因此，Agent 不会因为“看起来合理”就写入 `.ui-reference/`。只有团队明确要求建立或更新项目 UI 参考时，才应把审核后的内容提升到该目录。

### 4. 组件复用优先于新建

写新 UI 前，先在项目里找这些已有组件：Button、Input、Select、Card、Modal、Table、Badge、Tabs、Skeleton、EmptyState……

映射规则示例：

```
主要操作  -> 现有 primary Button 变体
纯图标操作 -> 现有 IconButton
数据列表  -> 现有 Table / DataGrid
状态文本  -> 现有 Badge / Tag
浮层     -> 现有 Modal / Dialog / Drawer
```

只有现有组件无法表达需求时，才新增组件，且必须匹配项目现有命名、导出、样式约定。

### 5. 保留意图，适配风格

| 保留（原型的产品意图） | 适配（落到项目风格） |
|---|---|
| 工作流、内容层级、必需控件、校验和状态要求 | 颜色、圆角、间距、字体、图标、按钮变体、表格密度、表单布局 |

结果应该是：**页面看起来像产品里原本就有的一部分**。

---

## 四、工作流程（10 步）

1. 阅读原型/视觉稿/截图，识别页面、状态、信息密度、交互
2. 查找 `.ui-reference/`
3. 存在则先读，作为主要 UI 决策来源
4. 不存在或不足则运行确定性扫描，读取输入与语义指纹
5. 复用状态为 `valid` 或 `reusable` 的 `.ai-ui/inferred-reference.md`；缓存失效时才由当前 Agent 重新归纳
6. 有 CodeGraph / 代码图谱 MCP 时补充组件复用和页面组合证据，没有则继续静态扫描
7. 编码前形成内部风格摘要（颜色、圆角、间距、字体、阴影、组件库、图标体系、可复用组件）
8. 先把原型元素映射到现有组件，再决定是否新增
9. 用最小改动满足原型，保持已有前端架构
10. 运行 lint / typecheck / 测试 / 视觉冒烟检查

这里的“重新归纳”由正在完成 UI 任务的 Agent 执行；`discover-style.mjs` 本身不调用任何模型 API。

---

## 五、风格快照与缓存

技能自带一个扫描脚本，把检测结果持久化成可跨会话复用的快照：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs \
  [--root <path>] [--output <path>] [--graph-evidence <path>] \
  [--force-refresh] [--record-inference] [--no-write] [--json]
```

脚本会扫描：
- `.ui-reference/` 内容
- token 文件（`tailwind.config.*`、`theme.*`、`tokens.*`、`design-system.*`）
- CSS 变量（按颜色/圆角/间距/字体/阴影/边框分类）
- `package.json` 依赖（识别 Ant Design、MUI、Tailwind、Lucide 等组件库/样式库/图标库）
- 常见组件目录、Layout 和页面源码（如 `src/components`、`src/ui`、`app`、`pages` 等）

产出 `.ai-ui/style-snapshot.md`，包含颜色方案、圆角体系、间距密度、字体排版、可复用组件清单、UI 输入指纹和归一化语义指纹等。它不会直接生成页面代码，也不会直接生成 `.ui-reference/`。

缓存状态含义：

| 状态 | 团队/Agent 应做什么 |
|---|---|
| `valid` | UI 输入和语义未变化，直接复用推断草稿 |
| `reusable` | 相关文件变了，但归一化 UI 语义未变，继续复用 |
| `graph-refresh-required` | 上次使用过图谱证据；先刷新图谱证据再判断 |
| `missing` / `stale-*` / `forced-refresh` | 由当前 Agent 重新归纳草稿，再记录缓存 |

`.ai-ui/` 是缓存目录，建议加入 `.gitignore`；除非用户要求，不要把整份快照粘进最终回复。

### 图谱是可选增强

CodeGraph 或代码图谱 MCP 可以帮助确认“组件是否真的被页面复用”“Layout、路由与页面如何组合”。它们不属于硬依赖：未安装、未初始化或查询失败时，仍然使用静态扫描继续实现。

### 缓存何时失效

- 改注释、数据请求、业务文案，且 Layout、token、组件模式不变：通常继续复用。
- 修改颜色、字体、圆角、间距、阴影、UI 依赖版本、共享组件结构或 Layout：重新归纳。
- 某个模式从单次使用变为多页面复用：重新归纳。
- 用户明确要求刷新：使用 `--force-refresh`。

## 六、生成并记录机器推断草稿

当 `.ui-reference/` 缺失或不足，而且缓存显示需要更新时，当前 Agent 使用 `assets/inferred-reference-template.md` 生成：

```text
.ai-ui/inferred-reference.md
```

草稿必须标注“机器推断、待人工确认”，并为重要结论提供源码证据和置信度。生成后运行：

```bash
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --record-inference
```

这会写入 `.ai-ui/inference-meta.json`，将当前推断与输入、语义和可选图谱指纹关联起来。它只记录缓存，不调用模型，也不修改 `.ui-reference/`。

---

## 七、实现规则速记

- 优先用已有组件、token、工具函数、布局和命名约定
- 只有现有体系无法表达时才新增样式
- 新增视觉值要贴近项目 token，避免一次性颜色/圆角/阴影
- 保留原型产品意图，视觉细节适配项目风格
- 原型与项目风格冲突时，除非用户要求重做设计系统，否则优先项目风格

---

## 八、目录结构

```
skills/prototype-to-existing-ui/
├── SKILL.md                          # 主入口，技能定义与工作流
├── references/
│   ├── style-discovery.md            # 如何读取 .ui-reference/ 或从代码库推断风格
│   ├── component-reuse.md            # 如何把原型映射到现有组件
│   └── prototype-translation.md       # 如何把视觉原型转成实现结构、状态、响应式
├── scripts/
│   └── discover-style.mjs            # 风格快照扫描脚本
├── assets/
│   └── inferred-reference-template.md # 机器推断参考模板
├── agents/
│   └── openai.yaml                   # OpenAI 平台的 agent 配置
└── .gskills/
    └── install.mjs                   # 安装时生命周期钩子
```

---

## 九、要点

1. **它解决什么**：AI 生成 UI 时风格割裂、组件乱造的问题。
2. **它的原则**：项目风格 > 原型像素；复用 > 新建；意图保留，视觉适配。
3. **它依赖什么**：`.ui-reference/`（可选但推荐）以及项目已有 token、样式和共享组件；图谱工具只做可选增强。
4. **怎么触发**：把原型/Figma/截图给 AI，并让它按项目风格实现时，这个技能会自动介入。
5. **我们可以做什么**：为关键项目维护 `.ui-reference/`，让 AI 生成的页面更贴合我们的设计系统。

---

## 十、快速演示路径

```bash
# 1. 在项目根目录运行风格扫描（不写文件，只看 JSON 摘要）
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --json --no-write

# 2. 将原型交给 Agent；若没有有效 .ui-reference/，它会读取快照与可复用推断草稿
#    "按项目风格实现这个原型，优先复用现有组件"

# 3. 当 Agent 新建或刷新 .ai-ui/inferred-reference.md 后，记录缓存
node .agents/skills/prototype-to-existing-ui/scripts/discover-style.mjs --record-inference
```

技能会自动：读取权威参考 → 扫描或复用推断 → 映射组件 → 生成贴合项目风格的代码 → 建议运行验证。

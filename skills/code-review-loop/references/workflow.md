# Code Review Loop 工作流

本文说明如何使用 `code-review-loop` 完成一轮完整、可重复的 AI 审查。这个 skill 是通用能力；项目特定规则应通过 `AGENTS.md`、`--doc` 或 `--checklist` 显式传入。

## 目录

- [适用场景](#适用场景)
- [核心原则](#核心原则)
- [两阶段审查](#两阶段审查)
- [自动策略与进度](#自动策略与进度)
- [标准流程](#标准流程)
- [推荐命令模板](#推荐命令模板)
- [`.ai-reviewignore`](#ai-reviewignore)
- [结果处理建议](#结果处理建议)

## 适用场景

- 功能切片完成后，希望在提交前做一次额外 AI 审查。
- 缺陷修复完成后，希望确认没有引入回归风险。
- 合并、发版、提 PR 前，希望对本地 diff 做结构化检查。
- 用户明确要求“审查这次改动”或“跑一轮 code review”。

## 核心原则

- 审查模型只返回结构化 findings，不直接修改文件。
- 当前编码 agent 负责判断、修复、验证和重新审查。
- `P0`、`P1` 为阻塞问题；`P2`、`P3` 默认属于非阻塞提醒。
- 审查上下文必须覆盖用户原始请求、用户纠正、当前理解、明确反例、验收标准、diff、相关文件上下文、验证结果和项目规则。
- 每次正式代码审查算一轮。工具按请求上下文指纹记录连续未通过轮次，默认最多三轮；`pass` 或新请求会重置闭环。可通过 `AI_REVIEW_MAX_REVIEW_ROUNDS` 或 `--max-review-rounds` 调整，必要时用 `--reset-review-rounds` 显式重置。
- `--verify` 中任意命令退出码非零时，工具会确定性返回 `fail`，不依赖审查模型发现验证失败。
- 模型输出默认严格校验完整 schema；只在兼容旧模型时显式使用 `--relaxed-output`。

## 两阶段审查

`ai-review.mjs` 的非 `dry-run` 流程分为两阶段：

1. **需求理解审计**：使用 `requirement-auditor-prompt.md`，只判断当前模型理解是否忠实反映了用户原始请求、后续纠正和明确反例。
2. **代码审查**：只有需求理解审计返回 `pass` 后，才会检查 diff、实现、集成风险和验证缺口。

如果需求理解审计返回 `fail` 或 `needs_human`，脚本会跳过代码审查，并写出：

```text
.ai-review/latest-result.json
.ai-review/latest-report.md
.ai-review/latest-requirement-audit-result.json
.ai-review/latest-requirement-audit-brief.md
```

## 自动策略与进度

标准入口仍然是：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

`auto` 会自动选择代码审查策略，不需要手动切换：

- 小型和中型改动：运行一次代码审查。
- 大型改动：按变更文件自动拆成并行分片，默认最多 4 片，可用 `--max-shards` 调整上限；分片完成后再追加一次汇总审查，专门检查跨分片集成风险、需求覆盖遗漏，以及可能漏掉的 `P0/P1`。`--max-shards` 只限制自动分片上限，不是手动开关。

运行期间脚本会写入：

```text
.ai-review/latest-status.json
.ai-review/latest-status.md
.ai-review/shards/index.md
.ai-review/shards/shard-<n>.md
```

其中 `.ai-review/shards/` 只会在自动策略选择分片审查时生成，保存每个分片实际发送给审查模型的完整 brief。终端也会输出 heartbeat，显示当前阶段、已等待时间、模型、分片数和策略原因。等待大模型返回时，优先查看 `latest-status.md` 判断是否仍在推进。

## 标准流程

1. 记录本次需求上下文。

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<用户原始请求>" --corrections "<用户后续纠正>" --understanding "<当前模型理解>" --anti-examples "<用户明确否定的行为>" --design "<设计说明>" --acceptance "<验收标准>" --non-goals "<非目标>" --verification "<验证命令>"
```

上下文文件必须自包含。审查模型看不到当前对话历史，不要写“实现第 7-15 条”或“修复上面列出的问题”这类引用；必须内联具体需求、设计决策和验收标准。建议包含以下内容：

- `--request`：用户原始请求和所有具体要求，不要只写摘要或编号引用。
- `--corrections`：用户后续纠正、澄清和变更；没有则写 `无`。
- `--understanding`：当前 agent 对需求的理解，作为待审计内容，而不是既定事实。
- `--anti-examples`：用户明确否定或指出不正确的行为；没有则写 `无`。
- `--design`：关键设计决策、架构选择、权衡，以及为什么这样做。
- `--acceptance`：可验证的验收标准，每条都应来自原始请求或后续纠正。
- `--non-goals`：明确不做什么，避免审查模型把有意省略误判为遗漏。
- `--verification`：应该通过的精确验证命令。

运行审查前，先确认上下文文件存在：

```bash
test -f .ai-review/review-context/current-request.md && echo "EXISTS" || echo "MISSING - create it first"
```

也可以把完整 Markdown 从 UTF-8 文件写入：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

`--request`、`--corrections`、`--understanding`、`--anti-examples`、`--design`、`--acceptance`、`--non-goals` 和 `--verification` 每个结构化字段最多 4000 字符。超长时，`write-review-context.mjs` 会以 `FIELD_TOO_LONG` 失败，清理目标输出文件以避免复用旧上下文，并且不会写入半截 `current-request.md`；请把完整 Markdown 保存为 UTF-8 文件后改用 `--from-file <path>`。只有在明确接受上下文不完整时，才应使用 `--allow-truncate`。

在 Windows PowerShell 下，若直接把包含非 ASCII 字符的 Markdown 通过管道传给原生进程，Node 可能会在接收到内容前把中文替换成 `?`。因此在 Windows 上写完整 Markdown 上下文时，优先使用 UTF-8 文件配合 `--from-file`。

`.ai-review/` 下生成的人读内容默认使用简体中文，包括 review context、brief、reports、summaries、findings 和 verification notes。代码标识符、命令、文件路径、JSON 字段名、枚举值和外部错误文本在更清晰时保留原文。

2. 确认本地存在需要审查的改动。

```bash
git status --short
```

3. 运行本地验证命令。

常见验证包括：

```bash
git diff --check
pnpm test
pnpm lint
node .agents/skills/code-review-loop/scripts/check-syntax.mjs
```

4. 运行 AI 审查。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

如果改动涉及共享函数、配置入口、CLI 参数、跨模块调用链或测试选择，可启用 CodeGraph 影响分析。这是 best-effort 步骤：未安装、未初始化或命令失败时，会把失败原因写入 brief，不阻塞审查脚本继续执行。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

如果当前 agent 已通过 CodeGraph MCP 收集了更精确的调用关系，也可以手动写入 `.ai-review/review-context/codegraph.md`，再作为额外文档传入。保持内容简短，优先记录 `affected` 测试、关键 `callers/callees` 和 `impact` 结论，不要粘贴大段源码。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --doc .ai-review/review-context/codegraph.md --verify "git diff --check"
```

限定路径审查：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

审查暂存区：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

5. 查看输出结果。

```text
.ai-review/latest-brief.md
.ai-review/latest-report.md
.ai-review/latest-result.json
.ai-review/latest-status.md
.ai-review/shards/index.md
```

6. 根据 verdict 处理。

```text
pass         没有阻塞问题，可结合本地验证结果继续交付。
fail         存在 P0/P1 阻塞问题，必须修复后重新审查。
needs_human  上下文不足、需求冲突、模型不确定或风险过高，需要人工判断。
```

7. 修复阻塞问题后，重新验证并重新审查。

## 推荐命令模板

普通审查，标准入口：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

只生成审查上下文，不调用模型，即 dry run。`dry-run` 可在 `.ai-review/review-context/current-request.md` 尚未创建时运行，用于先检查将要发送给审查模型的 diff、项目规则和文件上下文；正式非 `dry-run` 审查仍必须先补齐需求上下文。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --dry-run
```

指定 provider 或模型审查，完整 provider 列表见 `references/provider-config.md`：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --provider deepseek --model deepseek-v4-pro --verify "git diff --check"
```

使用任意 OpenAI-compatible 端点审查：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --provider openai-compatible --base-url https://api.example.com/v1 --model <model> --verify "git diff --check"
```

显式包含验证命令：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --verify "git diff --check"
```

包含项目检查清单：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --checklist docs/review-checklist.md --verify "git diff --check"
```

包含 CodeGraph 影响上下文，best-effort，未安装或命令失败时记录原因后继续：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

若当前 agent 已通过 CodeGraph MCP 收集了更精确的调用关系，可手动准备一份简短的 `.ai-review/review-context/codegraph.md`，优先记录 `affected` 测试、关键 `callers/callees` 和 `impact` 结论，再作为额外文档传入：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --doc .ai-review/review-context/codegraph.md --verify "git diff --check"
```

限定路径审查：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

审查暂存区改动，适合提交前：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

强制重新执行一次需求理解审计，不复用缓存的 `pass` 结果：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --no-requirement-audit-cache --verify "git diff --check"
```

显式重置当前请求的连续未通过轮次：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --reset-review-rounds --verify "git diff --check"
```

启用第二审查模型，双模型配置见 `references/configuration.md`：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --path src --second-provider openai --second-model gpt-5.5
```

## `.ai-reviewignore`

可在仓库根目录创建 `.ai-reviewignore`，排除部分文件不参与审查。规则接近 `.gitignore`，支持 `!` 取反，生效范围包括 `changedFiles`、diff 收集、变更文件上下文、untracked 文件伪 diff，以及 CodeGraph 的变更文件输入：

```gitignore
dist/
*.snap
src/generated/**
!src/generated/keep-me.js
```

如果只是临时缩小本次审查范围，而不是维护长期排除规则，仍然优先使用 `--path` 或 `--paths`。

## 结果处理建议

- `P0`：立即阻塞，通常表示数据丢失、安全漏洞、构建失败或核心流程不可用。
- `P1`：阻塞，通常表示用户可见回归、需求未满足或高概率线上问题。
- `P2`：非阻塞，但建议处理，通常表示边界场景、测试缺口或维护性风险。
- `P3`：低优先级建议，通常表示命名、可读性或未来优化。

不要只因为 AI 审查通过就宣布完成；还需要说明本地验证命令和结果。

`.ai-review/latest-brief.md`、`.ai-review/cache/`、`.ai-review/runs/`、`.ai-review/history.jsonl` 和 `.ai-review/history.md` 可能包含脱敏后但仍与任务相关的代码上下文、findings、审查模型元数据和审查细节，应按敏感本地工件处理。内置脱敏仅用于降低常见密钥暴露风险，不构成完整 DLP 或安全边界；不要把这些审查产物上传到公开位置。

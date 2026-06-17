# Code Review Loop 工作流

本文说明如何使用 `code-review-loop` 做一次完整、可重复的 AI 审核。该 skill 是通用能力；项目规则应通过 `AGENTS.md`、`--doc` 或 `--checklist` 显式传入。

## 适用场景

- 完成功能切片后，希望提交前做外部 AI 审核。
- 修复缺陷后，希望确认是否引入回归风险。
- 合并、发版、提 PR 前，希望对本地 diff 做结构化检查。
- 用户明确要求“审核这次改动”或“跑一轮 code review”。

## 核心原则

- 审核模型只返回结构化 findings，不直接改文件。
- 当前编码 agent 负责判断、修复、验证和再次审核。
- `P0`、`P1` 是阻塞问题；`P2`、`P3` 默认是非阻塞提醒。
- 审核必须包含用户原始请求、用户纠正、当前模型理解、明确反例、验收标准、diff、相关文件上下文、验证结果和项目规则。
- 最多循环三轮审核和修复；仍有阻塞问题时交给人工决策。

## 两阶段审核

`ai-review.mjs` 的非 dry-run 流程分两阶段：

1. **需求理解审核**：使用 `requirement-auditor-prompt.md`，只判断当前模型理解是否忠实于用户原始请求、后续纠正和明确反例。
2. **代码审核**：只有需求理解审核 `pass` 后才检查 diff、实现、集成风险和验证缺口。

如果需求理解审核返回 `fail` 或 `needs_human`，脚本会跳过代码审核，并写出：

```text
.ai-review/latest-result.json
.ai-review/latest-report.md
.ai-review/latest-requirement-audit-result.json
.ai-review/latest-requirement-audit-brief.md
```

## 标准流程

1. 记录本次需求上下文。

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<用户原始请求>" --corrections "<用户后续纠正>" --understanding "<当前模型理解>" --anti-examples "<用户明确否定的行为>" --design "<设计说明>" --acceptance "<验收标准>"
```

也可以把完整 Markdown 从 UTF-8 文件写入：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

2. 确认本地有需要审核的改动。

```bash
git status --short
```

3. 运行本地验证命令。

常见验证包括：

```bash
git diff --check
pnpm test
pnpm lint
```

4. 运行 AI 审核。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

如果改动触及共享函数、配置入口、CLI 参数、跨模块调用链或测试选择，可启用 CodeGraph 影响分析。该步骤是 best-effort：未安装、未初始化或命令失败时会把失败原因写入 brief，不阻塞审核脚本。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

如果当前 agent 已通过 CodeGraph MCP 收集了更精准的调用关系，可以手动写入 `.ai-review/review-context/codegraph.md`，再作为额外文档传入。保持内容简短，优先记录 `affected` 测试、关键 `callers/callees` 和 `impact` 结论，不要粘贴完整大段源码。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --doc .ai-review/review-context/codegraph.md --verify "git diff --check"
```

限定路径审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

审核暂存区：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

5. 查看输出结果。

```text
.ai-review/latest-brief.md
.ai-review/latest-report.md
.ai-review/latest-result.json
```

6. 根据 verdict 处理。

```text
pass         没有阻塞问题，可结合本地验证结果继续交付。
fail         存在 P0/P1 阻塞问题，必须修复后重新审核。
needs_human  上下文不足、需求冲突、模型不确定或风险过高，需要人工判断。
```

7. 修复阻塞问题后重新验证、重新审核。

## 推荐命令模板

普通审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

高准确性审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile high-accuracy --verify "git diff --check"
```

包含项目检查清单：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --checklist docs/review-checklist.md --verify "git diff --check"
```

包含 CodeGraph 影响分析：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

只生成审核上下文，不调用模型：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --dry-run
```

## 结果处理建议

- `P0`: 立即阻塞，通常表示数据丢失、安全漏洞、构建失败或核心流程不可用。
- `P1`: 阻塞，通常表示用户可见回归、需求未满足或高概率线上问题。
- `P2`: 非阻塞但建议处理，通常表示边界场景、测试缺口或维护性风险。
- `P3`: 低优先级建议，通常表示命名、可读性或未来优化。

不要只因为 AI 审核通过就宣布完成；还需要说明本地验证命令和结果。

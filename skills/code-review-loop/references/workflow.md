# Code Review Loop 工作流程

本文档说明如何使用 `code-review-loop` 做一次完整、可重复的 AI 代码审核。该 skill 是通用能力，不绑定任何具体项目；项目规则应通过 `AGENTS.md`、`--doc` 或 `--checklist` 显式传入。

## 适用场景

- 完成一个功能切片后，希望在提交前做外部 AI 审核。
- 修复缺陷后，希望确认是否引入回归风险。
- 合并、发版、提 PR 前，希望对本地 diff 做一次结构化检查。
- 用户明确要求“审核一下这次改动”“跑一轮 code review”。

## 核心原则

- 审核模型只返回结构化 findings，不直接修改文件。
- 当前编码 agent 负责判断、修复、验证和再次审核。
- `P0`、`P1` 是阻塞问题；`P2`、`P3` 默认是非阻塞提醒。
- 审核必须包含需求、diff、相关文件上下文、验证结果和项目规则。
- 最多循环三轮审核和修复；仍有阻塞问题时交给人工决策。

## 标准流程

1. 记录本次需求上下文。

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<用户需求>" --design "<设计说明>" --acceptance "<验收标准>"
```

也可以把完整 Markdown 从 stdin 写入：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-stdin
```

在 Windows PowerShell 中，管道传给原生命令的中文可能会先被替换成 `?`。需要写入完整 Markdown 时，更推荐先保存为 UTF-8 文件再读取：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

2. 确认本地有需要审核的改动。

```bash
git status --short
```

3. 先运行本地验证命令。

常见验证包括：

```bash
git diff --check
node --test <tests>
npm test
pnpm test
pnpm lint
```

4. 运行 AI 审核。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

如果只审核指定路径：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

如果审核暂存区：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

5. 查看输出结果。

```text
.ai-review/latest-brief.md
.ai-review/latest-report.md
.ai-review/latest-result.json
```

- `latest-brief.md`: 实际发送给模型的审核上下文。
- `latest-report.md`: 面向人阅读的审核报告。
- `latest-result.json`: 结构化审核结果，适合脚本读取。

6. 根据 verdict 处理结果。

```text
pass         没有阻塞问题，可以结合本地验证结果继续交付。
fail         存在 P0/P1 阻塞问题，必须修复后重新审核。
needs_human  上下文不足、模型不确定或风险过高，需要人工判断。
```

7. 修复阻塞问题后重新验证、重新审核。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

## 推荐命令模板

普通审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

高准确性审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile high-accuracy --verify "git diff --check"
```

限定路径审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path packages/foo --verify "git diff --check"
```

包含项目检查清单：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --checklist docs/review-checklist.md --verify "git diff --check"
```

多条验证命令：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check" --verify "npm test"
```

只生成审核上下文，不调用模型：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --dry-run
```

## 双模型审核流程

当配置了 `AI_REVIEW_SECOND_*` 或传入 `--second-*` 参数时，脚本会执行两轮模型审核：

1. `PRIMARY` 模型先审核。
2. `SECOND` 模型后审核。
3. 两份结果合并。
4. 任意模型发现 `P0` 或 `P1`，最终 verdict 都会变成 `fail`。

第二模型运行模式由 `AI_REVIEW_SECOND_REVIEW_MODE` 或 `--second-review-mode` 控制：

```text
always  第二模型配置存在且凭证可用时强制双审。
auto    默认值。主模型发现 P0/P1 达到阈值，或 P2 达到阈值时触发第二模型。
off     强制关闭第二模型，即使配置存在也不运行。
```

`auto` 默认阈值是：P0 >= 1、P1 >= 1、P2 >= 3。可通过 `AI_REVIEW_SECOND_P0_THRESHOLD`、`AI_REVIEW_SECOND_P1_THRESHOLD`、`AI_REVIEW_SECOND_P2_THRESHOLD` 或对应命令行参数调整。

建议组合：

- 第一模型：成本较低、速度较快，用于常规问题扫描。
- 第二模型：推理能力更强，用于高风险 diff 或提交前把关。

## 上下文控制

默认情况下，脚本会自动收集：

- 当前 Git diff。
- 变更文件内容片段。
- `.ai-review/review-context/current-request.md`。
- `.ai-review/review-context/current-design.md`。
- `.ai-review/review-context/current-plan.md`。
- `AGENTS.md` 等项目代理规则。
- `--verify` 命令输出。

可用参数控制上下文：

```text
--path <path>                 只审核指定路径
--paths <path-a,path-b>       审核多个路径
--base <ref>                  指定比较基线
--staged                      只审核暂存区
--doc <path>                  额外加入文档
--checklist <path>            加入审核检查清单
--max-doc-bytes <bytes>       调整单个文档大小限制
--max-file-bytes <bytes>      调整文件上下文大小限制
--max-diff-bytes <bytes>      调整 diff 大小限制
```

## 结果处理建议

- `P0`: 立即阻塞，通常表示数据丢失、安全漏洞、构建失败或核心流程不可用。
- `P1`: 阻塞，通常表示用户可见回归、需求未满足或高概率线上问题。
- `P2`: 非阻塞但建议处理，通常表示边界场景、测试缺口或维护性风险。
- `P3`: 低优先级建议，通常表示命名、可读性或未来优化。

不要只因为 AI 审核通过就宣布完成；还需要说明本地验证命令和结果。

## 常见问题

### 没有本地改动时脚本报错

默认需要存在本地改动。确实要审核空上下文时，传入：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --allow-empty
```

### 模型返回非 JSON

脚本会自动重试一次。若仍失败，停止并报告模型输出异常。

### 审核上下文太大

优先使用 `--path` 限定范围，再考虑调大：

```bash
--max-brief-bytes
--max-doc-bytes
--max-file-bytes
--max-diff-bytes
```

### 需要项目专属规则

不要把项目专属规则写进通用 skill。使用：

```bash
--checklist docs/review-checklist.md
--doc docs/specific-design.md
```

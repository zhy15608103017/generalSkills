---
name: code-review-loop
description: 当功能、修复、重构或其他代码改动在完成前需要额外的本地 AI 代码审查时使用。纯文档、纯格式、纯注释、纯错字、锁文件、生成产物、`.ai-review/` 工件或仅依赖版本变更不触发。
---

# Code Review Loop

使用这个技能，对当前 Git 改动运行一套本地 AI 审查闭环。审查模型负责产出结构化结论；当前编码 agent 负责修复、验证和重新审查。

## 不可妥协的规则

- 每次非 `dry-run` 审查前，都必须创建或更新 `.ai-review/review-context/current-request.md`。
- 上下文必须自包含。审查模型看不到对话历史，所以要内联原始请求、后续纠正、当前理解、明确反例、设计决策、非目标、验收标准和验证命令。
- 不要让审查模型直接修改文件。它只返回结构化 findings，当前编码 agent 负责修复、验证并重跑审查。
- 除非用户另有要求，否则只有 `P0` 和 `P1` 视为阻塞问题。
- 每次正式代码审查算一轮。工具会按当前请求上下文指纹记录连续未通过轮次；`pass` 后自动清零，新请求上下文自动开始新闭环。默认最多三轮，可通过 `--max-review-rounds` 或 `AI_REVIEW_MAX_REVIEW_ROUNDS` 配置，必要时用 `--reset-review-rounds` 显式重置。
- 不能只因为 AI 审查通过就宣布任务完成；还要同时汇报本地验证命令和验证结果。
- 通过 `--verify` 传入的任意本地验证命令只要退出码非零，工具就必须将最终结论确定性提升为 `fail`，不能依赖审查模型自行注意到失败。

## 上下文文件

优先使用内置的上下文写入脚本：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<用户请求>" --corrections "<后续纠正>" --understanding "<当前理解>" --anti-examples "<明确反例>" --design "<设计决策>" --acceptance "<验收标准>" --non-goals "<非目标>" --verification "<验证命令>"
```

如果你已经准备好了完整 Markdown，也可以从 UTF-8 文件写入：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

像 `--request`、`--acceptance` 这样的结构化字段，每项最多 4000 字符。超长时写入器会以 `FIELD_TOO_LONG` 失败、删除目标输出文件以避免复用旧上下文，并拒绝写入半截的 `current-request.md`；这时请把完整 Markdown 存成 UTF-8 文件，再用 `--from-file <path>` 重跑。只有在明确接受不完整上下文时，才使用 `--allow-truncate`。

如果是新的需求切片，应覆盖当前上下文，不要把旧需求继续追加进去。`current-design.md` 和 `current-plan.md` 需要时保持简洁；只有审查确实需要时，才用 `--doc` 传入较大的补充文档。

## 需求理解闸门

每次非 `dry-run` 审查，都会先执行一次“需求理解审计”，再决定是否进入代码审查。这个阶段使用 `references/requirement-auditor-prompt.md`，并复用相同的结构化结果 schema。

只有需求理解闸门通过，才会继续审查代码。如果返回 `fail` 或 `needs_human`，脚本会写出 `.ai-review/latest-result.json` 和 `.ai-review/latest-report.md`，跳过代码审查，并按与代码审查失败相同的阻塞语义退出。

成功的需求审计会被缓存；当上下文、提示词和模型都未变化时，会跳过重复审计。若要强制重新执行需求审计，可传入 `--no-requirement-audit-cache`。

## 进度与自动策略

标准入口 `--profile auto` 会自动选择审查策略。小型和中型改动执行一次代码审查；大型改动会先自动拆成并行文件分片，再追加一次汇总审查，用于检查跨分片集成风险、需求覆盖缺口以及遗漏的 `P0/P1` 风险。

运行过程中，脚本会把进度写入 `.ai-review/latest-status.json` 和 `.ai-review/latest-status.md`，并在等待模型调用时持续向 stderr 打印 heartbeat。自动策略选择分片审查时，每个分片实际发送给审查模型的 brief 会写入 `.ai-review/shards/index.md` 和 `.ai-review/shards/shard-<n>.md`。和其他 `.ai-review/` 产物一样，这些状态和分片文件也应按本地敏感信息处理。

## 默认流程

1. 创建或更新 `.ai-review/review-context/current-request.md`，写入原始请求、用户纠正、当前理解、反例、设计、非目标、验收标准和建议验证命令。
2. 用 `git status --short` 确认本地确实存在待审查改动。
3. 先运行与改动匹配的本地验证命令，例如 `git diff --check`、`npm test`。修改本 skill 时可运行 `node .agents/skills/code-review-loop/scripts/check-syntax.mjs` 检查全部 `.mjs`。
4. 如有需要，可先跑一次 `--dry-run`，只检查审查简报内容而不调用模型。`dry-run` 可以在请求上下文文件尚未存在时运行；但正式非 `dry-run` 审查仍然要求 `.ai-review/review-context/current-request.md` 已准备好。
5. 在仓库根目录运行内置审查脚本。它会先跑需求理解闸门，通过后再进入代码审查：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

6. 运行期间，如需查看进度，可检查 `.ai-review/latest-status.md` 或终端 heartbeat 输出。
7. 读取 `.ai-review/latest-result.json` 和 `.ai-review/latest-report.md`；如果是需求闸门拦截，也要查看需求审计相关产物。
8. 汇报全部 findings，但在结束前必须修复所有阻塞性的 `P0/P1` 问题。
9. 阻塞问题需要由当前编码 agent 自己修复，然后重新跑本地验证。
10. 按配置上限重复“审查/修复”闭环。工具会持久化当前请求的连续未通过轮次，默认最多 `3` 轮；`infinity` 表示不设上限。
11. 如果达到最大轮次后仍有阻塞问题，停止自动循环，并把剩余问题交还给人工决策。

## 命令

完整命令目录，例如 dry run、provider 与 OpenAI-compatible 端点、CodeGraph 影响上下文、暂存区审查、第二审查员、检查清单、profiles 和 `.ai-reviewignore`，请查看 `references/workflow.md`。provider、模型、双审配置、超时和环境变量配置，请查看 `references/configuration.md` 与 `references/provider-config.md`。

标准调用命令：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

## 审查结论

- `pass`：没有阻塞问题，可能仍会带有 warnings。
- `fail`：存在一个或多个 `P0` 或 `P1`，必须修复后才能完成交付。
- `needs_human`：审查模型无法安全判断，例如上下文缺失、需求冲突，或补丁风险过高。

如果模型输出结构不合法，应按当前可配置的重试参数重试；若重试耗尽，停止流程并汇报工具失败。
模型输出默认启用严格结构校验。只有兼容不能稳定返回完整 schema 的旧模型时，才使用 `--relaxed-output` 或 `AI_REVIEW_STRICT_OUTPUT=false`；宽松模式可能降低审查门禁可靠性。

## 轮次与重试限制

- 审查/修复闭环轮次上限：`--max-review-rounds <count|infinity>` 或 `AI_REVIEW_MAX_REVIEW_ROUNDS`，默认 `3`。
- 可重试的模型失败只在“快速失败”时触发重试。默认值为：`AI_REVIEW_RETRIES=3`、`AI_REVIEW_RETRY_FAST_FAILURE_MS=10000`、`AI_REVIEW_RETRY_DELAY_MS=5000`。
- 第二审查员可用 `--second-retries`、`--second-retry-fast-failure-ms`、`--second-retry-delay-ms` 或对应的 `AI_REVIEW_SECOND_*` 环境变量覆盖重试预算；未显式设置时，默认继承主审预算。

## 参考资料

- 工作流与完整命令目录：`references/workflow.md`
- 配置说明：`references/configuration.md`
- Provider 配置：`references/provider-config.md`
- 需求理解审计提示词：`references/requirement-auditor-prompt.md`
- 审查员提示词：`references/reviewer-prompt.md`
- 输出 schema：`references/review-result.schema.json`
- 模型列表：`references/model-providers.json`

## 安全

请把 `.ai-review/` 下的产物视为潜在敏感信息处理，它们可能包含本地代码上下文和审查细节。不要把这些文件上传到公开位置。

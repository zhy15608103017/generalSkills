# code-review-loop 使用与配置报告

本文基于 `skills/code-review-loop` 的当前源码和参考文档整理，目标是作为以后使用、排查和维护 `code-review-loop` skill 的一份集中手册。

## 一句话理解

`code-review-loop` 是一个本地 AI 代码审查闭环工具。它会收集当前 Git 变更、项目规则、需求上下文、相关文件片段和验证命令输出，先让模型审核“当前理解是否符合用户需求”，再审核代码实现。审核模型只返回结构化 findings，当前编码 agent 负责修复、验证和重新审查。

在消费项目中，常用入口通常是：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

在本仓库开发 canonical skill 时，源码入口是：

```bash
node skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

## 目录结构

```text
skills/code-review-loop/
  SKILL.md                         skill 主说明和强制流程
  .gskills/install.mjs             安装钩子，写入 AGENTS.md、创建 .ai-reviewignore，并把 .ai-review / .ai-reviewignore 加入 .gitignore
  agents/openai.yaml               agent 元数据
  references/
    configuration.md               配置说明
    workflow.md                    工作流说明
    provider-config.md             provider 配置说明
    model-providers.json           内置 provider 列表
    requirement-auditor-prompt.md  需求理解审核提示词
    reviewer-prompt.md             代码审核提示词
    review-result.schema.json      审核结果 JSON schema
    review-checklist.md            通用审核清单
  scripts/
    ai-review.mjs                  主入口：编排上下文、模型调用、输出和历史
    collect-context.mjs            收集 Git diff、文档、文件上下文、验证输出、CodeGraph
    call-model.mjs                 provider 解析和模型调用
    write-review-context.mjs       生成 .ai-review/review-context/current-request.md
    requirement-audit.mjs          需求理解 gate
    review-profile.mjs             standard/auto/high-accuracy profile
    review-report.mjs              Markdown 报告渲染
    review-display.mjs             history 与展示字段
    review-result.mjs              结果解析与校验
    request-context.mjs            强制检查需求上下文
    render-brief.mjs               组装发给模型的审核 brief
    redact-secrets.mjs             secret redaction
    time-format.mjs                时间和 run id
```

## 标准工作流程

1. 写入本次审核需求上下文。

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs \
  --request "<用户原始请求>" \
  --corrections "<后续纠正；无则写无>" \
  --understanding "<当前 agent 对需求的理解>" \
  --anti-examples "<用户明确拒绝的行为；无则写无>" \
  --design "<实现设计和取舍>" \
  --non-goals "<非目标>" \
  --acceptance "<可验证验收标准>" \
  --verification "<建议运行的验证命令>"
```

默认写入：

```text
.ai-review/review-context/current-request.md
```

2. 确认本地有变更。

```bash
git status --short
```

3. 跑本地验证，并把验证命令传给审核脚本。

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs \
  --profile auto \
  --verify "git diff --check" \
  --verify "npm test"
```

4. 读取输出。

```text
.ai-review/latest-brief.md
.ai-review/latest-report.md
.ai-review/latest-result.json
```

5. 处理 verdict。

| verdict | 含义 | 处理方式 |
| --- | --- | --- |
| `pass` | 没有阻塞 findings | 结合本地验证结果继续交付 |
| `fail` | 存在 `P0` 或 `P1` 阻塞问题 | 修复后重新验证、重新审核 |
| `needs_human` | 上下文不足、需求冲突、模型无法安全判断或风险过高 | 交给人工决策或补上下文后重跑 |

默认只把 `P0` 和 `P1` 视为阻塞；`P2` 和 `P3` 是非阻塞提醒，但最终报告里不能隐藏。

审核/修复闭环默认最多运行 `3` 轮。可以通过 `AI_REVIEW_MAX_REVIEW_ROUNDS` 或 `--max-review-rounds <count|infinity>` 覆盖；值为 `infinity` 时表示无上限，适合明确需要一直循环到无阻塞问题的场景。解析后的值会写入 `latest-brief.md` 和 `history`，供外部 agent 或自动化执行闭环时消费。

## 主入口执行流程

`ai-review.mjs` 的非 dry-run 流程如下：

1. `parseArgs` 解析 CLI 参数。
2. `getGitRoot` 定位仓库根目录。
3. `assertRequestContext` 检查需求上下文存在、非空，并包含必需章节。
4. `collectReviewContext` 收集 Git 状态、diff、变更文件、文档、项目规则、验证输出、可选 CodeGraph。
5. `loadEnvFile` 读取仓库根目录 `.env`，但不会覆盖已存在的 shell 环境变量。
6. `renderReviewBrief` 生成发给模型的完整审核 brief，并写入 `.ai-review/latest-brief.md`。
7. `resolveProviderOptions` 解析主审 provider。
8. `resolveSecondReviewOptions` 尝试解析二审 provider。
9. `runRequirementAudit` 先跑需求理解审核 gate。
10. gate 通过后才进入 `runReviewPasses` 做代码审核。
11. 审核结果写入 latest 文件、run 目录和 history。
12. 根据 verdict 设置退出码。

退出码约定：

| 情况 | 退出码 |
| --- | --- |
| `pass` | `0` |
| `fail` | `2` |
| `needs_human` | `3` |
| 未捕获脚本错误、配置错误 | `1` |

## 需求理解 gate

每次非 dry-run 审核都会先运行需求理解审核。它使用 `references/requirement-auditor-prompt.md`，只判断当前 agent 的理解、设计和验收标准是否忠实于用户原始请求、后续纠正和明确反例。

如果 gate 返回 `fail` 或 `needs_human`：

```text
代码审核会被跳过。
.ai-review/latest-result.json 会写入需求理解审核结果。
.ai-review/latest-report.md 会写入需求理解审核报告。
.ai-review/latest-requirement-audit-result.json 会保留 gate 的结构化结果。
.ai-review/latest-requirement-audit-brief.md 会保留 gate brief。
```

这也是为什么 `current-request.md` 必须自包含，不能写“见聊天记录”或“修复第 7-15 条”。

## 配置来源与优先级

配置来源按优先级从高到低：

1. CLI 参数，例如 `--provider`、`--model`、`--second-provider`。
2. 当前 shell 环境变量。
3. 仓库根目录 `.env`。
4. `references/model-providers.json` 内置 provider 默认值。
5. 脚本硬编码 fallback。

`.env` 只填充当前进程中尚未设置的变量；shell 环境变量会覆盖 `.env`。

## 默认上下文与范围配置

| 配置 | CLI | 默认值 | 作用 |
| --- | --- | --- | --- |
| profile | `--profile` | `standard` | 审核配置档，可为 `standard`、`auto`、`high-accuracy` |
| request 文档 | `--request` | `.ai-review/review-context/current-request.md` | 必需，当前需求上下文 |
| design 文档 | `--design` | `.ai-review/review-context/current-design.md` | 可选，已接受设计 |
| plan 文档 | `--plan` | `.ai-review/review-context/current-plan.md` | 可选，实现计划 |
| 额外文档 | `--doc` | 空 | 可重复传入 |
| 审核清单 | `--checklist` | 空 | 可重复传入 |
| 路径范围 | `--path` / `--paths` | 仓库全部路径 | 限定 diff 和上下文 |
| staged 模式 | `--staged` | false | 审核暂存区 diff |
| diff 基准 | `--base` | `HEAD` | 非 staged 时对比的基准 |
| 外部文档 | `--allow-outside-docs` | false | 是否允许读取仓库外文档 |
| 空审核 | `--allow-empty` | false | 是否允许无变更时继续 |
| 输出目录 | `--out-dir` | `.ai-review` | latest、history、runs 输出目录 |

默认会从 Git pathspec 中排除 `.ai-review/**`，除非你显式把 `.ai-review` 作为审核路径。

## 上下文大小默认值

| 配置 | CLI | 默认值 | high-accuracy 值 | 作用 |
| --- | --- | --- | --- | --- |
| 变更文件上下文数量 | `--max-files` | `12` | `24` | 最多读取多少个变更文件内容 |
| brief 总大小 | `--max-brief-bytes` | `600000` | `1200000` | 发给模型的完整上下文上限 |
| 单个文档大小 | `--max-doc-bytes` | `24000` | `60000` | request/design/plan/doc/checklist 读取上限 |
| 单个文件上下文大小 | `--max-file-bytes` | `120000` | `200000` | 变更文件内容读取上限 |
| diff 大小 | `--max-diff-bytes` | `350000` | `800000` | Git diff 文本上限 |

如果某项通过 CLI 显式设置，`high-accuracy` 不会覆盖它。

## review profile

可选值：

| profile | 行为 |
| --- | --- |
| `standard` | 默认小上下文、默认模型预算 |
| `auto` | 根据风险自动升级到 `high-accuracy` |
| `high-accuracy` | 强制使用高上下文和更长模型预算 |

`auto` 会在以下情况选择 `high-accuracy`：

- 变更文件数 `>= 8`。
- diff 字节数 `>= 150000`。
- 变更路径命中高风险目录或文件，例如 lockfile、Docker/CI/deploy/config、auth/security/session、db/migration/schema、api/router/controller/middleware。
- diff 内容命中高风险模式，例如 `eval`、`exec`、raw SQL、`innerHTML`、明文 secret、网络请求、`child_process`、危险删除等。
- 任意 `--verify` 命令失败。

`high-accuracy` 应用的默认覆盖：

```text
maxFiles=24
maxBriefBytes=1200000
maxDocBytes=60000
maxFileBytes=200000
maxDiffBytes=800000
timeoutMs=180000
retries=3
```

## 主审模型配置

主审 provider 解析逻辑在 `call-model.mjs` 的 `resolveProviderOptions` 中。

| 配置 | CLI | 环境变量 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| provider | `--provider` | `AI_REVIEW_PRIMARY_PROVIDER` | `model-providers.json` 的 `defaultProvider`，当前为 `deepseek` | 选择 provider |
| model | `--model` | `AI_REVIEW_PRIMARY_MODEL` | provider 默认 model | 模型名 |
| base URL | `--base-url` | `AI_REVIEW_PRIMARY_BASE_URL` 或 provider `baseUrlEnv` | provider 默认 baseUrl | API 基地址 |
| API key | 无主审专用 CLI 参数 | `AI_REVIEW_PRIMARY_API_KEY` 或 provider `apiKeyEnv` | 无 | API 凭证 |
| transport | `--transport` | `AI_REVIEW_TRANSPORT` | provider 默认；否则按 apiStyle 推断 | 调用方式 |
| API style | `--api-style` | `AI_REVIEW_API_STYLE` | provider 默认；否则 `chat` | API 风格 |
| CLI command | `--cli-command` | `AI_REVIEW_CLI_COMMAND` 或 provider `commandEnv` | provider 默认 command | CLI reviewer 命令 |
| timeout | `--timeout-ms` | `AI_REVIEW_TIMEOUT_MS` | provider 默认；否则 `120000` | 单次请求超时毫秒 |
| retries | `--retries` | `AI_REVIEW_RETRIES` | provider 默认；否则 `3` | 快速失败时可重试模型错误次数 |
| retry fast failure window | `--retry-fast-failure-ms` | `AI_REVIEW_RETRY_FAST_FAILURE_MS` | provider 默认；否则 `10000` | 单次失败耗时不超过该毫秒数才会重试 |
| retry delay | `--retry-delay-ms` | `AI_REVIEW_RETRY_DELAY_MS` | provider 默认；否则 `5000` | 每次重试前等待毫秒数 |

其他通用环境变量：

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `AI_REVIEW_REASONING_EFFORT` | `high` | Responses API 的 reasoning effort |
| `AI_REVIEW_RESPONSE_FORMAT` | provider 默认；否则 `json_object` | chat completions 的响应格式 |
| `AI_REVIEW_STRICT_SCHEMA` | provider 默认；否则 `true` | Responses API 是否启用严格 JSON schema |
| `AI_REVIEW_STRICT_OUTPUT` | provider 默认；否则 `false` | 本地是否严格校验模型输出结构 |
| `AI_REVIEW_THINKING_TYPE` | provider requestOptions 里的 thinking type | 控制兼容 thinking 字段的模型 |
| `AI_REVIEW_STREAMING` | `false` | chat completions 是否使用流式读取 |
| `AI_REVIEW_MAX_REVIEW_ROUNDS` | `3` | 审核/修复闭环最大轮数；`infinity` 表示无上限 |
| `AI_REVIEW_TIME_ZONE` | 系统本地时区 | 报告时间和 run id 时区 |
| `AI_REVIEW_HISTORY_LIMIT` | `5` | 保留 history/run 记录数，`0` 表示不保留 |

## 内置 provider

| provider | alias | 默认模型 | transport | apiStyle | 默认 baseUrl | API key 环境变量 |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek` | 无 | `deepseek-v4-pro` | `openai-compatible` | `chat` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `openai` | 无 | `gpt-5.5` | `responses` | `responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `mimo` | `xiaomi` | `mimo-v2.5-pro` | `openai-compatible` | `chat` | `https://api.xiaomimimo.com/v1` | `MIMO_API_KEY`, `XIAOMI_API_KEY` |
| `glm` | `zhipu`, `zai` | `glm-5.1` | `openai-compatible` | `chat` | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY`, `ZHIPU_API_KEY`, `BIGMODEL_API_KEY` |
| `openai-compatible` | `compatible` | `gpt-5.5` | `openai-compatible` | `chat` | `https://api.openai.com/v1` | 无内置 key env |
| `cli` | `local-cli` | `cli-reviewer` | `cli` | 无 | 无 | 无，使用 command |

`provider` 也可以通过 model 名反查。例如只设置 `AI_REVIEW_SECOND_MODEL=mimo-v2.5-pro` 时，会优先匹配 `model-providers.json` 中相同 model 的 provider，再读取该 provider 的 key。

## 二审模型配置

二审在 `ai-review.mjs` 中解析。关键点：

- `AI_REVIEW_SECOND_API_KEY` 只提供凭证，单独设置不会启用二审。
- 需要至少设置一个二审路由字段：provider、model、baseUrl、apiStyle、transport 或 cliCommand。
- 配置存在后，还必须经过 `resolveProviderOptions` 判断可用。API transport 需要 baseUrl 和 apiKey；CLI transport 需要 cliCommand。
- 二审会设置 `usePrimaryEnv=false`，避免误用主审专属环境变量。

| 配置 | CLI | 环境变量 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| provider | `--second-provider` | `AI_REVIEW_SECOND_PROVIDER` | 可由 second model 反查，或回退主审 provider | 二审 provider |
| model | `--second-model` | `AI_REVIEW_SECOND_MODEL` | 主审 model 或 provider 默认 model | 二审模型 |
| base URL | `--second-base-url` | `AI_REVIEW_SECOND_BASE_URL` | 主审 baseUrl 或 provider 默认 | 二审 API 基地址 |
| API key | `--second-api-key` | `AI_REVIEW_SECOND_API_KEY` 或 provider key env | 无 | 二审凭证 |
| transport | `--second-transport` | `AI_REVIEW_SECOND_TRANSPORT` | 主审 transport 或 provider 默认 | 二审调用方式 |
| API style | `--second-api-style` | `AI_REVIEW_SECOND_API_STYLE` | 主审 apiStyle 或 provider 默认 | 二审 API 风格 |
| CLI command | `--second-cli-command` | `AI_REVIEW_SECOND_CLI_COMMAND` | 主审 cliCommand 或 provider 默认 | 二审 CLI reviewer |
| mode | `--second-review-mode` | `AI_REVIEW_SECOND_REVIEW_MODE` | `auto` | 二审运行模式 |
| P0 阈值 | `--second-p0-threshold` | `AI_REVIEW_SECOND_P0_THRESHOLD` | `1` | auto 模式触发阈值 |
| P1 阈值 | `--second-p1-threshold` | `AI_REVIEW_SECOND_P1_THRESHOLD` | `1` | auto 模式触发阈值 |
| P2 阈值 | `--second-p2-threshold` | `AI_REVIEW_SECOND_P2_THRESHOLD` | `3` | auto 模式触发阈值 |
| confidence 阈值 | `--second-confidence-threshold` | `AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD` | `0.8` | 主审低置信度触发二审 |
| timeout | `--second-timeout-ms` | `AI_REVIEW_SECOND_TIMEOUT_MS` | 继承主审预算 | 二审单次请求超时毫秒 |
| retries | `--second-retries` | `AI_REVIEW_SECOND_RETRIES` | 继承主审预算 | 二审请求重试次数 |
| retry fast failure window | `--second-retry-fast-failure-ms` | `AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS` | 继承主审预算 | 二审快速失败重试窗口 |
| retry delay | `--second-retry-delay-ms` | `AI_REVIEW_SECOND_RETRY_DELAY_MS` | 继承主审预算 | 二审每次重试前等待毫秒数 |

二审 mode：

| mode | 触发方式 |
| --- | --- |
| `off` | 永不运行二审 |
| `always` | 二审配置可用时，主审和二审并行运行 |
| `auto` | 默认。主审先运行，达到 finding 阈值或 `confidence < 阈值` 后再串行运行二审 |

二审降级语义：

- `always` 中主审和二审并行，任意一边失败或超时，使用成功一边的结果，并写入 `verification_notes`。
- `auto` 中主审成功后才判断是否二审；二审失败或超时，使用主审结果，并写入原因。
- 如果主审失败但二审配置可用且允许运行，会尝试二审；二审成功则使用二审结果。
- 如果主审和二审都失败，返回结构化 `needs_human`，不会直接丢失结果。

## 模型调用方式

`callReviewModel` 根据 `transport` 选择三条路径：

| transport/apiStyle | 路径 | 说明 |
| --- | --- | --- |
| `openai-compatible` + `chat` | `/chat/completions` | 发送 system/user messages，默认 `temperature=0` |
| `responses` 或 `apiStyle=responses` | `/responses` | 使用 `text.format=json_schema`，可设置 reasoning effort |
| `cli` | 本地命令 | 将 prompt 和 schema 写入 stdin，解析 stdout 或 stderr |

API 请求使用 `AbortController` 做超时。模型调用默认最多重试 `3` 次，但只有单次失败耗时不超过 `10000ms` 时才会重试；每次重试前默认等待 `5000ms`。这三个值分别由 `--retries` / `AI_REVIEW_RETRIES`、`--retry-fast-failure-ms` / `AI_REVIEW_RETRY_FAST_FAILURE_MS`、`--retry-delay-ms` / `AI_REVIEW_RETRY_DELAY_MS` 配置。可重试错误包括：

- `AbortError`
- HTTP `429`
- HTTP `>=500`

模型输出为空或没有合法 JSON 时，`callReviewModelWithMalformedRetry` 使用同一组 `retries/window/delay` 参数重试；它和单次 API/CLI 调用内部的网络重试是两层机制，不共享一个全局计数器。

## CodeGraph 配置

| 配置 | CLI | 默认值 | 作用 |
| --- | --- | --- | --- |
| 是否启用 | `--codegraph` | false | 是否收集 CodeGraph 影响分析 |
| 深度 | `--codegraph-depth` | `5` | 传给 `codegraph affected -d` |
| 命令 | `--codegraph-command` | Windows 为 `codegraph.cmd`，其他平台为 `codegraph` | 覆盖 CodeGraph CLI |

流程：

1. 跑 `codegraph status -j <repo>`。
2. 如果 status 成功、返回 JSON 且 initialized 不为 false，再跑 `codegraph affected -p <repo> -d <depth> -j -- <changed-files>`。
3. `.ai-review/**` 和 secret-like 文件会被排除。
4. CodeGraph 失败是 best-effort，会写入 brief，不阻断审核。

## `.ai-review` 输出文件详解

默认输出根目录为 `.ai-review`，可通过 `--out-dir` 覆盖。整体结构如下：

```text
.ai-review/
  latest-brief.md                                ← 每次审核开始时写入，总是最新
  latest-result.json                              ← 审核完成后写入（可能含需求审核或代码审核结果）
  latest-report.md                               ← 与 latest-result.json 配套的人读报告
  latest-requirement-audit-result.json            ← 仅在需求理解审核阶段生成
  latest-requirement-audit-brief.md               ← 仅在需求理解审核阶段生成
  history.jsonl                                  ← 审核历史索引（追加写入，超限时整体重写）
  history.md                                     ← 审核历史的 Markdown 可读版本
  runs/
    <run-id>/
      result.json                                ← 单次运行的审核结果快照
      report.md                                  ← 单次运行的报告快照
      brief.md                                   ← 单次运行的 brief 快照
  cache/
    requirement-audit.json                       ← 需求审核通过的缓存结果
    file-contexts.json                           ← 变更文件内容片段的读取缓存
  review-context/
    current-request.md                           ← 用户/agent 手写或由 write-review-context.mjs 生成的需求上下文
    current-design.md                            ← 可选：已接受设计（手写或生成）
    current-plan.md                              ← 可选：实现计划（手写或生成）
```

### 顶层 `latest-*` 文件

每次运行 `ai-review.mjs` 后，这些文件总是会被覆盖为最新结果。

| 文件 | 格式 | 何时生成 | 内容 |
| --- | --- | --- | --- |
| `latest-brief.md` | Markdown | 审核开始时（`main()` 阶段），在任何模型调用之前 | 发送给代码审核模型的完整上下文摘要。包含：仓库根目录、生成时间、profile、git status、diff stat、完整 diff（经脱敏和截断）、变更文件内容上下文（经脱敏）、项目规则（`AGENTS.md`）、需求/设计/计划文档、审核清单、验证命令输出、可选的 CodeGraph 影响分析。**可用于检查"模型到底看到了什么"。** |
| `latest-result.json` | JSON | 审核完成后（需求审核或代码审核结束后） | 最近一次审核的完整结构化结果。包含 `verdict`（`pass`/`fail`/`needs_human`）、`summary`、`blocking_findings`（P0-P3 数组，每项含 severity/title/file/line/evidence/impact/suggested_fix/sources）、`warnings`、`verification_notes`、`confidence`（0-1）、`verdict_label`（中文展示标签）和 `reviewer_failures`（模型调用失败的详细信息）。**是自动化工具读取审核结论的主要入口。** |
| `latest-report.md` | Markdown | 与 `latest-result.json` 同时生成 | 人读的审核报告。将 `latest-result.json` 中的 verdict、findings、verification_notes 渲染为结构化 Markdown，适合在终端或编辑器中直接查看。 |

### 需求理解审核产物

这两个文件**仅在需求理解审核阶段生成**。如果需求审核 pass，代码审核继续进行，但这两个文件不会被后续代码审核覆盖。如果需求审核返回 `fail` 或 `needs_human`，代码审核被跳过，`latest-result.json` 和 `latest-report.md` 写入的也是需求审核的结果。

| 文件 | 格式 | 何时生成 | 内容 |
| --- | --- | --- | --- |
| `latest-requirement-audit-result.json` | JSON | 需求理解审核完成后 | 需求审核的独立结构化结果，schema 与代码审核相同（verdict/summary/findings/confidence），但 findings 只关注"当前模型理解是否忠实于用户请求"，不涉及代码实现问题。 |
| `latest-requirement-audit-brief.md` | Markdown | 与上述 JSON 同时生成 | 发送给需求理解审核模型的上下文。结构与 `latest-brief.md` 类似，但包含需求上下文、项目规则和文档内容，**不包含 diff 和文件上下文**。 |

### 历史索引

| 文件 | 格式 | 行为 | 内容 |
| --- | --- | --- | --- |
| `history.jsonl` | JSONL（每行一个 JSON） | 每次审核后追加一条记录；超限时整体重写裁剪 | 历史审核的结构化索引。每条记录包含 `runId`、`timestamp`、`verdict`、`provider`/`model`、`resolved`（双模型信息）、`scope`、`counts`（各级别 finding 数量）等。适合工具化查询和趋势分析。 |
| `history.md` | Markdown | 与 `history.jsonl` 同步更新 | 与 `history.jsonl` 一一对应的人读版本，每条记录渲染为一个 Markdown 段落。 |

默认保留最近 5 条（由 `AI_REVIEW_HISTORY_LIMIT` 或 `--history-limit` 控制）。设为 `0` 时，历史索引和 runs 目录均不保留。

### `runs/<run-id>/` 归档

每次审核运行会在 `runs/` 下创建一个以时间戳命名的目录，保存本次运行的完整快照。

`run-id` 格式为 `YYYY-MM-DD_hh-mm-ss`（受 `AI_REVIEW_TIME_ZONE` 影响）。如果同秒内多次运行，自动追加 `-2`、`-3` 后缀。

| 文件 | 与顶层的关系 |
| --- | --- |
| `runs/<run-id>/result.json` | 内容与生成时的 `latest-result.json` 相同，是历史快照 |
| `runs/<run-id>/report.md` | 内容与生成时的 `latest-report.md` 相同 |
| `runs/<run-id>/brief.md` | 内容与生成时的 `latest-brief.md` 相同 |

当 `latest-*` 被下次审核覆盖后，runs 目录是唯一能回溯到历史审核详情的地方。超出保留条数的 run 目录会被自动清理。

### `cache/` 目录

缓存文件由脚本管理，**不建议手动编辑**。

| 文件 | 格式 | 何时写入 | 失效条件 | 内容 |
| --- | --- | --- | --- | --- |
| `cache/requirement-audit.json` | JSON | 需求审核 verdict 为 `pass` 时 | 需求/设计/计划文档变更、`AGENTS.md` 变更、审核 prompt 变更、主审 provider 或 model 变更、传 `--no-requirement-audit-cache` | 缓存通过的审核结果，避免上下文未变时重复调用模型。包含 version、cacheKey（基于上下文+prompt+模型信息的哈希）、cachedAt、result。 |
| `cache/file-contexts.json` | JSON | 收集变更文件上下文后 | 文件 mtime 变更、文件路径变更、maxFileBytes 变更、缓存版本号升级 | 变更文件内容片段的读取缓存，避免重复磁盘 I/O。最多缓存 200 条，超出时按 mtime 降序淘汰。key 格式为 `{version}::{filePath}::{mtime}::{maxFileBytes}`。 |

### `review-context/` 目录

这些文件是**审核流程的输入**，不是输出。它们由用户或 `write-review-context.mjs` 脚本在审核运行前创建。

| 文件 | 用途 | 必需性 |
| --- | --- | --- |
| `review-context/current-request.md` | 本次审核的需求上下文。包含：用户原始请求（原文）、用户后续纠正/澄清、当前模型理解（待审核，不是事实）、明确反例/非期望行为、设计结论、非目标、验收标准、建议验证。**必须包含至少 5 个必需章节，否则审核脚本拒绝运行。** | **必需** |
| `review-context/current-design.md` | 已接受的设计方案摘要。会被纳入审核 brief 供模型判断实现是否符合设计意图。 | 可选 |
| `review-context/current-plan.md` | 实现计划摘要。同样纳入 brief。 | 可选 |

### 安全提醒

`.ai-review/` 下的文件（特别是 `latest-brief.md`、`runs/` 中的 `brief.md`、`history.jsonl`）可能包含本地代码上下文、diff 片段和文件内容。`.gskills/install.mjs` 会把 `.ai-review` 加入消费项目的 `.gitignore`，防止这些文件被误提交。不要手动将这些文件上传到公开位置。

## 审核结果结构

模型必须返回符合 `review-result.schema.json` 的 JSON：

```json
{
  "verdict": "pass",
  "summary": "...",
  "blocking_findings": [],
  "warnings": [],
  "verification_notes": [],
  "confidence": 0.9
}
```

finding 结构：

```json
{
  "severity": "P1",
  "title": "...",
  "file": "src/file.ts",
  "line": 12,
  "evidence": "...",
  "impact": "...",
  "suggested_fix": "..."
}
```

runner 会额外加展示字段：

- `verdict_label`
- finding 的 `sources`
- history 中的 reviewers、scope、counts、details

## 常用命令模板

只生成 brief，不调用模型：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --dry-run
```

普通审核：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

覆盖审核/修复闭环轮数：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --max-review-rounds 5 --verify "git diff --check"
node .agents/skills/code-review-loop/scripts/ai-review.mjs --max-review-rounds infinity --verify "git diff --check"
```

带测试输出：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs \
  --profile auto \
  --verify "git diff --check" \
  --verify "npm test"
```

只审某个目录：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

审暂存区：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

强制高准确度：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile high-accuracy --verify "git diff --check"
```

启用 CodeGraph：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

强制二审并行：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs \
  --second-provider openai \
  --second-model gpt-5.5 \
  --second-review-mode always \
  --verify "git diff --check"
```

二审 auto 并控制预算：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs \
  --second-review-mode auto \
  --second-timeout-ms 60000 \
  --second-retries 3 \
  --second-retry-fast-failure-ms 10000 \
  --second-retry-delay-ms 5000 \
  --second-confidence-threshold 0.8 \
  --verify "git diff --check"
```

## 推荐配置

日常单模型：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TIMEOUT_MS=120000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
AI_REVIEW_MAX_REVIEW_ROUNDS=3
```

提交前双模型：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_API_KEY=<primary-key>
AI_REVIEW_TRANSPORT=openai-compatible

AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_API_KEY=<second-key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD=0.8
AI_REVIEW_SECOND_TIMEOUT_MS=60000
AI_REVIEW_SECOND_RETRIES=3
AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_SECOND_RETRY_DELAY_MS=5000
```

API style 通常可以由 provider 默认值推断；如需显式设置，DeepSeek/OpenAI-compatible chat 使用 `AI_REVIEW_API_STYLE` 取值 `chat`，OpenAI Responses 二审使用 `AI_REVIEW_SECOND_API_STYLE` 取值 `responses`。

企业网关：

```env
AI_REVIEW_PRIMARY_PROVIDER=openai-compatible
AI_REVIEW_PRIMARY_MODEL=<internal-model>
AI_REVIEW_PRIMARY_BASE_URL=https://internal-gateway.example.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
```

企业网关如果兼容 `/chat/completions`，`AI_REVIEW_API_STYLE` 通常使用 `chat`；如果网关兼容 Responses API，则按网关能力改为 `responses`。

CLI reviewer：

```env
AI_REVIEW_PRIMARY_PROVIDER=cli
AI_REVIEW_TRANSPORT=cli
AI_REVIEW_CLI_COMMAND=reviewer-cli --json
```

只应从可信配置里设置 CLI command，因为它会通过系统 shell 执行。

## 故障排查

### 缺少需求上下文

报错类似：

```text
缺少审核需求上下文: .ai-review/review-context/current-request.md
```

解决：

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "..." --understanding "..." --acceptance "..."
```

### 需求理解 gate 未通过

说明当前 agent 写入的理解、设计或验收标准不够忠实。优先修 `.ai-review/review-context/current-request.md`，不要急着改代码。

### Missing API key

检查：

```env
AI_REVIEW_PRIMARY_API_KEY=<key>
```

或 provider 专属 key：

```env
DEEPSEEK_API_KEY=<key>
OPENAI_API_KEY=<key>
```

### Missing base URL

检查：

```env
AI_REVIEW_PRIMARY_BASE_URL=<url>
```

或确认 provider 在 `model-providers.json` 中有默认 baseUrl。

### 二审没有运行

检查是否关闭：

```env
AI_REVIEW_SECOND_REVIEW_MODE=off
```

检查是否有二审路由字段。至少要设置一个：

```env
AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_BASE_URL=https://api.openai.com/v1
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_CLI_COMMAND=reviewer-cli --json
```

OpenAI Responses 二审通常将 `AI_REVIEW_SECOND_API_STYLE` 设为 `responses`；OpenAI-compatible chat 二审通常设为 `chat`。

注意：只设置 `AI_REVIEW_SECOND_API_KEY` 不会启用二审。

如果是 `auto` 模式，确认主审结果是否达到触发条件：

```env
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD=0.8
```

### 请求超时

主审：

```env
AI_REVIEW_TIMEOUT_MS=180000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
```

二审：

```env
AI_REVIEW_SECOND_TIMEOUT_MS=60000
AI_REVIEW_SECOND_RETRIES=3
AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_SECOND_RETRY_DELAY_MS=5000
```

### 上下文太大

优先缩小范围，而不是盲目增大上限：

```bash
--path src/specific-area
```

再考虑增大：

```bash
--max-brief-bytes 1200000 --max-diff-bytes 800000 --max-file-bytes 200000
```

### 模型返回非 JSON

脚本会对空输出或无合法 JSON 的情况按同一组可配置重试参数重试。如果仍失败，建议：

- 换 `responseFormat`。
- 开启 `AI_REVIEW_STRICT_OUTPUT=true` 让本地更严格暴露问题。
- 对 OpenAI-compatible 网关确认是否支持 `response_format: { type: "json_object" }`。
- 对 CLI reviewer 确认 stdout 是单个 JSON 对象。

## 维护注意事项

- `skills/` 是 canonical source。不要手改消费项目里的 `.agents/skills`、`.claude/skills`、`.opencode/skills` 生成副本。
- 修改 `scripts/` 后运行 `npm test`。
- 修改 skill 文档或 references 后运行 `npm run validate`。
- 完成本地代码或文档变更后，按仓库规则运行 `code-review-loop` 自审。
- `.ai-review/latest-brief.md`、`.ai-review/runs/`、`.ai-review/history.*` 可能包含本地代码上下文，不要上传到公开位置。

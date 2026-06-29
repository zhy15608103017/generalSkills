# Code Review Loop 配置文档

本文档说明 `code-review-loop` 的模型、`.env`、双模型和命令行参数配置方式。该配置是通用的，不绑定具体项目。

## 目录

- [配置来源优先级](#配置来源优先级)
- [最小配置](#最小配置)
- [双模型配置](#双模型配置)
- [主模型变量](#主模型变量)
- [第二模型变量](#第二模型变量)
- [通用运行变量](#通用运行变量)
- [transport 和 api style](#transport-和-api-style)
- [内置 provider](#内置-provider)
- [Provider 示例](#provider-示例)
- [命令行覆盖](#命令行覆盖)
- [推荐配置策略](#推荐配置策略)
- [安全建议](#安全建议)
- [`.ai-reviewignore`](#ai-reviewignore)
- [故障排查](#故障排查)

## 配置来源优先级

配置按以下优先级生效：

1. 命令行参数，例如 `--provider`、`--model`、`--second-provider`。
2. 当前 shell 环境变量。
3. 仓库根目录 `.env`。
4. `references/model-providers.json` 中的 provider 默认值和 provider 专属环境变量。

shell 环境变量会覆盖 `.env`。`.env` 只会填充当前进程中尚未设置的变量。

同一模型的字段优先级是：

```text
审核模型配置 > provider 自身配置
```

例如主模型或第二模型没有配置 `AI_REVIEW_PRIMARY_API_KEY` / `AI_REVIEW_SECOND_API_KEY` 时，会回退读取 provider 的 `apiKeyEnv`，例如 MiMo provider 会读取 `MIMO_API_KEY` 或 `XIAOMI_API_KEY`。模型名也可以用于反查 provider；例如只配置 `AI_REVIEW_SECOND_MODEL=mimo-v2.5-pro` 时，脚本会优先匹配 `model-providers.json` 中 model 相同的 provider，再读取该 provider 的 key。

## 最小配置

只配置一个主模型：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_BASE_URL=https://api.deepseek.com/v1
AI_REVIEW_PRIMARY_API_KEY=<primary-key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
```

运行：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto
```

## 双模型配置

双模型配置示例：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_BASE_URL=https://api.deepseek.com/v1
AI_REVIEW_PRIMARY_API_KEY=<primary-key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat

AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_BASE_URL=https://api.openai.com/v1
AI_REVIEW_SECOND_API_KEY=<second-key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD=0.8
AI_REVIEW_SECOND_TIMEOUT_MS=60000
AI_REVIEW_SECOND_RETRIES=3

AI_REVIEW_TIMEOUT_MS=180000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
AI_REVIEW_MAX_REVIEW_ROUNDS=3
```

审核方式：

```text
always: PRIMARY 和 SECOND 并行审核
auto:    PRIMARY 先审核，达到触发条件后 SECOND 后审核
off:     只运行 PRIMARY
当 PRIMARY 和 SECOND 都成功时，最终结果合并
任意模型发现 P0/P1 都会阻塞
任意一个审核模型失败或超时时，会降级使用已成功模型的结果，并在 verification_notes 和报告中记录原因
```

第二模型配置存在条件：

- 设置 `AI_REVIEW_SECOND_PROVIDER`
- 或设置 `AI_REVIEW_SECOND_MODEL`
- 或设置 `AI_REVIEW_SECOND_BASE_URL`
- 或设置 `AI_REVIEW_SECOND_TRANSPORT`
- 或设置 `AI_REVIEW_SECOND_API_STYLE`
- 或设置 `AI_REVIEW_SECOND_LOCAL_CLI`
- 或设置 `AI_REVIEW_SECOND_CLI_COMMAND`

`AI_REVIEW_SECOND_API_KEY` 只提供凭证，单独设置它不会启用第二轮审核。

第二模型运行模式：

```env
AI_REVIEW_SECOND_REVIEW_MODE=auto
```

可选值：

```text
always  第二模型配置存在且凭证可用时，强制运行第二轮审核。
auto    默认值。主模型返回的 P0/P1/P2 达到配置阈值时，才运行第二轮审核。
off     完全关闭第二轮审核，即使配置了第二模型也不会运行。
```

`auto` 模式默认阈值：

```env
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD=0.8
```

`auto` 模式下，主模型返回的 P0/P1/P2 数量达到阈值，或主审 `confidence` 小于 `AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD`，都会触发二审。默认置信度阈值是 `0.8`。

二审模型默认继承主审当前已生效的请求预算，包括 `high-accuracy` profile、`--timeout-ms`、`--retries`、`--retry-fast-failure-ms`、`--retry-delay-ms` 或对应环境变量带来的覆盖。

也就是说：

- 如果主审因为 `high-accuracy` 使用了更长超时，二审默认也会继承这组预算。
- 如果显式设置了 `--second-timeout-ms` / `AI_REVIEW_SECOND_TIMEOUT_MS`、`--second-retries` / `AI_REVIEW_SECOND_RETRIES`、`--second-retry-fast-failure-ms` / `AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS` 或 `--second-retry-delay-ms` / `AI_REVIEW_SECOND_RETRY_DELAY_MS`，则二审使用自己的独立值。

例如可以单独给二审更长预算：

```env
AI_REVIEW_SECOND_TIMEOUT_MS=180000
AI_REVIEW_SECOND_RETRIES=1
```

如果设置了 `--second-timeout-ms` / `AI_REVIEW_SECOND_TIMEOUT_MS`、`--second-retries` / `AI_REVIEW_SECOND_RETRIES`、`--second-retry-fast-failure-ms` / `AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS` 或 `--second-retry-delay-ms` / `AI_REVIEW_SECOND_RETRY_DELAY_MS`，会覆盖继承来的预算。

优先级：

```text
off > always > auto 条件判断
```

也就是说：

- `off`: 第二模型永远不运行。
- `always`: 第二模型配置存在且凭证可用时一定运行，不看主模型 finding 数量。
- `auto`: 第二模型配置存在、凭证可用，并且主模型 finding 数量达到阈值或 `confidence` 低于阈值时才运行。

## 主模型变量

```env
AI_REVIEW_PRIMARY_PROVIDER=<provider>
AI_REVIEW_PRIMARY_MODEL=<model>
AI_REVIEW_PRIMARY_BASE_URL=<url>
AI_REVIEW_PRIMARY_API_KEY=<key>
```

含义：

```text
AI_REVIEW_PRIMARY_PROVIDER   主模型 provider 名称
AI_REVIEW_PRIMARY_MODEL      主模型名称
AI_REVIEW_PRIMARY_BASE_URL   主模型 API base URL
AI_REVIEW_PRIMARY_API_KEY    主模型 API key
```

## 第二模型变量

```env
AI_REVIEW_SECOND_PROVIDER=<provider>
AI_REVIEW_SECOND_MODEL=<model>
AI_REVIEW_SECOND_BASE_URL=<url>
AI_REVIEW_SECOND_API_KEY=<key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_LOCAL_CLI=claude
AI_REVIEW_SECOND_LOCAL_CLI_ARGS=<trusted-args>
```

含义：

```text
AI_REVIEW_SECOND_PROVIDER      第二模型 provider 名称
AI_REVIEW_SECOND_MODEL         第二模型名称
AI_REVIEW_SECOND_BASE_URL      第二模型 API base URL
AI_REVIEW_SECOND_API_KEY       第二模型 API key
AI_REVIEW_SECOND_TRANSPORT     第二模型传输方式
AI_REVIEW_SECOND_API_STYLE     第二模型 API 风格
AI_REVIEW_SECOND_LOCAL_CLI     第二模型本地 AI CLI preset，可选 claude、opencode、codex
AI_REVIEW_SECOND_LOCAL_CLI_ARGS 第二模型本地 AI CLI 额外可信参数
AI_REVIEW_SECOND_CLI_COMMAND   第二模型 CLI 命令
AI_REVIEW_SECOND_REVIEW_MODE   第二模型运行模式：always、auto、off
AI_REVIEW_SECOND_P0_THRESHOLD  auto 模式下 P0 触发阈值，默认 1
AI_REVIEW_SECOND_P1_THRESHOLD  auto 模式下 P1 触发阈值，默认 1
AI_REVIEW_SECOND_P2_THRESHOLD  auto 模式下 P2 触发阈值，默认 3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD auto 模式主模型低置信度触发阈值，默认 0.8
AI_REVIEW_SECOND_TIMEOUT_MS    第二模型单次请求超时时间，默认继承主审预算
AI_REVIEW_SECOND_RETRIES       第二模型请求重试次数，默认继承主审预算
AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS 第二模型快速失败重试窗口毫秒数，默认继承主模型
AI_REVIEW_SECOND_RETRY_DELAY_MS 第二模型每次重试前等待毫秒数，默认继承主模型
```

第二模型会隔离主模型环境变量，不会误用 `AI_REVIEW_PRIMARY_BASE_URL`、`AI_REVIEW_PRIMARY_API_KEY`、`AI_REVIEW_TRANSPORT` 或 `AI_REVIEW_API_STYLE`。

## 通用运行变量

```env
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
AI_REVIEW_TIMEOUT_MS=120000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
AI_REVIEW_MAX_REVIEW_ROUNDS=3
AI_REVIEW_REASONING_EFFORT=high
AI_REVIEW_RESPONSE_FORMAT=json_object
AI_REVIEW_STRICT_SCHEMA=true
AI_REVIEW_STRICT_OUTPUT=false
AI_REVIEW_THINKING_TYPE=enabled
AI_REVIEW_LOCAL_CLI=codex
AI_REVIEW_LOCAL_CLI_ARGS=<trusted-args>
AI_REVIEW_CLI_COMMAND=<command>
AI_REVIEW_TIME_ZONE=Asia/Shanghai
AI_REVIEW_HISTORY_LIMIT=5
```

说明：

```text
AI_REVIEW_TRANSPORT          主模型传输方式
AI_REVIEW_API_STYLE          主模型 API 风格
AI_REVIEW_TIMEOUT_MS         单次模型请求超时时间
AI_REVIEW_RETRIES            模型快速失败重试次数，默认 3
AI_REVIEW_RETRY_FAST_FAILURE_MS 仅当单次失败耗时不超过该值时才重试，默认 10000
AI_REVIEW_RETRY_DELAY_MS     每次重试前等待毫秒数，默认 5000
AI_REVIEW_MAX_REVIEW_ROUNDS  审核/修复闭环最大轮数，默认 3；设为 infinity 表示无上限
AI_REVIEW_REASONING_EFFORT   Responses API 推理强度
AI_REVIEW_RESPONSE_FORMAT    输出格式
AI_REVIEW_STRICT_SCHEMA      Responses API 是否启用严格 JSON schema
AI_REVIEW_STRICT_OUTPUT      本地是否严格校验审核结果结构；默认 false，设为 true 时启用强校验
AI_REVIEW_THINKING_TYPE      兼容部分支持 thinking 字段的模型
AI_REVIEW_LOCAL_CLI          主模型本地 AI CLI preset，可选 claude、opencode、codex
AI_REVIEW_LOCAL_CLI_ARGS     主模型本地 AI CLI 额外可信参数
AI_REVIEW_CLI_COMMAND        主模型 CLI 审核命令
AI_REVIEW_TIME_ZONE          审核产物时间时区；不设置时使用当前环境时区，支持 IANA 名称或 +08:00 这类固定偏移，显示格式为 YYYY-MM-DD hh:mm:ss
AI_REVIEW_HISTORY_LIMIT      历史审核保留条数；默认 5，设为 0 时不保留历史运行目录和历史索引条目
```

## transport 和 api style

常用组合：

```text
OpenAI Responses API:
transport=responses
apiStyle=responses

OpenAI-compatible Chat Completions:
transport=openai-compatible
apiStyle=chat

本地 CLI:
transport=cli
```

如果服务商提供 `/chat/completions` 接口，通常使用：

```env
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
```

如果使用 OpenAI Responses API，通常使用：

```env
AI_REVIEW_TRANSPORT=responses
AI_REVIEW_API_STYLE=responses
```

## 内置 provider

当前内置 provider 在 `references/model-providers.json` 中维护。

`model-providers.json` 只描述 provider 默认值和服务商自身的环境变量：

```json
{
  "apiKeyEnv": ["OPENAI_API_KEY"],
  "baseUrlEnv": ["EXAMPLE_BASE_URL"]
}
```

不要在这里写 `AI_REVIEW_PRIMARY_*` 或 `AI_REVIEW_SECOND_*`。这些变量属于运行时路由配置，由脚本单独解析。这样可以避免第一模型、第二模型和 provider 默认值混在一起。

常见值：

```text
deepseek
openai
mimo
xiaomi
glm
zhipu
zai
openai-compatible
cli
local-cli
claude-cli
claude
opencode-cli
opencode
codex-cli
codex
```

## Provider 示例

### DeepSeek

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_BASE_URL=https://api.deepseek.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
```

也可以使用 provider 专属 key：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
DEEPSEEK_API_KEY=<key>
```

### OpenAI

```env
AI_REVIEW_PRIMARY_PROVIDER=openai
AI_REVIEW_PRIMARY_MODEL=gpt-5.5
AI_REVIEW_PRIMARY_BASE_URL=https://api.openai.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=responses
AI_REVIEW_API_STYLE=responses
```

也可以使用：

```env
OPENAI_API_KEY=<key>
```

### OpenAI-Compatible

适合任何兼容 `/chat/completions` 的服务商：

```env
AI_REVIEW_PRIMARY_PROVIDER=openai-compatible
AI_REVIEW_PRIMARY_MODEL=<model>
AI_REVIEW_PRIMARY_BASE_URL=https://api.example.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
```

### GLM / Zhipu / Z.ai

```env
AI_REVIEW_PRIMARY_PROVIDER=glm
AI_REVIEW_PRIMARY_MODEL=glm-5.1
AI_REVIEW_PRIMARY_BASE_URL=https://api.z.ai/api/paas/v4
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
AI_REVIEW_THINKING_TYPE=enabled
```

如果网关不支持 `thinking` 字段：

```env
AI_REVIEW_THINKING_TYPE=disabled
```

### CLI Reviewer

```env
AI_REVIEW_PRIMARY_PROVIDER=cli
AI_REVIEW_TRANSPORT=cli
AI_REVIEW_CLI_COMMAND=reviewer-cli --json
```

双模型中的第二个 reviewer 使用 CLI：

```env
AI_REVIEW_SECOND_PROVIDER=cli
AI_REVIEW_SECOND_TRANSPORT=cli
AI_REVIEW_SECOND_CLI_COMMAND=reviewer-cli --json
```

注意：CLI 命令会通过系统 shell 执行，只能配置来自可信来源的命令。

### Local AI CLI Reviewer

调用本机已安装的 `claude`、`opencode` 或 `codex`，无需为每个 CLI 写包装脚本：

```env
AI_REVIEW_PRIMARY_PROVIDER=local-cli
AI_REVIEW_LOCAL_CLI=codex

AI_REVIEW_SECOND_PROVIDER=local-cli
AI_REVIEW_SECOND_LOCAL_CLI=claude
AI_REVIEW_SECOND_REVIEW_MODE=always
```

也可以使用快捷 provider：

```env
AI_REVIEW_PRIMARY_PROVIDER=opencode
AI_REVIEW_SECOND_PROVIDER=claude
AI_REVIEW_SECOND_REVIEW_MODE=always
```

内置 preset：

```text
claude    执行 claude -p --output-format text，审核 brief 通过 stdin 传入
codex     执行 codex exec --color never --ephemeral <instruction>，审核 brief 通过 stdin 传入
opencode  将审核 brief 写入临时文件，执行 opencode run --file <prompt-file> <instruction>
```

如需指定本地 CLI 模型或 profile，可追加可信参数：

```env
AI_REVIEW_LOCAL_CLI_ARGS=--model <model>
AI_REVIEW_SECOND_LOCAL_CLI_ARGS=--model <model>
```

如果某个 CLI 版本的非交互参数和内置 preset 不一致，改用 `AI_REVIEW_CLI_COMMAND` / `AI_REVIEW_SECOND_CLI_COMMAND` 作为兜底。

## 命令行覆盖

命令行参数优先级最高。

覆盖主模型：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --provider openai-compatible --model <model> --base-url https://api.example.com/v1
```

覆盖第二模型：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --second-provider openai --second-model gpt-5.5
```

覆盖第二模型运行模式：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --second-review-mode auto
```

覆盖超时和重试：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --timeout-ms 180000 --retries 3 --retry-fast-failure-ms 10000 --retry-delay-ms 5000
```

覆盖审核/修复闭环最大轮数：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --max-review-rounds 5
node .agents/skills/code-review-loop/scripts/ai-review.mjs --max-review-rounds infinity
```

覆盖二审的独立超时、重试和 auto 置信度阈值：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --second-timeout-ms 60000 --second-retries 3 --second-retry-fast-failure-ms 10000 --second-retry-delay-ms 5000 --second-confidence-threshold 0.8
```

启用 CodeGraph 影响上下文：

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --codegraph --codegraph-depth 5
```

相关参数：

```text
--codegraph                    启用 best-effort CodeGraph 上下文收集，默认关闭。
--codegraph-depth <number>     传给 `codegraph affected` 的依赖遍历深度，默认 5。
--codegraph-command <command>  覆盖 CodeGraph CLI 命令；Windows 默认使用 `codegraph.cmd`。
```

`--codegraph` 会运行 `codegraph status -j <repo>` 和 `codegraph affected -p <repo> -d <depth> -j -- <changed-files>`，并把输出写入审核 brief 的 `CodeGraph 影响分析` 段落。CodeGraph 未安装、未初始化或命令失败时，脚本记录失败原因并继续审核。

## 推荐配置策略

常规开发：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_TIMEOUT_MS=120000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
AI_REVIEW_MAX_REVIEW_ROUNDS=3
```

提交前高准确性：

```env
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_TIMEOUT_MS=180000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
```

企业内部网关：

```env
AI_REVIEW_PRIMARY_PROVIDER=openai-compatible
AI_REVIEW_PRIMARY_MODEL=<internal-model>
AI_REVIEW_PRIMARY_BASE_URL=https://internal-gateway.example.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
```

## 安全建议

- 不要提交包含真实 API key 的 `.env`。
- 不要把 `.ai-review/latest-brief.md` 上传到公开位置，它包含本地代码上下文。
- 内置脱敏规则只覆盖常见环境变量、HTTP bearer token、JSON key 字段和 CLI 参数形态；它用于降低误传风险，不应被视为完整 DLP 或安全边界。
- CLI command 只能来自可信配置。
- 审核上下文过大时，优先用 `--path` 缩小范围，而不是盲目增大限制。
- 高风险改动建议启用双模型和 `--profile high-accuracy`。

## `.ai-reviewignore`

可以在仓库根目录创建 `.ai-reviewignore` 来排除部分文件不参与 review。

```gitignore
dist/
*.snap
src/generated/**
!src/generated/keep-me.js
```

该文件的规则接近 `.gitignore`，生效范围包括：

- `changedFiles`
- Git diff / diff stat
- 变更文件上下文收集
- untracked 文件的伪 diff
- CodeGraph 的变更文件输入

如果只是临时缩小本次 review 范围，而不是维护长期排除规则，仍然优先使用 `--path` / `--paths`。

## 故障排查

### Missing API key

检查是否配置了：

```env
AI_REVIEW_PRIMARY_API_KEY=<key>
```

或 provider 专属 key，例如：

```env
OPENAI_API_KEY=<key>
DEEPSEEK_API_KEY=<key>
```

### Missing base URL

检查：

```env
AI_REVIEW_PRIMARY_BASE_URL=<url>
```

或确认 provider 在 `model-providers.json` 中有默认 `baseUrl`。

### 第二模型没有运行

先确认没有关闭第二模型：

```env
AI_REVIEW_SECOND_REVIEW_MODE=off
```

如果是 `auto` 模式，只有主模型 finding 数量达到阈值，或主审 `confidence` 低于阈值时，才会运行第二模型：

```env
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD=0.8
```

再确认至少设置了一个第二模型路由变量：

```env
AI_REVIEW_SECOND_PROVIDER=openai
```

仅设置 `AI_REVIEW_SECOND_API_KEY` 不会启用第二模型。

### 请求超时

调大：

```env
AI_REVIEW_TIMEOUT_MS=180000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
```

或命令行覆盖：

```bash
--timeout-ms 180000 --retries 3 --retry-fast-failure-ms 10000 --retry-delay-ms 5000
```

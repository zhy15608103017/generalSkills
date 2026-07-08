# Provider 配置说明

内置脚本是无第三方依赖的 Node.js 脚本。它们会从 CLI 参数、shell 环境变量和仓库根目录 `.env` 读取配置。

shell 环境变量优先于 `.env`。`.env` 只会补充当前尚未设置的变量。

## 模型列表

可在 `references/model-providers.json` 中新增或修改 provider。

每个 provider 可定义：

```json
{
  "aliases": ["short-name"],
  "model": "model-name",
  "transport": "openai-compatible",
  "baseUrl": "https://api.example.com/v1",
  "apiStyle": "chat",
  "apiKeyEnv": ["EXAMPLE_API_KEY"],
  "baseUrlEnv": ["EXAMPLE_BASE_URL"],
  "command": "reviewer-cli --json",
  "commandEnv": ["EXAMPLE_REVIEW_CLI_COMMAND"],
  "localCli": "codex",
  "responseFormat": "json_object",
  "strictSchema": true,
  "strictOutput": false,
  "timeoutMs": 120000,
  "retries": 3,
  "retryFastFailureMs": 10000,
  "retryDelayMs": 5000,
  "requestOptions": {}
}
```

`transport: "openai-compatible"` 用于兼容 OpenAI `/chat/completions` 的接口，`transport: "responses"` 用于 OpenAI `/responses`，`transport: "cli"` 用于本地 CLI 审查员。`cli` 可以运行一个从 stdin 读取内容、再向 stdout 输出 `review-result` JSON 的自定义命令，也可以使用内置的 `localCli` 预设，例如 `claude`、`opencode` 或 `codex`。

provider 定义里只应包含 provider 级别的环境变量，例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 或 `EXAMPLE_BASE_URL`。不要把 `AI_REVIEW_PRIMARY_API_KEY`、`AI_REVIEW_SECOND_API_KEY`、`AI_REVIEW_PRIMARY_BASE_URL`、`AI_REVIEW_SECOND_BASE_URL` 这类运行时路由变量写进 `model-providers.json`；这些值应由审查运行器在执行时解析。

## 主 provider

主模型环境变量：

```text
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_BASE_URL=https://api.deepseek.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
AI_REVIEW_LOCAL_CLI=codex
AI_REVIEW_LOCAL_CLI_ARGS=<extra trusted args>
AI_REVIEW_CLI_COMMAND=<command>
```

第二审查员环境变量：

```text
AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_BASE_URL=https://api.openai.com/v1
AI_REVIEW_SECOND_API_KEY=<key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_LOCAL_CLI=claude
AI_REVIEW_SECOND_LOCAL_CLI_ARGS=<extra trusted args>
AI_REVIEW_SECOND_CLI_COMMAND=<command>
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
```

通用运行时环境变量：

```text
AI_REVIEW_STRICT_SCHEMA=true
AI_REVIEW_STRICT_OUTPUT=false
AI_REVIEW_TIMEOUT_MS=120000
AI_REVIEW_RETRIES=3
AI_REVIEW_RETRY_FAST_FAILURE_MS=10000
AI_REVIEW_RETRY_DELAY_MS=5000
AI_REVIEW_MAX_REVIEW_ROUNDS=3
```

仓库根目录 `.env` 示例：

```text
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_API_KEY=<key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
```

`PRIMARY` 会先执行。只有当第二审查员的路由配置存在、可解析到可用凭证，并且 `AI_REVIEW_SECOND_REVIEW_MODE` 允许时，才会在主审后运行 `SECOND`。`AI_REVIEW_SECOND_API_KEY` 只提供第二审查员的凭证，不会单独开启第二轮审查。

第二审模式：

```text
AI_REVIEW_SECOND_REVIEW_MODE=always  # 只要第二审路由和凭证可用就始终运行
AI_REVIEW_SECOND_REVIEW_MODE=auto    # 默认值；当 PRIMARY 达到 P0/P1/P2 阈值时才运行 SECOND
AI_REVIEW_SECOND_REVIEW_MODE=off     # 永不运行 SECOND
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
```

provider 专属 key 回退来源配置在 `model-providers.json` 中。当前内置 provider 包括：

```text
DEEPSEEK_API_KEY=<key>
OPENAI_API_KEY=<key>
MIMO_API_KEY=<key>
XIAOMI_API_KEY=<key>
ZAI_API_KEY=<key>
ZHIPU_API_KEY=<key>
BIGMODEL_API_KEY=<key>
```

## 支持的 provider 值

- `deepseek`：使用 OpenAI-compatible chat completions，请求默认地址为 `https://api.deepseek.com/v1`。
- `openai`：使用 OpenAI Responses API，默认地址为 `https://api.openai.com/v1`。
- `mimo` 或 `xiaomi`：使用 OpenAI-compatible chat completions，默认模型 `mimo-v2.5-pro`，默认地址 `https://api.xiaomimimo.com/v1`。
- `glm`、`zhipu` 或 `zai`：使用 OpenAI-compatible chat completions，默认模型 `glm-5.1`，默认地址 `https://api.z.ai/api/paas/v4`。
- `openai-compatible`：对自定义 `AI_REVIEW_PRIMARY_BASE_URL` 使用 chat completions。
- `cli`：使用可信的本地自定义 CLI 命令。命令必须从 stdin 读取内容，并向 stdout 返回审查结果 JSON。
- `local-cli` 或 `ai-cli`：使用 `AI_REVIEW_LOCAL_CLI` 选择内置本地 AI CLI 预设。
- `claude-cli` 或 `claude`：使用内置 `claude` 预设。
- `opencode-cli` 或 `opencode`：使用内置 `opencode` 预设。
- `codex-cli` 或 `codex`：使用内置 `codex` 预设。

如果是额外的 OpenAI-compatible 模型，只需编辑 `model-providers.json`，无需改脚本。

`AI_REVIEW_CLI_COMMAND`、`AI_REVIEW_SECOND_CLI_COMMAND`、`--cli-command` 或 `--second-cli-command` 只能从可信本地配置中提供。自定义 CLI 审查命令会通过系统 shell 执行，以便跨平台支持带引号的命令和本地工具包装脚本。内置本地 CLI 预设默认不会走 shell，除非你显式覆盖成自定义命令。

## Xiaomi MiMo V2.5 Pro

```text
AI_REVIEW_PRIMARY_PROVIDER=mimo
MIMO_API_KEY=<key>
```

可选覆盖：

```text
AI_REVIEW_PRIMARY_MODEL=mimo-v2.5-pro
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
```

部分 MiMo 账号可能使用其他 OpenAI-compatible 端点，例如 `https://api.mimo-v2.com/v1`；如果控制台显示的 base URL 不同，请设置 `MIMO_BASE_URL`。

## Zhipu GLM-5.1

```text
AI_REVIEW_PRIMARY_PROVIDER=glm
ZAI_API_KEY=<key>
```

可选覆盖：

```text
AI_REVIEW_PRIMARY_MODEL=glm-5.1
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
AI_REVIEW_THINKING_TYPE=enabled
```

如果你的 GLM-compatible 网关不接受 `thinking` 请求字段，请使用 `AI_REVIEW_THINKING_TYPE=disabled`。

## 常用 flags

```text
--provider <name>
--model <model>
--transport responses|openai-compatible|cli
--base-url <url>
--api-style chat|responses
--local-cli claude|opencode|codex
--local-cli-args <trusted args>
--cli-command <command>
--second-provider <name>
--second-model <model>
--second-base-url <url>
--second-api-key <key>
--second-api-style chat|responses
--second-transport responses|openai-compatible|cli
--second-local-cli claude|opencode|codex
--second-local-cli-args <trusted args>
--second-cli-command <command>
--second-review-mode always|auto|off
--second-p0-threshold <count>
--second-p1-threshold <count>
--second-p2-threshold <count>
--second-retries <count>
--second-retry-fast-failure-ms <milliseconds>
--second-retry-delay-ms <milliseconds>
--timeout-ms <milliseconds>
--retries <count>
--retry-fast-failure-ms <milliseconds>
--retry-delay-ms <milliseconds>
--max-review-rounds <count|infinity>
--time-zone <iana-zone|offset|system>
--history-limit <count>
--profile standard|auto|high-accuracy
--request <path>
--design <path>
--plan <path>
--checklist <path>
--path <path>
--paths <path-a,path-b>
--staged
--base <ref>
--verify <command>
--out-dir <path>
--max-brief-bytes <bytes>
--max-doc-bytes <bytes>
--max-file-bytes <bytes>
--max-diff-bytes <bytes>
--allow-outside-docs
--allow-empty
--dry-run
```

## 推荐默认值

- 低成本首轮审查：`deepseek-v4-pro` 或其他更快的兼容模型。
- 高风险第二轮审查：通过 `provider=openai` 使用 OpenAI 推理模型。
- 默认优先使用 API transport。只有在本地工具、企业登录流，或模型无法稳定通过 API 获取时，才使用 CLI transport。
- 本地开发阶段，建议在一个功能切片完成后手动运行，而不是每次保存文件都触发。

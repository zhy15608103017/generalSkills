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
  "strictOutput": true,
  "timeoutMs": 120000,
  "retries": 3,
  "retryFastFailureMs": 10000,
  "retryDelayMs": 5000,
  "requestOptions": {}
}
```

`transport: "openai-compatible"` 用于兼容 OpenAI `/chat/completions` 的接口，`transport: "responses"` 用于 OpenAI `/responses`，`transport: "cli"` 用于本地 CLI 审查员。`cli` 可以运行一个从 stdin 读取内容、再向 stdout 输出 `review-result` JSON 的自定义命令，也可以使用内置的 `localCli` 预设，例如 `claude`、`opencode` 或 `codex`。

provider 定义里只应包含 provider 级别的环境变量，例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 或 `EXAMPLE_BASE_URL`。不要把 `AI_REVIEW_PRIMARY_API_KEY`、`AI_REVIEW_SECOND_API_KEY`、`AI_REVIEW_PRIMARY_BASE_URL`、`AI_REVIEW_SECOND_BASE_URL` 这类运行时路由变量写进 `model-providers.json`；这些值应由审查运行器在执行时解析。

## 运行时路由配置

主审、二审、重试、超时、严格输出、审查轮次和 `.env` 示例统一以 `references/configuration.md` 为准。本文件只维护 provider 定义、provider 专属凭证回退和 transport 差异，避免两份运行时配置说明发生漂移。

`PRIMARY` 会先执行。只有当二审路由配置存在、可解析到可用凭证，并且 `AI_REVIEW_SECOND_REVIEW_MODE` 允许时，才会运行 `SECOND`。`AI_REVIEW_SECOND_API_KEY` 只提供凭证，不会单独开启二审。

正式审核前可运行 `ai-review.mjs --check-config`。主审 API 缺少 key/base URL，或 CLI reviewer 缺少显式 preset/command 时，预检以退出码 `3` 结束，不进入需求审计和代码审查。工具不会自动选择本机已安装的 AI CLI；要使用 `codex`、`claude` 或 `opencode`，请显式配置 provider 或 `--local-cli`。

本 skill 没有全局默认 provider。必须显式选择 `deepseek`、`openai`、`openai-compatible`、本地 CLI 或其他已登记 provider，或者提供与已登记 provider 精确匹配的显式模型名。provider 专属 API key 只作为已选 provider 的凭证回退，单独设置 key 不会触发 provider 选择。通用的 `openai-compatible` provider 不接受 provider 定义中的默认 model、base URL 或 provider 专属凭证，这三项都必须由用户通过运行时主审/二审配置显式提供。

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
--check-config
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
--reset-review-rounds
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
--strict-output
--relaxed-output
--clean
```

## 推荐配置示例

- 低成本首轮审查：`deepseek-v4-pro` 或其他更快的兼容模型。
- 高风险第二轮审查：通过 `provider=openai` 使用 OpenAI 推理模型。
- 一般优先使用 API transport。只有在本地工具、企业登录流，或模型无法稳定通过 API 获取时，才使用 CLI transport。
- 本地开发阶段，建议在一个功能切片完成后手动运行，而不是每次保存文件都触发。

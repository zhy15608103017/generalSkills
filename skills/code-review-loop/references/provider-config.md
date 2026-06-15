# Provider Configuration

The bundled scripts are dependency-free Node.js scripts. They read configuration from CLI flags, shell environment variables, and a repository-root `.env` file.

Shell environment variables win over `.env` values. The `.env` file only fills variables that are not already set.

## Model List

Add or modify providers in `references/model-providers.json`.

Each provider can define:

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
  "responseFormat": "json_object",
  "strictSchema": true,
  "strictOutput": false,
  "timeoutMs": 120000,
  "retries": 1,
  "requestOptions": {}
}
```

Use `transport: "openai-compatible"` for OpenAI-compatible `/chat/completions` APIs, `transport: "responses"` for OpenAI `/responses`, and `transport: "cli"` for local CLI reviewers that read the review brief from stdin and print JSON to stdout.

Provider definitions should only contain provider-scoped environment variables, such as `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or `EXAMPLE_BASE_URL`. Do not put runtime routing variables such as `AI_REVIEW_PRIMARY_API_KEY`, `AI_REVIEW_SECOND_API_KEY`, `AI_REVIEW_PRIMARY_BASE_URL`, or `AI_REVIEW_SECOND_BASE_URL` in `model-providers.json`; those are resolved by the review runner.

## Primary Provider

Primary environment variables:

```text
AI_REVIEW_PRIMARY_PROVIDER=deepseek
AI_REVIEW_PRIMARY_MODEL=deepseek-v4-pro
AI_REVIEW_PRIMARY_BASE_URL=https://api.deepseek.com/v1
AI_REVIEW_PRIMARY_API_KEY=<key>
AI_REVIEW_TRANSPORT=openai-compatible
AI_REVIEW_API_STYLE=chat
AI_REVIEW_CLI_COMMAND=<command>
```

Second reviewer environment variables:

```text
AI_REVIEW_SECOND_PROVIDER=openai
AI_REVIEW_SECOND_MODEL=gpt-5.5
AI_REVIEW_SECOND_BASE_URL=https://api.openai.com/v1
AI_REVIEW_SECOND_API_KEY=<key>
AI_REVIEW_SECOND_TRANSPORT=responses
AI_REVIEW_SECOND_API_STYLE=responses
AI_REVIEW_SECOND_CLI_COMMAND=<command>
AI_REVIEW_SECOND_REVIEW_MODE=auto
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
```

Common runtime environment variables:

```text
AI_REVIEW_STRICT_SCHEMA=true
AI_REVIEW_STRICT_OUTPUT=false
AI_REVIEW_TIMEOUT_MS=120000
AI_REVIEW_RETRIES=1
```

Repository-root `.env` example:

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

`PRIMARY` is reviewed first. `SECOND` is reviewed after the primary reviewer when second reviewer routing is configured, usable credentials can be resolved, and `AI_REVIEW_SECOND_REVIEW_MODE` allows it. `AI_REVIEW_SECOND_API_KEY` supplies credentials for the second reviewer but does not enable a second pass by itself.

Second review modes:

```text
AI_REVIEW_SECOND_REVIEW_MODE=always  # run SECOND whenever second routing and credentials are available
AI_REVIEW_SECOND_REVIEW_MODE=auto    # default; run SECOND when PRIMARY reaches P0/P1/P2 thresholds
AI_REVIEW_SECOND_REVIEW_MODE=off     # never run SECOND
AI_REVIEW_SECOND_P0_THRESHOLD=1
AI_REVIEW_SECOND_P1_THRESHOLD=1
AI_REVIEW_SECOND_P2_THRESHOLD=3
```

Provider-specific key fallbacks are configured in `model-providers.json`. Built-in providers currently include:

```text
DEEPSEEK_API_KEY=<key>
OPENAI_API_KEY=<key>
MIMO_API_KEY=<key>
XIAOMI_API_KEY=<key>
ZAI_API_KEY=<key>
ZHIPU_API_KEY=<key>
BIGMODEL_API_KEY=<key>
```

## Supported Provider Values

- `deepseek`: Uses an OpenAI-compatible chat completions request. Defaults to `https://api.deepseek.com/v1`.
- `openai`: Uses the OpenAI Responses API. Defaults to `https://api.openai.com/v1`.
- `mimo` or `xiaomi`: Uses an OpenAI-compatible chat completions request. Defaults to model `mimo-v2.5-pro` and base URL `https://api.xiaomimimo.com/v1`.
- `glm`, `zhipu`, or `zai`: Uses an OpenAI-compatible chat completions request. Defaults to model `glm-5.1` and base URL `https://api.z.ai/api/paas/v4`.
- `openai-compatible`: Uses chat completions against a custom `AI_REVIEW_PRIMARY_BASE_URL`.
- `cli` or `local-cli`: Uses a local CLI command. The command must read stdin and return review-result JSON on stdout.

Any additional OpenAI-compatible model can be added by editing `model-providers.json`; no script change is needed when the API uses `/chat/completions`.

Only configure `AI_REVIEW_CLI_COMMAND`, `AI_REVIEW_SECOND_CLI_COMMAND`, `--cli-command`, or `--second-cli-command` from trusted local configuration. CLI reviewer commands are executed through the system shell so quoted commands and local tool wrappers work across platforms.

## Xiaomi MiMo V2.5 Pro

```text
AI_REVIEW_PRIMARY_PROVIDER=mimo
MIMO_API_KEY=<key>
```

Optional overrides:

```text
AI_REVIEW_PRIMARY_MODEL=mimo-v2.5-pro
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
```

Some MiMo accounts may use another OpenAI-compatible endpoint, such as `https://api.mimo-v2.com/v1`; set `MIMO_BASE_URL` when your dashboard shows a different base URL.

## Zhipu GLM-5.1

```text
AI_REVIEW_PRIMARY_PROVIDER=glm
ZAI_API_KEY=<key>
```

Optional overrides:

```text
AI_REVIEW_PRIMARY_MODEL=glm-5.1
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
AI_REVIEW_THINKING_TYPE=enabled
```

Use `AI_REVIEW_THINKING_TYPE=disabled` if your GLM-compatible gateway rejects the `thinking` request field.

## Useful Flags

```text
--provider <name>
--model <model>
--transport responses|openai-compatible|cli
--base-url <url>
--api-style chat|responses
--cli-command <command>
--second-provider <name>
--second-model <model>
--second-base-url <url>
--second-api-key <key>
--second-api-style chat|responses
--second-transport responses|openai-compatible|cli
--second-cli-command <command>
--second-review-mode always|auto|off
--second-p0-threshold <count>
--second-p1-threshold <count>
--second-p2-threshold <count>
--timeout-ms <milliseconds>
--retries <count>
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

## Recommended Defaults

- Low-cost first pass: `deepseek-v4-pro` or a faster compatible model.
- High-risk second pass: an OpenAI reasoning model through `provider=openai`.
- Use API transports as the default path. Use CLI transport only for local tools, enterprise login flows, or models that are not reliably available through an API.
- Local development: run manually after a feature slice is complete, not on every file save.

# 脚本职责速查表

`scripts/` 下的脚本是有内部依赖的实现细节，终端用户通常只直接调用 `ai-review.mjs` 和 `write-review-context.mjs`。本表帮助贡献者快速定位脚本职责与调用关系。

## 入口脚本（用户/agent 直接调用）

| 脚本 | 职责 |
|---|---|
| `ai-review.mjs` | 主入口。先预检 reviewer 配置，再编排需求理解闸门、代码审查、自动分片、第二审查员、验证门禁、轮次状态与历史记录。 |
| `write-review-context.mjs` | 写入自包含的 `.ai-review/review-context/current-request.md`，支持结构化字段与 `--from-file`。 |
| `check-syntax.mjs` | 对本 skill 内全部 `.mjs` 做语法检查；修改脚本后建议运行。 |
| `benchmark-review.mjs` | 审查基准测试，用于对比模型或配置的审查质量。 |

## 核心运行时模块（被 `ai-review.mjs` 引用）

| 脚本 | 职责 |
|---|---|
| `collect-context.mjs` | 解析 CLI 参数，收集 git diff、变更文件上下文、项目规则、文档、CodeGraph 影响分析与文件上下文缓存。 |
| `render-brief.mjs` | 把收集到的上下文渲染成发送给审查模型的 brief Markdown。 |
| `call-model.mjs` | 解析 provider/model 配置，调用主审与二审模型，解析并校验返回结果。 |
| `review-result.mjs` | 解析与校验审查模型返回的 JSON，区分严格/宽松模式。 |
| `requirement-audit.mjs` | 需求理解闸门：构建缓存键、读写缓存、调用需求审计模型。 |
| `verification-gate.mjs` | 执行 `--verify` 命令，退出码非零时确定性地把最终结论提升为 `fail`。 |
| `review-round-state.mjs` | 按请求上下文指纹持久化连续未通过轮次，`pass` 后清零。 |
| `review-profile.mjs` | 解析 `--profile`（standard/auto/high-accuracy）并决定审查策略预算。 |
| `review-limits.mjs` | 集中处理超时、重试、轮次上限等限制参数的解析与归一化。 |
| `review-status.mjs` | 写入 `latest-status.json/.md` 与终端 heartbeat。 |
| `review-report.mjs` | 把结构化结果渲染成人读报告（`latest-report.md`）。 |
| `review-display.mjs` | 控制台摘要、verdict 文案与审查员标签渲染。 |

## 辅助模块

| 脚本 | 职责 |
|---|---|
| `git-context.mjs` | 封装 git diff、diff stat、status、暂存区与路径范围等命令。 |
| `request-context.mjs` | 读取与解析 `.ai-review/review-context/` 下的请求上下文文件。 |
| `redact-secrets.mjs` | 对 brief、CodeGraph 输出等做内置脱敏（best-effort，非完整 DLP）。 |
| `time-format.mjs` | 按时区配置统一格式化审查产物时间戳。 |
| `assets-cache.mjs` | 进程内 TTL 缓存，用于复用 skill 静态资产读取结果。 |

## 典型调用链

```text
ai-review.mjs
  └─ collect-context.mjs ── git-context.mjs, redact-secrets.mjs
  └─ render-brief.mjs
  └─ requirement-audit.mjs ── call-model.mjs
  └─ call-model.mjs ── review-result.mjs
  │     （自动分片时多次并行调用）
  └─ verification-gate.mjs
  └─ review-round-state.mjs
  └─ review-report.mjs, review-status.mjs, review-display.mjs
```

修改脚本后，运行 `node .agents/skills/code-review-loop/scripts/check-syntax.mjs` 确认语法无误。

import { redactSecrets } from "./redact-secrets.mjs";

export function renderReviewBrief(context) {
  const docBlocks = context.docs
    .map((doc) => `### ${doc.label}: ${doc.path}\n\n${redactSecrets(doc.content)}`)
    .join("\n\n");
  const fileBlocks = context.fileContexts
    .map((file) => `### ${file.path}\n\n\`\`\`\n${numberLines(file.content)}\n\`\`\``)
    .join("\n\n");
  const verification = renderVerifications(context.verification);
  const scope = renderScope(context.scope);
  const profile = renderProfile(context.profile);
  const codegraph = renderCodeGraph(context.codegraphContext);

  const brief = `# 代码审核上下文

## 仓库

${context.root}

## 生成时间

${context.generatedAt}

## 审核范围

${scope}

## 审核配置

${profile}

## Git 状态

\`\`\`
${redactSecrets(context.status) || "没有本地状态输出。"}
\`\`\`

## 项目规则

\`\`\`md
${redactSecrets(context.projectRules) || "仓库根目录未找到 AGENTS.md。"}
\`\`\`

## 需求、设计与计划

${docBlocks || "未提供需求、设计、计划或额外文档。"}

## Diff 统计

\`\`\`
${redactSecrets(context.diffStat) || "没有可用的 diff 统计。"}
\`\`\`

## 变更文件

${context.changedFiles.map((file) => `- ${file}`).join("\n") || "未检测到变更文件。"}

${codegraph}

## 变更文件上下文

${fileBlocks || "未收集到变更文件上下文。"}

## Git Diff

\`\`\`diff
${redactSecrets(context.diff) || "没有可用的 Git diff。"}
\`\`\`

## 验证输出

\`\`\`
${redactSecrets(verification)}
\`\`\`
`;

  return limitText(
    brief,
    Number.isFinite(context.maxBriefBytes) ? context.maxBriefBytes : 600000,
    "\n\n[代码审核上下文已被 code-review-loop 截断。请调大 --max-brief-bytes。]",
  );
}

function renderCodeGraph(codegraphContext) {
  if (!codegraphContext) return "";

  const files = codegraphContext.files?.length
    ? codegraphContext.files.map((file) => `- ${file}`).join("\n")
    : "- 无";
  const affected = codegraphContext.affected
    ? renderCodeGraphCommandResult("affected", codegraphContext.affected)
    : "未运行 affected 分析：CodeGraph 未初始化、没有变更文件，或 status 检查失败。";

  return `## CodeGraph 影响分析

命令: ${codegraphContext.command}
深度: ${codegraphContext.depth}

分析文件:
${files}

### status

${renderCodeGraphCommandResult("status", codegraphContext.status)}

### affected

${affected}`;
}

function renderCodeGraphCommandResult(label, result = {}) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const fallback = result.timedOut
    ? `${label} 命令超时。`
    : `${label} 命令没有输出。`;

  return [
    `退出码: ${result.exitCode ?? "unknown"}`,
    "",
    "```",
    redactSecrets(limitText(output || fallback, 40000, "\n\n[CodeGraph 输出已截断。]")),
    "```",
  ].join("\n");
}

function renderScope(scope = {}) {
  const mode = scope.staged ? "仅审核暂存区变更" : `审核工作区相对 ${scope.base || "HEAD"} 的 diff`;
  const paths = scope.paths?.length ? scope.paths.map((item) => `- ${item}`).join("\n") : "- 仓库全部路径";
  return [`模式: ${mode}`, "", "路径:", paths].join("\n");
}

function renderProfile(profile = {}) {
  const reasons = profile.reasons?.length ? profile.reasons.map((reason) => `- ${reason}`).join("\n") : "- 无";
  const appliedOptions = Object.keys(profile.appliedOptions || {}).length
    ? Object.entries(profile.appliedOptions).map(([key, value]) => `- ${key}: ${value}`).join("\n")
    : "- 无";
  return [
    `请求配置: ${profile.requested || "standard"}`,
    `实际配置: ${profile.selected || "standard"}`,
    "",
    "原因:",
    reasons,
    "",
    "已应用选项:",
    appliedOptions,
  ].join("\n");
}

function renderVerifications(verification) {
  if (!verification?.length) return "未提供验证命令。";

  return verification
    .map((item, index) => `### 验证 ${index + 1}

命令: ${item.command}
退出码: ${item.exitCode}

标准输出:
${item.stdout}

标准错误:
${item.stderr}`)
    .join("\n\n");
}

function numberLines(text = "") {
  const lines = String(text).split(/\r?\n/);
  const width = Math.max(4, String(lines.length).length);
  return lines
    .map((line, index) => `${String(index + 1).padStart(width, " ")} | ${line}`)
    .join("\n");
}

function limitText(text, maxBytes, suffix) {
  const buffer = Buffer.from(text || "", "utf8");
  if (buffer.length <= maxBytes) return text || "";
  return Buffer.concat([buffer.subarray(0, maxBytes), Buffer.from(suffix, "utf8")]).toString("utf8");
}

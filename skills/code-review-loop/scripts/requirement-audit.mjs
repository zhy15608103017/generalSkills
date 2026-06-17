import { promises as fs } from "node:fs";
import path from "node:path";
import { redactSecrets } from "./redact-secrets.mjs";
import { formatVerdict } from "./review-display.mjs";

export async function loadRequirementAuditorPrompt() {
  return await fs.readFile(new URL("../references/requirement-auditor-prompt.md", import.meta.url), "utf8");
}

export function renderRequirementAuditBrief(context) {
  const docs = context.docs
    .map((doc) => `### ${doc.label}: ${doc.path}\n\n${redactSecrets(doc.content)}`)
    .join("\n\n");

  const brief = `# 需求理解审核上下文

## 仓库

${context.root}

## 生成时间

${context.generatedAt}

## 审核目标

请先审核当前模型理解是否符合用户原始请求、后续纠正/澄清、明确反例和验收标准。不要审核代码实现。

## 项目规则

\`\`\`md
${redactSecrets(context.projectRules) || "仓库根目录未找到 AGENTS.md。"}
\`\`\`

## 需求、设计与验收上下文

${docs || "未提供需求、设计、计划或额外文档。"}
`;

  return limitText(
    brief,
    Number.isFinite(context.maxBriefBytes) ? context.maxBriefBytes : 600000,
    "\n\n[需求理解审核上下文已被 code-review-loop 截断。请调大 --max-brief-bytes。]",
  );
}

export async function writeRequirementAuditArtifacts(outDir, result, brief) {
  await fs.writeFile(
    path.join(outDir, "latest-requirement-audit-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(outDir, "latest-requirement-audit-brief.md"), brief || "", "utf8");
}

export function decorateRequirementAuditBlock(result) {
  return {
    ...result,
    summary: `需求理解审核未通过，代码审核已跳过。\n\n${result.summary || "未提供摘要。"}`,
    verification_notes: [
      ...(result.verification_notes || []),
      "需求理解审核未通过或需要人工确认，未继续执行代码审核。",
    ],
  };
}

export function withRequirementAuditPass(result, auditResult) {
  return {
    ...result,
    verification_notes: [
      `需求理解审核: ${formatVerdict(auditResult.verdict)}。${auditResult.summary || "未提供摘要。"}`,
      ...(auditResult.verification_notes || []),
      ...(result.verification_notes || []),
    ],
    confidence: Math.min(numberOrOne(result.confidence), numberOrOne(auditResult.confidence)),
  };
}

function numberOrOne(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function limitText(text, maxBytes, suffix) {
  const buffer = Buffer.from(text || "", "utf8");
  if (buffer.length <= maxBytes) return text || "";
  return Buffer.concat([buffer.subarray(0, maxBytes), Buffer.from(suffix, "utf8")]).toString("utf8");
}

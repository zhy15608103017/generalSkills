import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { redactSecrets } from "./redact-secrets.mjs";
import { formatVerdict } from "./review-display.mjs";

const REQUIREMENT_AUDIT_CACHE_VERSION = "v1";

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

export function buildRequirementAuditCacheKey({ context, auditPrompt, primaryResolved }) {
  const payload = {
    version: REQUIREMENT_AUDIT_CACHE_VERSION,
    root: context.root,
    projectRules: context.projectRules || "",
    docs: (context.docs || []).map((doc) => ({
      label: doc.label,
      path: doc.path,
      contentHash: doc.contentHash || "",
      contentBytes: doc.contentBytes || 0,
      content: doc.content || "",
    })),
    auditPrompt: auditPrompt || "",
    reviewer: {
      provider: primaryResolved?.provider || "unknown",
      model: primaryResolved?.model || "unknown",
    },
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export async function readCachedRequirementAudit(outDir, cacheKey) {
  const cached = await readRequirementAuditCache(outDir);
  if (!cached || cached.cacheKey !== cacheKey || cached.result?.verdict !== "pass") {
    return null;
  }

  return {
    ...cached.result,
    verification_notes: [
      `需求理解审核使用缓存，缓存时间: ${cached.cachedAt || "unknown"}。`,
      ...(cached.result.verification_notes || []),
    ],
  };
}

export async function writeCachedRequirementAudit(outDir, cacheKey, result) {
  if (result?.verdict !== "pass") return;

  try {
    const cachePath = requirementAuditCachePath(outDir);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      `${JSON.stringify({
        version: REQUIREMENT_AUDIT_CACHE_VERSION,
        cacheKey,
        cachedAt: new Date().toISOString(),
        result,
      }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Cache writes are best-effort; a cache failure must not block review.
  }
}

export async function clearCachedRequirementAudit(outDir, cacheKey) {
  try {
    const cachePath = requirementAuditCachePath(outDir);
    const cached = await readRequirementAuditCache(outDir);
    if (cached?.cacheKey === cacheKey) {
      await fs.rm(cachePath, { force: true });
    }
  } catch {
    // Cache invalidation is best-effort; a cache failure must not block review.
  }
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

async function readRequirementAuditCache(outDir) {
  try {
    const raw = await fs.readFile(requirementAuditCachePath(outDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== REQUIREMENT_AUDIT_CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requirementAuditCachePath(outDir) {
  return path.join(outDir, "cache", "requirement-audit.json");
}

function limitText(text, maxBytes, suffix) {
  const buffer = Buffer.from(text || "", "utf8");
  if (buffer.length <= maxBytes) return text || "";
  return Buffer.concat([buffer.subarray(0, maxBytes), Buffer.from(suffix, "utf8")]).toString("utf8");
}

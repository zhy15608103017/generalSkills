import { renderReviewLimitValue } from "./review-limits.mjs";
import { formatReviewTime } from "./time-format.mjs";

export function withDisplayFields(result = {}) {
  return {
    ...result,
    verdict_label: verdictLabel(result.verdict),
  };
}

export function formatVerdict(verdict) {
  const raw = verdict || "unknown";
  return `${verdictLabel(raw)}（${raw}）`;
}

export function verdictLabel(verdict) {
  switch (verdict) {
    case "pass":
      return "通过";
    case "fail":
      return "未通过";
    case "needs_human":
      return "需要人工确认";
    default:
      return "未知结论";
  }
}

export function buildHistoryEntry({ result, options = {}, context = {}, resolved = {}, outputMeta = {} }) {
  const outputResult = withDisplayFields(result);
  return {
    timestamp: formatReviewTime(new Date(), options),
    runId: outputMeta.runId || null,
    verdict: outputResult.verdict,
    verdict_label: outputResult.verdict_label,
    verdict_display: formatVerdict(outputResult.verdict),
    confidence: outputResult.confidence,
    summary: outputResult.summary || "",
    reviewers: buildReviewers(options, resolved),
    profile: context?.profile?.selected || options.profile || "standard",
    limits: {
      maxReviewRounds: renderReviewLimitValue(context?.reviewLimits?.maxReviewRounds ?? options.maxReviewRounds),
    },
    scope: {
      staged: Boolean(context?.scope?.staged),
      base: context?.scope?.base || "HEAD",
      paths: context?.scope?.paths || options.paths || [],
    },
    changedFileCount: context?.changedFiles?.length ?? null,
    changedFiles: context?.changedFiles || [],
    counts: {
      blocking: (outputResult.blocking_findings || []).length,
      warnings: (outputResult.warnings || []).length,
    },
    details: {
      latestResultPath: outputMeta.latestResultPath || null,
      latestReportPath: outputMeta.latestReportPath || null,
      latestBriefPath: outputMeta.latestBriefPath || null,
      runResultPath: outputMeta.runResultPath || null,
      runReportPath: outputMeta.runReportPath || null,
      runBriefPath: outputMeta.runBriefPath || null,
    },
    findings: {
      blocking: summarizeFindings(outputResult.blocking_findings),
      warnings: summarizeFindings(outputResult.warnings),
    },
    verification_notes: outputResult.verification_notes || [],
    reviewer_failures: summarizeReviewerFailures(outputResult.reviewer_failures),
  };
}

export function renderHistoryMarkdownEntry(entry) {
  return `\n## ${entry.timestamp} - ${entry.verdict_display}\n\n`
    + `- 运行 ID: ${entry.runId || "未知"}\n`
    + `- 置信度: ${entry.confidence ?? 0}\n`
    + `- 审核模型: ${renderReviewers(entry.reviewers)}\n`
    + `- 审核配置: ${entry.profile}\n`
    + `- 审核轮数上限: ${entry.limits?.maxReviewRounds || "3"}\n`
    + `- 变更文件数: ${entry.changedFileCount ?? "未知"}\n`
    + `- 审核详情: ${entry.details.runReportPath || entry.details.latestReportPath || "未知"}\n`
    + `- 结构化结果: ${entry.details.runResultPath || entry.details.latestResultPath || "未知"}\n`
    + `- 审核上下文: ${entry.details.runBriefPath || entry.details.latestBriefPath || "未知"}\n\n`
    + `### 摘要\n\n${entry.summary || "未提供摘要。"}\n\n`
    + `### 阻塞问题\n\n${renderHistoryFindings(entry.findings.blocking)}\n\n`
    + `### 非阻塞提醒\n\n${renderHistoryFindings(entry.findings.warnings)}\n\n`
    + `### 审核运行失败原因\n\n${renderHistoryReviewerFailures(entry.reviewer_failures)}\n\n`
    + `### 验证说明\n\n${renderNotes(entry.verification_notes)}\n`;
}

function buildReviewers(options, resolved = {}) {
  const primary = resolved.primary || {};
  const second = resolved.second || null;
  return {
    primary: {
      provider: primary.provider || options.provider || process.env.AI_REVIEW_PRIMARY_PROVIDER || "unknown",
      model: primary.model || options.model || process.env.AI_REVIEW_PRIMARY_MODEL || "unknown",
    },
    second: second ? {
      provider: second.provider || options.secondProvider || process.env.AI_REVIEW_SECOND_PROVIDER || "unknown",
      model: second.model || options.secondModel || process.env.AI_REVIEW_SECOND_MODEL || "unknown",
    } : null,
  };
}

function summarizeFindings(findings = []) {
  return findings.map((finding) => ({
    severity: finding.severity || "P2",
    title: finding.title || "未命名问题",
    file: finding.file || "未定位",
    line: finding.line ?? null,
    sources: normalizeSources(finding.sources),
    evidence: finding.evidence || "未提供证据。",
    impact: finding.impact || "未说明影响。",
    suggested_fix: finding.suggested_fix || "未提供修复建议。",
  }));
}

function summarizeReviewerFailures(failures = []) {
  return Array.isArray(failures)
    ? failures.map((failure) => ({
      phase: failure?.phase || "unknown",
      reviewer: failure?.reviewer || "unknown",
      provider: failure?.provider || "unknown",
      model: failure?.model || "unknown",
      category: failure?.category || "unknown",
      retryable: Boolean(failure?.retryable),
      message: failure?.message || "unknown error",
      status: failure?.status ?? null,
      attempts: failure?.attempts ?? null,
    }))
    : [];
}

function renderHistoryFindings(findings = []) {
  if (!findings.length) return "无";
  return findings.map((finding) => {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    return `- [${finding.severity}] ${finding.title}\n`
      + `  - 来源: ${renderSources(finding.sources)}\n`
      + `  - 位置: ${location}\n`
      + `  - 证据: ${finding.evidence}\n`
      + `  - 影响: ${finding.impact}\n`
      + `  - 建议修复: ${finding.suggested_fix}`;
  }).join("\n");
}

function renderHistoryReviewerFailures(failures = []) {
  if (!failures.length) return "无";
  return failures.map((failure) => `- [${failure.category}] ${failure.reviewer} (${failure.provider}/${failure.model})
  - 阶段: ${failure.phase}
  - 可重试: ${failure.retryable ? "是" : "否"}
  - 状态码: ${failure.status ?? "无"}
  - 尝试次数: ${failure.attempts ?? "无"}
  - 原因: ${failure.message}`).join("\n");
}

function renderReviewers(reviewers = {}) {
  const items = [`主审模型 (${reviewers.primary?.provider || "unknown"}/${reviewers.primary?.model || "unknown"})`];
  if (reviewers.second) {
    items.push(`二审模型 (${reviewers.second.provider}/${reviewers.second.model})`);
  }
  return items.join(", ");
}

function renderSources(sources = []) {
  if (!sources.length) return "未知";
  return sources.map((source) => `${reviewerLabel(source.reviewer)} (${source.provider}/${source.model})`).join(", ");
}

function reviewerLabel(reviewer) {
  if (reviewer === "primary") return "主审模型";
  if (reviewer === "second") return "二审模型";
  if (reviewer === "requirement-auditor") return "需求理解审核员";
  return "未知模型";
}

function normalizeSources(sources = []) {
  return Array.isArray(sources)
    ? sources.map((source) => ({
        reviewer: source?.reviewer || "unknown",
      provider: source?.provider || "unknown",
      model: source?.model || "unknown",
    }))
    : [];
}

function renderNotes(notes = []) {
  return notes.length ? notes.map((note) => `- ${note}`).join("\n") : "- 无";
}

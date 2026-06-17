import { formatVerdict } from "./review-display.mjs";

export function renderMarkdownReport(result) {
  const blocking = renderFindings(result.blocking_findings);
  const warnings = renderFindings(result.warnings);
  const notes = result.verification_notes?.map((note) => `- ${note}`).join("\n") || "- 无";

  return `# AI 代码审核报告

## 审核结论

${formatVerdict(result.verdict)}

## 摘要

${result.summary || "未提供摘要。"}

## 阻塞问题

${blocking || "无"}

## 非阻塞提醒

${warnings || "无"}

## 验证说明

${notes}

## 置信度

${result.confidence}
`;
}

function renderFindings(findings = []) {
  return findings
    .map((finding) => {
      const location = renderLocation(finding);
      return `- [${renderText(finding.severity, "P2")}] ${renderText(finding.title, "未命名问题")}
  - 来源: ${renderSources(finding)}
  - 位置: ${location}
  - 证据: ${renderText(finding.evidence, "未提供证据。")}
  - 影响: ${renderText(finding.impact, "未说明影响。")}
  - 建议修复: ${renderText(finding.suggested_fix, "未提供修复建议。")}`;
    })
    .join("\n");
}

function renderLocation(finding) {
  const file = renderText(finding.file, "未定位");
  return finding.line ? `${file}:${finding.line}` : file;
}

function renderSources(finding) {
  const sources = normalizeSources(finding.sources);
  if (!sources.length) return "未知";
  return sources.map(formatSource).join(", ");
}

function formatSource(source) {
  const reviewer = source.reviewer === "primary"
    ? "主审模型"
    : source.reviewer === "second"
      ? "二审模型"
      : source.reviewer === "requirement-auditor"
        ? "需求理解审核员"
        : "未知模型";
  return `${reviewer} (${source.provider}/${source.model})`;
}

function normalizeSources(sources = []) {
  return Array.isArray(sources)
    ? sources
      .map((source) => ({
        reviewer: renderText(source?.reviewer, "unknown"),
        provider: renderText(source?.provider, "unknown"),
        model: renderText(source?.model, "unknown"),
      }))
      .filter((source) => source.reviewer || source.provider || source.model)
    : [];
}

function renderText(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

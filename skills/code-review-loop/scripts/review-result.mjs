export function parseReviewResult(content, options = {}) {
  const raw = extractJson(content);
  if (options.strict !== false) {
    validateRawResult(raw);
  }
  return normalizeReviewResult(raw);
}

export function validateRawResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Reviewer response did not contain valid JSON.");
  }
  const errors = [];
  const allowedTopLevelKeys = new Set([
    "verdict", "verdict_label", "summary", "blocking_findings", "warnings", "verification_notes", "confidence",
  ]);
  for (const key of Object.keys(result)) {
    if (!allowedTopLevelKeys.has(key)) {
      errors.push(`unexpected top-level property: ${key}`);
    }
  }
  if (!["pass", "fail", "needs_human"].includes(result.verdict)) {
    errors.push(`invalid verdict: ${JSON.stringify(result.verdict)}`);
  }
  if (typeof result.summary !== "string") {
    errors.push("summary is not a string");
  }
  if (result.verdict_label !== undefined && typeof result.verdict_label !== "string") {
    errors.push("verdict_label is not a string");
  }
  if (!Array.isArray(result.blocking_findings)) {
    errors.push("blocking_findings is not an array");
  } else {
    result.blocking_findings.forEach((finding, index) => {
      validateFinding(finding, `blocking_findings[${index}]`, errors);
    });
  }
  if (!Array.isArray(result.warnings)) {
    errors.push("warnings is not an array");
  } else {
    result.warnings.forEach((finding, index) => {
      validateFinding(finding, `warnings[${index}]`, errors);
    });
  }
  if (!Array.isArray(result.verification_notes)) {
    errors.push("verification_notes is not an array");
  } else {
    result.verification_notes.forEach((note, index) => {
      if (typeof note !== "string") {
        errors.push(`verification_notes[${index}] is not a string`);
      }
    });
  }
  if (typeof result.confidence !== "number" || Number.isNaN(result.confidence)) {
    errors.push("confidence is not a number");
  } else if (result.confidence < 0 || result.confidence > 1) {
    errors.push(`confidence out of range [0, 1]: ${result.confidence}`);
  }
  if (errors.length > 0) {
    throw new Error(`Reviewer response did not contain valid JSON. Schema errors: ${errors.join("; ")}`);
  }
}

function validateFinding(finding, path, errors) {
  if (!finding || typeof finding !== "object") {
    errors.push(`${path} is not an object`);
    return;
  }
  const allowedKeys = new Set([
    "severity", "title", "file", "line", "evidence", "impact", "suggested_fix", "sources",
  ]);
  const requiredKeys = ["severity", "title", "file", "line", "evidence", "impact", "suggested_fix"];
  for (const key of requiredKeys) {
    if (!(key in finding)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  for (const key of Object.keys(finding)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path} contains unexpected property: ${key}`);
    }
  }
  if (!["P0", "P1", "P2", "P3"].includes(finding.severity)) {
    errors.push(`${path}.severity is invalid: ${JSON.stringify(finding.severity)}`);
  }
  if (typeof finding.title !== "string" || !finding.title.trim()) {
    errors.push(`${path}.title is missing or empty`);
  }
  if (typeof finding.file !== "string" || !finding.file.trim()) {
    errors.push(`${path}.file is missing or empty`);
  }
  if (finding.line !== null && finding.line !== undefined) {
    if (!Number.isInteger(finding.line) || finding.line < 1) {
      errors.push(`${path}.line is invalid: ${JSON.stringify(finding.line)}`);
    }
  }
  if (typeof finding.evidence !== "string" || !finding.evidence.trim()) {
    errors.push(`${path}.evidence is missing or empty`);
  }
  if (typeof finding.impact !== "string" || !finding.impact.trim()) {
    errors.push(`${path}.impact is missing or empty`);
  }
  if (typeof finding.suggested_fix !== "string" || !finding.suggested_fix.trim()) {
    errors.push(`${path}.suggested_fix is missing or empty`);
  }
  if (finding.sources !== undefined) {
    validateSources(finding.sources, `${path}.sources`, errors);
  }
}

function validateSources(sources, path, errors) {
  if (!Array.isArray(sources)) {
    errors.push(`${path} is not an array`);
    return;
  }
  sources.forEach((source, index) => {
    const sourcePath = `${path}[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push(`${sourcePath} is not an object`);
      return;
    }
    for (const key of Object.keys(source)) {
      if (!["reviewer", "provider", "model"].includes(key)) {
        errors.push(`${sourcePath} contains unexpected property: ${key}`);
      }
    }
    if (!["primary", "second", "unknown"].includes(source.reviewer)) {
      errors.push(`${sourcePath}.reviewer is invalid: ${JSON.stringify(source.reviewer)}`);
    }
    for (const key of ["provider", "model"]) {
      if (typeof source[key] !== "string" || !source[key].trim()) {
        errors.push(`${sourcePath}.${key} is missing or empty`);
      }
    }
  });
}

function extractJson(text) {
  if (!text) {
    throw new Error("Reviewer returned an empty response.");
  }

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (directError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch (candidateError) {
        throw malformedJsonError(candidateError, candidate);
      }
    }
    throw malformedJsonError(directError, cleaned);
  }
}

function malformedJsonError(parseError, content) {
  const parseMessage = parseError?.message ? ` Parse error: ${parseError.message}.` : "";
  const preview = outputPreview(content);
  const previewMessage = preview ? ` Output preview: ${preview}` : "";
  return new Error(`Reviewer response did not contain valid JSON.${parseMessage}${previewMessage}`);
}

function outputPreview(content) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const truncated = normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
  return JSON.stringify(truncated);
}

const validVerdicts = new Set(["pass", "fail", "needs_human"]);
const validSeverities = new Set(["P0", "P1", "P2", "P3"]);

export function normalizeReviewResult(result) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const blockingFindings = normalizeFindings(source.blocking_findings, "P1");
  const warningFindings = normalizeFindings(source.warnings, "P2");
  const promotedWarnings = warningFindings.filter(isBlockingFinding);
  const warnings = warningFindings.filter((finding) => !isBlockingFinding(finding));
  const normalized = {
    verdict: validVerdicts.has(source.verdict) ? source.verdict : "needs_human",
    verdict_label: normalizeText(source.verdict_label),
    summary: normalizeText(source.summary),
    blocking_findings: [...blockingFindings, ...promotedWarnings],
    warnings,
    verification_notes: Array.isArray(source.verification_notes)
      ? source.verification_notes.map((note) => normalizeText(note)).filter(Boolean)
      : [],
    confidence: normalizeConfidence(source.confidence),
  };

  if (promotedWarnings.length > 0) {
    normalized.verification_notes.push("已将 warnings 中的 P0/P1 自动提升为阻塞问题。");
  }

  const hasBlocking = normalized.blocking_findings.some(isBlockingFinding);
  if (hasBlocking && normalized.verdict === "pass") {
    normalized.verdict = "fail";
  }

  return normalized;
}

function normalizeFindings(findings, defaultSeverity) {
  return Array.isArray(findings)
    ? findings.map((finding) => normalizeFinding(finding, defaultSeverity))
    : [];
}

function normalizeFinding(finding, defaultSeverity) {
  const source = finding && typeof finding === "object" ? finding : {};
  return {
    severity: validSeverities.has(source.severity) ? source.severity : defaultSeverity,
    title: normalizeText(source.title, "未命名问题"),
    file: normalizeText(source.file, "未定位"),
    line: normalizeLine(source.line),
    evidence: normalizeText(source.evidence, "未提供证据。"),
    impact: normalizeText(source.impact, "未说明影响。"),
    suggested_fix: normalizeText(source.suggested_fix, "未提供修复建议。"),
    sources: normalizeSources(source.sources),
  };
}

export function isBlockingFinding(finding) {
  return ["P0", "P1"].includes(finding.severity);
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeLine(value) {
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function normalizeConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((source) => ({
      reviewer: ["primary", "second", "unknown"].includes(source?.reviewer) ? source.reviewer : "unknown",
      provider: normalizeText(source?.provider, "unknown"),
      model: normalizeText(source?.model, "unknown"),
    }))
    .filter((source) => source.reviewer || source.provider || source.model);
}

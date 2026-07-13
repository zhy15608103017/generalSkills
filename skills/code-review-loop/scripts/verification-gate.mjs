const VERIFICATION_FINDING_TITLE = "本地验证命令失败";

export function failedVerifications(verification = []) {
  return Array.isArray(verification)
    ? verification.filter((item) => Number(item?.exitCode) !== 0)
    : [];
}

export function applyVerificationGate(result, verification = []) {
  const failures = failedVerifications(verification);
  if (!failures.length) return result;

  const blockingFindings = Array.isArray(result?.blocking_findings)
    ? [...result.blocking_findings]
    : [];
  if (!blockingFindings.some((finding) => finding?.title === VERIFICATION_FINDING_TITLE)) {
    blockingFindings.push(buildVerificationFinding(failures));
  }

  return {
    ...result,
    verdict: "fail",
    summary: [
      `本地验证有 ${failures.length} 条命令失败，已确定性阻塞本次交付。`,
      result?.summary || "未提供模型审核摘要。",
    ].join("\n\n"),
    blocking_findings: blockingFindings,
    verification_notes: [
      ...failures.map((item) => `验证失败: ${item.command || "未知命令"}（退出码 ${item.exitCode}）`),
      ...(Array.isArray(result?.verification_notes) ? result.verification_notes : []),
    ],
  };
}

function buildVerificationFinding(failures) {
  return {
    severity: "P1",
    title: VERIFICATION_FINDING_TITLE,
    file: ".ai-review/latest-brief.md",
    line: null,
    evidence: failures.map(renderFailureEvidence).join("\n\n"),
    impact: "已有本地检查未通过，当前改动不能安全交付，即使 AI 代码审查没有发现其他阻塞问题。",
    suggested_fix: "修复失败原因，重新运行全部相关验证命令，并在验证通过后重新执行代码审查。",
  };
}

function renderFailureEvidence(item) {
  const output = [item?.stderr, item?.stdout].filter(Boolean).join("\n").trim();
  const preview = output ? `\n${limitText(output, 1200)}` : "";
  return `${item?.command || "未知命令"} -> exit ${item?.exitCode}${preview}`;
}

function limitText(text, maxChars) {
  const value = String(text || "");
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[验证输出已截断]`;
}

const HIGH_ACCURACY_OPTIONS = {
  maxFiles: 24,
  maxBriefBytes: 1200000,
  maxDocBytes: 60000,
  maxFileBytes: 200000,
  maxDiffBytes: 800000,
  timeoutMs: 180000,
  retries: 2,
};

const GENERIC_HIGH_RISK_PATH_PATTERNS = [
  /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/i,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml|\.github\/workflows|ci|deploy|config)(\/|\.|$)/i,
  /(^|\/)(auth|authorization|permission|security|crypto|secret|token|session|login|oauth|sso)(\/|\.|$)/i,
  /(^|\/)(db|database|migration|schema|prisma|sql)(\/|\.|$)/i,
  /(^|\/)(api|route|router|controller|middleware)(\/|\.|$)/i,
];

const HIGH_RISK_DIFF_PATTERNS = [
  /(\+.*\bexec\s*\(|\+.*\beval\s*\(|\+.*\bFunction\s*\()/,
  /(\+.*\bProcessBuilder\b|\+.*\bRuntime\.exec\b|\+.*\bos\.system\b|\+.*\bsubprocess\b)/,
  /(\+.*\brawQuery\b|\+.*\brawSelect\b|\+.*\bunsafe\b|\+.*\bqueryRaw\b|\+.*\bexecuteRaw\b)/,
  /(\+.*\binnerHTML\b|\+.*\bdangerouslySetInnerHTML\b|\+.*\binsertAdjacentHTML\b)/,
  /(\+.*\bunsafe-inline\b|\+.*\bunsafe-eval\b)/,
  /(\+.*\b\.innerHTML\b|\+.*\bouterHTML\b|\+.*\bdocument\.write\b)/,
  /(\+.*\bSELECT\b.*\+|\+.*\bINSERT\b.*\+|\+.*\bUPDATE\b.*\+|\+.*\bDELETE\b.*\+)/i,
  /(\+.*\bprintf\b|\+.*\bsprintf\b|\+.*\bformat\b.*\buser\b)/i,
  /(\+.*\bpassword\b|\+.*\bsecret\b|\+.*\bapiKey\b|\+.*\btoken\b)\s*[:=]\s*["'][^"']{8,}["']/i,
  /(\+.*\bhttp\.(get|post|put|delete|patch)\b|\+.*\bfetch\b|\+.*\baxios\b|\+.*\brequest\b)/i,
  /(\+.*\brequire\s*\(\s*["']child_process["']|\+.*\bimport\b.*\bchild_process\b)/,
  /(\+.*\bdelete\b.*\bwhere\b|\+.*\bdrop\b|\+.*\btruncate\b)/i,
];

const VALID_PROFILES = new Set(["standard", "auto", "high-accuracy"]);

export function resolveReviewProfile({
  changedFiles = [],
  diff = "",
  diffBytesHint = 0,
  options = {},
  verification = null,
}) {
  const requested = options.profile || "standard";
  if (!VALID_PROFILES.has(requested)) {
    throw new Error(`Unknown review profile "${requested}". Use standard, auto, or high-accuracy.`);
  }
  const reasons = [];

  if (requested === "high-accuracy") {
    reasons.push("用户请求 high-accuracy 配置");
  } else if (requested === "auto") {
    const diffBytes = Math.max(Buffer.byteLength(diff || "", "utf8"), Number(diffBytesHint) || 0);
    const riskMatches = changedFiles.filter((file) => GENERIC_HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(file)));
    const diffRiskMatches = HIGH_RISK_DIFF_PATTERNS.filter((pattern) => pattern.test(diff || ""));
    const failedVerification = verification?.some((item) => item.exitCode !== 0);

    if (changedFiles.length >= 8) reasons.push(`变更文件数量: ${changedFiles.length}`);
    if (diffBytes >= 150000) reasons.push(`diff 字节数: ${diffBytes}`);
    if (riskMatches.length > 0) reasons.push(`通用高风险路径: ${riskMatches.slice(0, 5).join(", ")}`);
    if (diffRiskMatches.length > 0) reasons.push(`diff 内容匹配高风险模式: ${diffRiskMatches.length} 处`);
    if (failedVerification) reasons.push("验证命令失败");
  }

  const selected = reasons.length > 0 ? "high-accuracy" : "standard";
  return {
    requested,
    selected,
    reasons,
    appliedOptions: {},
  };
}

export function applyReviewProfile(options, profile) {
  if (profile.selected !== "high-accuracy") return profile;

  for (const [key, value] of Object.entries(HIGH_ACCURACY_OPTIONS)) {
    if (!options.explicitOptions?.[key]) {
      options[key] = value;
      profile.appliedOptions[key] = value;
    }
  }

  return profile;
}

export function maxProfileFileBytes(options = {}) {
  if (options.explicitOptions?.maxFileBytes) {
    return options.maxFileBytes;
  }

  if (["auto", "high-accuracy"].includes(options.profile)) {
    return Math.max(options.maxFileBytes || 0, HIGH_ACCURACY_OPTIONS.maxFileBytes);
  }

  return options.maxFileBytes;
}

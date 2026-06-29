const INFINITY_ALIASES = new Set(["infinity", "infinite", "inf", "unlimited"]);

export function parseMaxReviewRoundsValue(value) {
  const normalized = normalizeLimitText(value);
  if (INFINITY_ALIASES.has(normalized)) return Infinity;
  return Number(value);
}

export function resolveReviewLimits(options = {}, env = process.env) {
  const maxReviewRounds = resolveMaxReviewRounds(options, env);
  return {
    maxReviewRounds: maxReviewRounds === Infinity ? "infinity" : maxReviewRounds,
  };
}

export function resolveMaxReviewRounds(options = {}, env = process.env) {
  const values = [
    options.maxReviewRounds,
    readEnv(env, "AI_REVIEW_MAX_REVIEW_ROUNDS"),
    3,
  ];

  for (const value of values) {
    const resolved = parseReviewLimitValue(value);
    if (resolved !== undefined) return resolved;
  }

  return 3;
}

export function renderReviewLimitValue(value, env = process.env) {
  const resolved = parseReviewLimitValue(value);
  if (resolved === Infinity) return "infinity";
  if (resolved !== undefined) return String(resolved);

  const envValue = readEnv(env, "AI_REVIEW_MAX_REVIEW_ROUNDS");
  if (envValue && envValue !== value) return renderReviewLimitValue(envValue, env);
  return "3";
}

function parseReviewLimitValue(value) {
  if (value === Infinity) return Infinity;

  const normalized = normalizeLimitText(value);
  if (INFINITY_ALIASES.has(normalized)) return Infinity;

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  return undefined;
}

function normalizeLimitText(value) {
  return String(value || "").trim().toLowerCase();
}

function readEnv(env, name) {
  const value = env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const REVIEW_ROUND_STATE_VERSION = "v1";

export async function beginReviewRound({ outDir, context, maxReviewRounds = 3, reset = false }) {
  const statePath = path.join(outDir, "cache", "review-round.json");
  if (reset) await fs.rm(statePath, { force: true });

  const requestFingerprint = buildRequestFingerprint(context);
  const previous = await readReviewRoundState(statePath);
  const previousRound = previous?.requestFingerprint === requestFingerprint
    ? normalizeRound(previous.round)
    : 0;
  const round = previousRound + 1;
  const limit = normalizeLimit(maxReviewRounds);

  return {
    allowed: limit === Infinity || round <= limit,
    round,
    limit,
    requestFingerprint,
    statePath,
  };
}

export async function completeReviewRound({ roundState, verdict }) {
  if (!roundState?.statePath) return;
  if (verdict === "pass") {
    await fs.rm(roundState.statePath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(roundState.statePath), { recursive: true });
  await writeFileAtomically(roundState.statePath, `${JSON.stringify({
    version: REVIEW_ROUND_STATE_VERSION,
    requestFingerprint: roundState.requestFingerprint,
    round: roundState.round,
    limit: roundState.limit === Infinity ? "infinity" : roundState.limit,
    lastVerdict: verdict || "needs_human",
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function reviewRoundLimitResult(roundState) {
  const limit = roundState?.limit === Infinity ? "infinity" : roundState?.limit || 3;
  return {
    verdict: "needs_human",
    summary: `已达到审核/修复闭环上限 ${limit} 轮，工具已停止继续调用审核模型。`,
    blocking_findings: [],
    warnings: [],
    verification_notes: [
      "请由人工决定是否继续修复、扩大轮次上限，或使用 --reset-review-rounds 开始新的闭环。",
    ],
    confidence: 0,
  };
}

export function buildRequestFingerprint(context = {}) {
  const requestDoc = (context.docs || []).find((doc) => doc.label === "用户需求");
  const payload = requestDoc?.contentHash || requestDoc?.content || "missing-request-context";
  return crypto.createHash("sha256").update(String(payload)).digest("hex");
}

async function readReviewRoundState(statePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    return parsed?.version === REVIEW_ROUND_STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeLimit(value) {
  if (value === Infinity || String(value).toLowerCase() === "infinity") return Infinity;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 3;
}

function normalizeRound(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 0;
}

async function writeFileAtomically(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

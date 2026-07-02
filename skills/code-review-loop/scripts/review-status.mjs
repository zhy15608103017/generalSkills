import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_HEARTBEAT_MS = 15000;

export function createStatusReporter({
  outDir,
  stream = process.stderr,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  silent = false,
} = {}) {
  return new ReviewStatusReporter({ outDir, stream, heartbeatMs, silent });
}

export class ReviewStatusReporter {
  constructor({ outDir, stream, heartbeatMs, silent }) {
    this.outDir = outDir;
    this.stream = stream;
    this.heartbeatMs = normalizeHeartbeatMs(heartbeatMs);
    this.silent = silent;
    this.startedAt = Date.now();
    this.sequence = 0;
    this.writeQueue = Promise.resolve();
    this.latest = null;
  }

  async update(partial = {}, { log = true } = {}) {
    if (!this.outDir) return;

    const now = Date.now();
    const status = {
      status: "running",
      phase: "unknown",
      message: "",
      ...this.latest,
      ...partial,
      updatedAt: new Date(now).toISOString(),
      elapsedMs: now - this.startedAt,
      sequence: ++this.sequence,
    };
    if (partial.heartbeat === undefined) {
      delete status.heartbeat;
    }
    this.latest = status;

    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => this.writeStatusFiles(status));
    await this.writeQueue;

    if (log && !this.silent && this.stream) {
      this.stream.write(`${formatStatusLine(status)}\n`);
    }
  }

  async run(partial, callback) {
    await this.update(partial);
    const timer = this.startHeartbeat(partial);
    try {
      return await callback();
    } finally {
      clearInterval(timer);
    }
  }

  async complete(partial = {}) {
    await this.update({ ...partial, status: "complete" });
  }

  async fail(error, partial = {}) {
    await this.update({
      ...partial,
      status: "failed",
      message: partial.message || error?.message || "code-review-loop 执行失败。",
    });
  }

  startHeartbeat(partial) {
    const interval = this.heartbeatMs;
    if (interval <= 0) return null;

    return setInterval(() => {
      this.update({
        heartbeat: true,
        message: heartbeatMessage(this.latest, partial),
      }).catch(() => {});
    }, interval);
  }

  async writeStatusFiles(status) {
    await fs.mkdir(this.outDir, { recursive: true });
    await Promise.all([
      writeFileAtomically(path.join(this.outDir, "latest-status.json"), `${JSON.stringify(status, null, 2)}\n`),
      writeFileAtomically(path.join(this.outDir, "latest-status.md"), renderStatusMarkdown(status)),
    ]);
  }
}

function formatStatusLine(status) {
  const elapsed = formatElapsed(status.elapsedMs);
  const phase = status.phase || "unknown";
  const message = status.message ? ` ${status.message}` : "";
  return `[${elapsed}] ${phase}:${message}`;
}

function heartbeatMessage(latest, fallback = {}) {
  const message = latest?.message || fallback.message;
  return message ? `${message.replace(/（仍在等待）$/, "")}（仍在等待）` : "仍在等待当前阶段完成。";
}

function normalizeHeartbeatMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_HEARTBEAT_MS;
}

async function writeFileAtomically(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

function renderStatusMarkdown(status) {
  const details = Object.entries(status)
    .filter(([key, value]) => !["message", "phase", "status"].includes(key) && value !== undefined)
    .map(([key, value]) => `- ${key}: ${renderValue(value)}`)
    .join("\n");

  return `# AI 审核状态

- 状态: ${status.status}
- 阶段: ${status.phase}
- 消息: ${status.message || "无"}
${details ? `\n${details}\n` : ""}
`;
}

function renderValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

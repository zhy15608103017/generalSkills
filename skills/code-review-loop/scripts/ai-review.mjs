import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectReviewContext,
  getGitRoot,
  parseArgs,
  renderReviewBrief,
} from "./collect-context.mjs";
import {
  callReviewModel,
  isBlockingFinding,
  loadEnvFile,
  loadReviewerAssets,
  resolveProviderOptions,
} from "./call-model.mjs";
import {
  buildHistoryEntry,
  formatVerdict,
  renderHistoryMarkdownEntry,
  withDisplayFields,
} from "./review-display.mjs";
import {
  decorateRequirementAuditBlock,
  loadRequirementAuditorPrompt,
  renderRequirementAuditBrief,
  withRequirementAuditPass,
  writeRequirementAuditArtifacts,
} from "./requirement-audit.mjs";
import { assertRequestContext } from "./request-context.mjs";
import { renderMarkdownReport } from "./review-report.mjs";
import { formatReviewRunId } from "./time-format.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = await getGitRoot();
  await assertRequestContext(root, options);
  const context = await collectReviewContext(options);
  await loadEnvFile(context.root);
  const brief = renderReviewBrief(context);
  const outDir = path.resolve(context.root, options.outDir || ".ai-review");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "latest-brief.md"), brief, "utf8");

  if (!options.allowEmpty && !options.dryRun && context.changedFiles.length === 0) {
    throw new Error("未找到可审核的本地变更。只有在确实需要空审核时才传入 --allow-empty。");
  }

  if (options.dryRun) {
    const assets = await loadReviewerAssets();
    let providerOptions = { provider: "unconfigured", model: "unconfigured" };
    try {
      providerOptions = resolveProviderOptions(options, assets.providersConfig);
    } catch {
      providerOptions = { provider: "unconfigured", model: "unconfigured" };
    }
    const dryResult = {
      verdict: "needs_human",
      summary: "dry-run 已完成，未调用审核模型。",
      blocking_findings: [],
      warnings: [],
      verification_notes: [
        "已生成代码审核上下文，可用于检查即将发送给审核模型的内容。",
        `Provider/Model: ${providerOptions.provider}/${providerOptions.model}`,
      ],
      confidence: 0,
    };
    const outputMeta = await writeOutputs(outDir, dryResult, brief, options);
    await appendHistory(outDir, dryResult, options, context, { primary: providerOptions, second: null }, outputMeta);
    process.stdout.write(renderConsoleSummary(dryResult, outDir));
    return;
  }

  const assets = await loadReviewerAssets();
  const primaryResolved = resolveProviderOptions(options, assets.providersConfig);
  const secondReviewOptions = resolveSecondReviewOptions(options, assets.providersConfig);
  const secondResolved = secondReviewOptions
    ? resolveProviderOptions(secondReviewOptions, assets.providersConfig)
    : null;
  const requirementAudit = await runRequirementAudit({
    context,
    outDir,
    assets,
    options,
    primaryResolved,
  });

  if (requirementAudit.result.verdict !== "pass") {
    const result = decorateRequirementAuditBlock(requirementAudit.result);
    const outputMeta = await writeOutputs(outDir, result, requirementAudit.brief, options);
    await appendHistory(outDir, result, options, context, { primary: primaryResolved, second: null }, outputMeta);
    process.stdout.write(renderConsoleSummary(result, outDir));
    if (result.verdict === "fail") {
      process.exitCode = 2;
    } else if (result.verdict === "needs_human") {
      process.exitCode = 3;
    }
    return;
  }

  const reviewRun = await runReviewPasses({
    brief,
    assets,
    options,
    primaryResolved,
    secondResolved,
  });
  const result = withRequirementAuditPass(reviewRun.result, requirementAudit.result);

  const outputMeta = await writeOutputs(outDir, result, brief, options);
  await appendHistory(outDir, result, options, context, reviewRun.resolved, outputMeta);
  process.stdout.write(renderConsoleSummary(result, outDir));

  if (result.verdict === "fail") {
    process.exitCode = 2;
  } else if (result.verdict === "needs_human") {
    process.exitCode = 3;
  }
}

async function runRequirementAudit({ context, outDir, assets, options, primaryResolved }) {
  const auditBrief = renderRequirementAuditBrief(context);
  const auditPrompt = await loadRequirementAuditorPrompt();
  const result = attachReviewerSource(await callReviewModelWithMalformedRetry({
    brief: auditBrief,
    systemPrompt: auditPrompt,
    schema: assets.schema,
    options,
    providersConfig: assets.providersConfig,
  }), reviewerSource("requirement-auditor", primaryResolved));
  await writeRequirementAuditArtifacts(outDir, result, auditBrief);
  return { result, brief: auditBrief };
}

async function runReviewPasses({ brief, assets, options, primaryResolved, secondResolved }) {
  const primaryResult = attachReviewerSource(await callReviewModelWithMalformedRetry({
    brief,
    systemPrompt: assets.systemPrompt,
    schema: assets.schema,
    options,
    providersConfig: assets.providersConfig,
  }), reviewerSource("primary", primaryResolved));
  const secondOptions = resolveSecondReviewOptions(options, assets.providersConfig);
  const primaryRun = { result: primaryResult, resolved: { primary: primaryResolved, second: null } };
  if (!secondOptions) return primaryRun;
  if (!shouldRunSecondReview(primaryResult, options)) return primaryRun;

  const secondaryResult = attachReviewerSource(await callReviewModelWithMalformedRetry({
    brief,
    systemPrompt: assets.systemPrompt,
    schema: assets.schema,
    options: secondOptions,
    providersConfig: assets.providersConfig,
  }), reviewerSource("second", secondResolved));
  return {
    result: mergeReviewResults(primaryResult, secondaryResult),
    resolved: { primary: primaryResolved, second: secondResolved },
  };
}

export function buildSecondReviewOptions(options, providersConfig) {
  const secondReviewMode = resolveSecondReviewMode(options);
  if (secondReviewMode === "off") {
    return null;
  }

  const secondConfig = {
    provider: options.secondProvider || readEnv("AI_REVIEW_SECOND_PROVIDER"),
    model: options.secondModel || readEnv("AI_REVIEW_SECOND_MODEL"),
    baseUrl: options.secondBaseUrl || readEnv("AI_REVIEW_SECOND_BASE_URL"),
    apiKey: options.secondApiKey || readEnv("AI_REVIEW_SECOND_API_KEY"),
    apiStyle: options.secondApiStyle || readEnv("AI_REVIEW_SECOND_API_STYLE"),
    transport: options.secondTransport || readEnv("AI_REVIEW_SECOND_TRANSPORT"),
    cliCommand: options.secondCliCommand || readEnv("AI_REVIEW_SECOND_CLI_COMMAND"),
  };

  if (!isSecondReviewerConfigured(secondConfig)) {
    return null;
  }

  return {
    ...options,
    usePrimaryEnv: false,
    secondReviewMode,
    provider: secondConfig.provider || (secondConfig.model ? undefined : options.provider),
    model: secondConfig.model || options.model,
    baseUrl: secondConfig.baseUrl || options.baseUrl,
    apiKey: secondConfig.apiKey || options.apiKey,
    apiStyle: secondConfig.apiStyle || options.apiStyle,
    transport: secondConfig.transport || options.transport,
    cliCommand: secondConfig.cliCommand || options.cliCommand,
  };
}

export function resolveSecondReviewOptions(options, providersConfig) {
  const secondOptions = buildSecondReviewOptions(options, providersConfig);
  if (!secondOptions || !providersConfig) return secondOptions;
  return hasUsableProviderConfig(secondOptions, providersConfig) ? secondOptions : null;
}

export function shouldRunSecondReview(primaryResult, options = {}) {
  const secondReviewMode = resolveSecondReviewMode(options);
  if (secondReviewMode === "off") return false;
  if (secondReviewMode === "always") return true;
  return meetsSecondReviewThreshold(primaryResult, options);
}

function resolveSecondReviewMode(options = {}) {
  const mode = normalizeSecondReviewMode(
    options.secondReviewMode || readEnv("AI_REVIEW_SECOND_REVIEW_MODE") || "auto",
  );
  if (!mode) {
    throw new Error("Invalid second review mode. Use always, auto, or off.");
  }
  return mode;
}

function isSecondReviewerConfigured(config) {
  return Boolean(
    config.provider ||
    config.model ||
    config.baseUrl ||
    config.apiStyle ||
    config.transport ||
    config.cliCommand
  );
}

function hasUsableProviderConfig(options, providersConfig) {
  try {
    const providerOptions = resolveProviderOptions(options, providersConfig);
    if (providerOptions.transport === "cli") return Boolean(providerOptions.cliCommand);
    return Boolean(providerOptions.baseUrl && providerOptions.apiKey);
  } catch {
    return false;
  }
}

function meetsSecondReviewThreshold(result, options) {
  const counts = countFindingsBySeverity(result);
  const thresholds = resolveSecondReviewThresholds(options);
  return counts.P0 >= thresholds.P0 || counts.P1 >= thresholds.P1 || counts.P2 >= thresholds.P2;
}

function countFindingsBySeverity(result) {
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const finding of [...(result.blocking_findings || []), ...(result.warnings || [])]) {
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
  }
  return counts;
}

function resolveSecondReviewThresholds(options = {}) {
  return {
    P0: positiveInteger(options.secondP0Threshold, readEnv("AI_REVIEW_SECOND_P0_THRESHOLD"), 1),
    P1: positiveInteger(options.secondP1Threshold, readEnv("AI_REVIEW_SECOND_P1_THRESHOLD"), 1),
    P2: positiveInteger(options.secondP2Threshold, readEnv("AI_REVIEW_SECOND_P2_THRESHOLD"), 3),
  };
}

function positiveInteger(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

function normalizeSecondReviewMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["always", "on", "true", "1", "force"].includes(normalized)) return "always";
  if (["auto", "p0p1", "blocking"].includes(normalized)) return "auto";
  if (["off", "false", "0", "disabled", "disable"].includes(normalized)) return "off";
  return null;
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function callReviewModelWithMalformedRetry(reviewOptions) {
  try {
    return await callReviewModel(reviewOptions);
  } catch (error) {
    if (!isMalformedReviewerOutput(error)) {
      throw error;
    }
    return callReviewModel(reviewOptions);
  }
}

function isMalformedReviewerOutput(error) {
  const message = String(error?.message || "");
  return [
    "Reviewer returned an empty response.",
    "Reviewer response did not contain valid JSON.",
  ].some((prefix) => message.startsWith(prefix));
}

export function mergeReviewResults(primary, secondary) {
  const mergedFindings = dedupeFindings([
    ...(primary.blocking_findings || []),
    ...(primary.warnings || []),
    ...(secondary.blocking_findings || []),
    ...(secondary.warnings || []),
  ]);
  const blockingFindings = mergedFindings.filter(isBlockingFinding);
  const warnings = mergedFindings.filter((finding) => !isBlockingFinding(finding));
  const verdict = primary.verdict === "fail" || secondary.verdict === "fail"
    ? "fail"
    : primary.verdict === "needs_human" || secondary.verdict === "needs_human"
      ? "needs_human"
      : "pass";

  const merged = {
    verdict,
    summary: [`主审摘要: ${primary.summary || "未提供摘要。"}`, `二审摘要: ${secondary.summary || "未提供摘要。"}`].join("\n\n"),
    blocking_findings: blockingFindings,
    warnings,
    verification_notes: [
      `主审结论: ${formatVerdict(primary.verdict)}`,
      `二审结论: ${formatVerdict(secondary.verdict)}`,
      ...(primary.verification_notes || []),
      ...(secondary.verification_notes || []),
    ],
    confidence: Math.min(numberOrZero(primary.confidence), numberOrZero(secondary.confidence)),
  };

  if (merged.blocking_findings.some(isBlockingFinding) && merged.verdict === "pass") {
    merged.verdict = "fail";
    merged.verification_notes.push("合并后 blocking_findings 含 P0/P1，verdict 已自动纠正为 fail。");
  }

  return merged;
}

function dedupeFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    const key = JSON.stringify([
      stableFindingText(finding.title),
      stableFindingText(finding.evidence),
      stableFindingText(finding.impact),
      stableFindingText(finding.suggested_fix),
    ]);
    const existing = byKey.get(key);
    if (existing) {
      existing.sources = mergeSources(existing.sources, finding.sources);
      existing.severity = highestSeverity(existing.severity, finding.severity);
    } else {
      byKey.set(key, { ...finding, sources: normalizeSources(finding.sources) });
    }
  }
  return [...byKey.values()];
}

function stableFindingText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function highestSeverity(first = "P2", second = "P2") {
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (rank[second] ?? 99) < (rank[first] ?? 99) ? second : first;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function attachReviewerSource(result, source) {
  return {
    ...result,
    blocking_findings: attachSourceToFindings(result.blocking_findings, source),
    warnings: attachSourceToFindings(result.warnings, source),
  };
}

function attachSourceToFindings(findings = [], source) {
  return findings.map((finding) => ({
    ...finding,
    sources: mergeSources([], [source]),
  }));
}

function reviewerSource(reviewer, resolved) {
  return {
    reviewer,
    provider: resolved?.provider || "unknown",
    model: resolved?.model || "unknown",
  };
}

function mergeSources(existing = [], additions = []) {
  const sources = [...normalizeSources(existing), ...normalizeSources(additions)];
  const seen = new Set();
  return sources.filter((source) => {
    const key = JSON.stringify([source.reviewer, source.provider, source.model]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function writeOutputs(outDir, result, brief, options = {}) {
  const outputResult = withDisplayFields(result);
  const report = renderMarkdownReport(outputResult);
  const latestResultPath = path.join(outDir, "latest-result.json");
  const latestReportPath = path.join(outDir, "latest-report.md");
  const latestBriefPath = path.join(outDir, "latest-brief.md");
  const { runId, runDir } = await reserveRunDirectory(outDir, formatReviewRunId(new Date(), options));
  const runResultPath = path.join(runDir, "result.json");
  const runReportPath = path.join(runDir, "report.md");
  const runBriefPath = path.join(runDir, "brief.md");

  await fs.writeFile(latestResultPath, `${JSON.stringify(outputResult, null, 2)}\n`, "utf8");
  await fs.writeFile(latestReportPath, report, "utf8");
  await fs.writeFile(runResultPath, `${JSON.stringify(outputResult, null, 2)}\n`, "utf8");
  await fs.writeFile(runReportPath, report, "utf8");
  await fs.writeFile(runBriefPath, brief || "", "utf8");

  return {
    runId,
    latestResultPath,
    latestReportPath,
    latestBriefPath,
    runResultPath,
    runReportPath,
    runBriefPath,
  };
}

async function appendHistory(outDir, result, options, context, resolved = {}, outputMeta = {}) {
  const historyPath = path.join(outDir, "history.jsonl");
  const historyMarkdownPath = path.join(outDir, "history.md");
  const entry = buildHistoryEntry({ result, options, context, resolved, outputMeta });
  await fs.appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
  await fs.appendFile(historyMarkdownPath, renderHistoryMarkdownEntry(entry), "utf8");
  await pruneHistory(outDir, resolveHistoryLimit(options));
}

async function reserveRunDirectory(outDir, preferredRunId) {
  const runsDir = path.join(outDir, "runs");
  await fs.mkdir(runsDir, { recursive: true });

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const runId = suffix === 0 ? preferredRunId : `${preferredRunId}-${suffix + 1}`;
    const runDir = path.join(runsDir, runId);
    try {
      await fs.mkdir(runDir);
      return { runId, runDir };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  throw new Error(`无法创建唯一审核运行目录: ${preferredRunId}`);
}

async function pruneHistory(outDir, limit) {
  const entries = await readHistoryEntries(path.join(outDir, "history.jsonl"));
  const keptEntries = limit === 0 ? [] : entries.slice(-limit);
  await rewriteHistoryFiles(outDir, keptEntries);
  await pruneRunDirectories(path.join(outDir, "runs"), new Set(keptEntries.map((entry) => entry.runId).filter(Boolean)), limit);
}

function resolveHistoryLimit(options = {}) {
  const configured = Number.isFinite(options.historyLimit)
    ? options.historyLimit
    : Number(readEnv("AI_REVIEW_HISTORY_LIMIT"));
  if (!Number.isFinite(configured) || configured < 0) return 5;
  return Math.floor(configured);
}

async function readHistoryEntries(historyPath) {
  try {
    const content = await fs.readFile(historyPath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && typeof entry === "object");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function rewriteHistoryFiles(outDir, entries) {
  const historyPath = path.join(outDir, "history.jsonl");
  const historyMarkdownPath = path.join(outDir, "history.md");
  const jsonl = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const markdown = entries.map(renderHistoryMarkdownEntry).join("");
  await fs.writeFile(historyPath, jsonl ? `${jsonl}\n` : "", "utf8");
  await fs.writeFile(historyMarkdownPath, markdown, "utf8");
}

async function pruneRunDirectories(runsDir, keptRunIds, limit) {
  let directories;
  try {
    directories = await fs.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const runDirs = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(runsDir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = (await fs.stat(fullPath)).mtimeMs;
        } catch {
          // Directory may have disappeared while pruning.
        }
        return { name: entry.name, fullPath, mtimeMs };
      }),
  );
  const sorted = runDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const fallbackKept = new Set(sorted.slice(0, limit).map((entry) => entry.name));

  await Promise.all(sorted.map(async (entry) => {
    if (keptRunIds.has(entry.name) || fallbackKept.has(entry.name)) return;
    await fs.rm(entry.fullPath, { recursive: true, force: true });
  }));
}

function renderConsoleSummary(result, outDir) {
  return [
    `AI 审核结论: ${formatVerdict(result.verdict)}`,
    `审核报告: ${path.join(outDir, "latest-report.md")}`,
    `结构化结果: ${path.join(outDir, "latest-result.json")}`,
    `审核上下文: ${path.join(outDir, "latest-brief.md")}`,
    "",
  ].join("\n");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`code-review-loop 执行失败: ${error.message}\n`);
    process.exitCode = 1;
  });
}

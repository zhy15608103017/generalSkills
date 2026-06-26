import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectReviewContext,
  getGitRoot,
  parseArgs,
  renderReviewBrief,
  resolveMaxReviewRounds,
  resolveReviewLimits,
} from "./collect-context.mjs";
import {
  callReviewModel,
  classifyReviewError,
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
  buildRequirementAuditCacheKey,
  clearCachedRequirementAudit,
  decorateRequirementAuditBlock,
  loadRequirementAuditorPrompt,
  readCachedRequirementAudit,
  renderRequirementAuditBrief,
  withRequirementAuditPass,
  writeCachedRequirementAudit,
  writeRequirementAuditArtifacts,
} from "./requirement-audit.mjs";
import { assertRequestContext } from "./request-context.mjs";
import { renderMarkdownReport } from "./review-report.mjs";
import { formatReviewRunId } from "./time-format.mjs";

export { resolveMaxReviewRounds };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = await getGitRoot();
  await assertRequestContext(root, options);
  const context = await collectReviewContext(options);
  await loadEnvFile(context.root);
  context.reviewLimits = resolveReviewLimits(options);
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
  let primaryResolved;
  try {
    primaryResolved = resolveProviderOptions(options, assets.providersConfig);
  } catch (error) {
    const fallbackResolved = fallbackPrimaryReviewer(options);
    const result = providerResolutionFailureResult(error, fallbackResolved);
    await writeRequirementAuditArtifacts(outDir, result, renderRequirementAuditBrief(context));
    const outputMeta = await writeOutputs(outDir, result, brief, options);
    await appendHistory(outDir, result, options, context, { primary: fallbackResolved, second: null }, outputMeta);
    process.stdout.write(renderConsoleSummary(result, outDir));
    process.exitCode = 3;
    return;
  }
  const secondReviewSetup = resolveSecondReviewSetup(options, assets.providersConfig);
  const secondResolved = secondReviewSetup.resolved;
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
    secondReviewSetup,
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

export async function runRequirementAudit({
  context,
  outDir,
  assets,
  options,
  primaryResolved,
  callReviewModelFn = callReviewModel,
}) {
  const auditBrief = renderRequirementAuditBrief(context);
  const auditPrompt = await loadRequirementAuditorPrompt();
  const cacheKey = buildRequirementAuditCacheKey({ context, auditPrompt, primaryResolved });
  if (!options.noRequirementAuditCache) {
    const cachedResult = await readCachedRequirementAudit(outDir, cacheKey);
    if (cachedResult) {
      await writeRequirementAuditArtifacts(outDir, cachedResult, auditBrief);
      return { result: cachedResult, brief: auditBrief };
    }
  }

  let result;
  try {
    result = attachReviewerSource(await callReviewModelWithMalformedRetry({
      brief: auditBrief,
      systemPrompt: auditPrompt,
      schema: assets.schema,
      options,
      providersConfig: assets.providersConfig,
    }, callReviewModelFn), reviewerSource("requirement-auditor", primaryResolved));
  } catch (error) {
    result = {
      verdict: "needs_human",
      summary: "需求理解审核模型调用失败，需要人工确认。",
      blocking_findings: [],
      warnings: [],
      verification_notes: [`需求理解审核模型调用失败: ${errorMessage(error)}`],
      reviewer_failures: [
        buildReviewerFailure({
          phase: "requirement_audit",
          reviewer: "requirement-auditor",
          resolved: primaryResolved,
          error,
        }),
      ],
      confidence: 0,
    };
  }
  if (result.verdict === "pass") {
    await writeCachedRequirementAudit(outDir, cacheKey, result);
  } else {
    await clearCachedRequirementAudit(outDir, cacheKey);
  }
  await writeRequirementAuditArtifacts(outDir, result, auditBrief);
  return { result, brief: auditBrief };
}

export async function runReviewPasses({
  brief,
  assets,
  options,
  primaryResolved,
  secondResolved,
  secondReviewSetup = null,
  callReviewModelFn = callReviewModel,
}) {
  const resolvedSecondReviewSetup = secondReviewSetup || resolveSecondReviewSetup(options, assets.providersConfig);
  const secondOptions = resolvedSecondReviewSetup.options;
  const effectiveSecondResolved = secondResolved || resolvedSecondReviewSetup.resolved;
  const secondConfigFailure = resolvedSecondReviewSetup.failure;
  const secondConfigError = resolvedSecondReviewSetup.error;
  const secondReviewMode = resolveSecondReviewMode(options);
  const primaryReview = () => runSingleReview({
    brief,
    assets,
    options,
    resolved: primaryResolved,
    reviewer: "primary",
    callReviewModelFn,
  });
  const secondReview = () => runSingleReview({
    brief,
    assets,
    options: secondOptions,
    resolved: effectiveSecondResolved,
    reviewer: "second",
    callReviewModelFn,
  });

  if (secondConfigFailure && secondReviewMode === "always") {
    const primaryOutcome = await settleReview(primaryReview(), {
      phase: "code_review",
      reviewer: "primary",
      resolved: primaryResolved,
    });
    return combineReviewOutcomes({
      primaryOutcome,
      secondOutcome: {
        ok: false,
        error: secondConfigError,
        failure: secondConfigFailure,
      },
      primaryResolved,
      secondResolved: effectiveSecondResolved,
      secondReviewMode,
    });
  }

  if (secondOptions && secondReviewMode === "always") {
    const [primaryOutcome, secondOutcome] = await Promise.all([
      settleReview(primaryReview(), {
        phase: "code_review",
        reviewer: "primary",
        resolved: primaryResolved,
      }),
      settleReview(secondReview(), {
        phase: "code_review",
        reviewer: "second",
        resolved: effectiveSecondResolved,
      }),
    ]);
    return combineReviewOutcomes({
      primaryOutcome,
      secondOutcome,
      primaryResolved,
      secondResolved: effectiveSecondResolved,
      secondReviewMode,
    });
  }

  const primaryOutcome = await settleReview(primaryReview(), {
    phase: "code_review",
    reviewer: "primary",
    resolved: primaryResolved,
  });
  if (!primaryOutcome.ok) {
    if (secondConfigFailure && secondReviewMode !== "off") {
      return combineReviewOutcomes({
        primaryOutcome,
        secondOutcome: {
          ok: false,
          error: secondConfigError,
          failure: secondConfigFailure,
        },
        primaryResolved,
        secondResolved: effectiveSecondResolved,
        secondReviewMode,
      });
    }
    if (secondOptions && secondReviewMode !== "off") {
      const secondOutcome = await settleReview(secondReview(), {
        phase: "code_review",
        reviewer: "second",
        resolved: effectiveSecondResolved,
      });
      return combineReviewOutcomes({
        primaryOutcome,
        secondOutcome,
        primaryResolved,
        secondResolved: effectiveSecondResolved,
        secondReviewMode,
      });
    }
    return singleReviewerFailureRun(primaryOutcome, primaryResolved);
  }

  const primaryResult = primaryOutcome.result;
  const primaryRun = { result: primaryResult, resolved: { primary: primaryResolved, second: null } };
  if (secondConfigFailure && shouldRunSecondReview(primaryResult, options)) {
    return {
      result: withReviewerFailures(
        withReviewNotes(primaryResult, [
          secondReviewNote(effectiveSecondResolved, secondReviewMode),
          `二审模型配置不可用，未运行二审模型。原因: ${errorMessage(secondConfigError)}`,
        ]),
        [secondConfigFailure],
      ),
      resolved: { primary: primaryResolved, second: effectiveSecondResolved },
    };
  }
  if (!secondOptions) return primaryRun;
  if (!shouldRunSecondReview(primaryResult, options)) {
    return {
      result: withReviewNotes(primaryResult, [
        secondReviewNote(effectiveSecondResolved, secondReviewMode),
        "检测到二审配置，但 auto 模式未达到触发条件，未运行二审模型。",
      ]),
      resolved: { primary: primaryResolved, second: null },
    };
  }

  const secondOutcome = await settleReview(secondReview(), {
    phase: "code_review",
    reviewer: "second",
    resolved: effectiveSecondResolved,
  });
  return combineReviewOutcomes({
    primaryOutcome,
    secondOutcome,
    primaryResolved,
    secondResolved: effectiveSecondResolved,
    secondReviewMode,
  });
}

async function runSingleReview({ brief, assets, options, resolved, reviewer, callReviewModelFn }) {
  return attachReviewerSource(await callReviewModelWithMalformedRetry({
    brief,
    systemPrompt: assets.systemPrompt,
    schema: assets.schema,
    options,
    providersConfig: assets.providersConfig,
  }, callReviewModelFn), reviewerSource(reviewer, resolved));
}

async function settleReview(promise, failureMeta = {}) {
  try {
    return { ok: true, result: await promise };
  } catch (error) {
    return {
      ok: false,
      error,
      failure: buildReviewerFailure({ ...failureMeta, error }),
    };
  }
}

function combineReviewOutcomes({
  primaryOutcome,
  secondOutcome,
  primaryResolved,
  secondResolved,
  secondReviewMode,
}) {
  const detectedNote = secondReviewNote(secondResolved, secondReviewMode);
  if (primaryOutcome.ok && secondOutcome.ok) {
    return {
      result: withReviewNotes(mergeReviewResults(primaryOutcome.result, secondOutcome.result), [detectedNote]),
      resolved: { primary: primaryResolved, second: secondResolved },
    };
  }
  if (primaryOutcome.ok) {
    return {
      result: withReviewerFailures(
        withReviewNotes(primaryOutcome.result, [
          detectedNote,
          `二审模型失败，已降级使用主审模型结果。原因: ${errorMessage(secondOutcome.error)}`,
        ]),
        [secondOutcome.failure],
      ),
      resolved: { primary: primaryResolved, second: secondResolved },
    };
  }
  if (secondOutcome.ok) {
    return {
      result: withReviewerFailures(
        withReviewNotes(secondOutcome.result, [
          detectedNote,
          `主审模型失败，已降级使用二审模型结果。原因: ${errorMessage(primaryOutcome.error)}`,
        ]),
        [primaryOutcome.failure],
      ),
      resolved: { primary: primaryResolved, second: secondResolved },
    };
  }

  return {
    result: {
      verdict: "needs_human",
      summary: "主审模型和二审模型都未返回可用审核结果，需要人工确认。",
      blocking_findings: [],
      warnings: [],
      verification_notes: [
        detectedNote,
        `主审模型失败: ${errorMessage(primaryOutcome.error)}`,
        `二审模型失败: ${errorMessage(secondOutcome.error)}`,
      ],
      reviewer_failures: compactReviewerFailures([
        primaryOutcome.failure,
        secondOutcome.failure,
      ]),
      confidence: 0,
    },
    resolved: { primary: primaryResolved, second: secondResolved },
  };
}

function singleReviewerFailureRun(outcome, primaryResolved) {
  return {
    result: {
      verdict: "needs_human",
      summary: "主审模型未返回可用审核结果，需要人工确认。",
      blocking_findings: [],
      warnings: [],
      verification_notes: [`主审模型失败: ${errorMessage(outcome.error)}`],
      reviewer_failures: compactReviewerFailures([outcome.failure]),
      confidence: 0,
    },
    resolved: { primary: primaryResolved, second: null },
  };
}

function providerResolutionFailureResult(error, fallbackResolved) {
  return {
    verdict: "needs_human",
    summary: "主审模型配置解析失败，未能启动需求理解审核或代码审核，需要人工确认。",
    blocking_findings: [],
    warnings: [],
    verification_notes: [`主审模型配置解析失败: ${errorMessage(error)}`],
    reviewer_failures: [
      buildReviewerFailure({
        phase: "requirement_audit",
        reviewer: "primary",
        resolved: fallbackResolved,
        error,
      }),
    ],
    confidence: 0,
  };
}

function fallbackPrimaryReviewer(options = {}) {
  return {
    provider: renderText(options.provider || process.env.AI_REVIEW_PRIMARY_PROVIDER, "unknown"),
    model: renderText(options.model || process.env.AI_REVIEW_PRIMARY_MODEL, "unknown"),
  };
}

function fallbackSecondReviewer(options = {}) {
  return {
    provider: renderText(options.provider || options.secondProvider || process.env.AI_REVIEW_SECOND_PROVIDER, "unknown"),
    model: renderText(options.model || options.secondModel || process.env.AI_REVIEW_SECOND_MODEL, "unknown"),
  };
}

function withReviewNotes(result, notes = []) {
  const existing = result.verification_notes || [];
  return {
    ...result,
    verification_notes: [...notes.filter(Boolean), ...existing],
  };
}

function withReviewerFailures(result, failures = []) {
  const existing = result.reviewer_failures || [];
  const additions = compactReviewerFailures(failures);
  if (!additions.length) return result;
  return {
    ...result,
    reviewer_failures: [...existing, ...additions],
  };
}

function secondReviewNote(resolved, mode) {
  return `检测到二审模型配置: ${resolved?.provider || "unknown"}/${resolved?.model || "unknown"}，模式: ${mode}。`;
}

function errorMessage(error) {
  return String(error?.message || error || "unknown error");
}

function buildReviewerFailure({ phase, reviewer, resolved, error }) {
  const classified = classifyReviewError(error);
  return {
    phase: renderText(phase, "code_review"),
    reviewer: renderText(reviewer, "unknown"),
    provider: renderText(resolved?.provider, "unknown"),
    model: renderText(resolved?.model, "unknown"),
    category: classified.category,
    retryable: classified.retryable,
    message: classified.message,
    status: classified.status,
    attempts: classified.attempts,
  };
}

function compactReviewerFailures(failures = []) {
  return failures
    .filter((failure) => failure && typeof failure === "object")
    .map((failure) => ({
      phase: renderText(failure.phase, "code_review"),
      reviewer: renderText(failure.reviewer, "unknown"),
      provider: renderText(failure.provider, "unknown"),
      model: renderText(failure.model, "unknown"),
      category: renderText(failure.category, "unknown"),
      retryable: Boolean(failure.retryable),
      message: renderText(failure.message, "unknown error"),
      status: typeof failure.status === "number" ? failure.status : null,
      attempts: Number.isInteger(failure.attempts) && failure.attempts >= 1 ? failure.attempts : null,
    }));
}

export function buildSecondReviewOptions(options, providersConfig) {
  const secondReviewMode = resolveSecondReviewMode(options);
  if (secondReviewMode === "off") {
    return null;
  }

  let inheritedPrimaryBudget = null;
  if (providersConfig) {
    try {
      inheritedPrimaryBudget = resolveProviderOptions(options, providersConfig);
    } catch {
      inheritedPrimaryBudget = null;
    }
  }

  const inheritedTimeoutMs = positiveNumber(
    options.timeoutMs,
    readEnv("AI_REVIEW_TIMEOUT_MS"),
    inheritedPrimaryBudget?.timeoutMs,
    120000,
  );
  const inheritedRetries = nonNegativeInteger(
    options.retries,
    readEnv("AI_REVIEW_RETRIES"),
    inheritedPrimaryBudget?.retries,
    3,
  );
  const inheritedRetryFastFailureMs = positiveNumber(
    options.retryFastFailureMs,
    readEnv("AI_REVIEW_RETRY_FAST_FAILURE_MS"),
    inheritedPrimaryBudget?.retryFastFailureMs,
    10000,
  );
  const inheritedRetryDelayMs = nonNegativeInteger(
    options.retryDelayMs,
    readEnv("AI_REVIEW_RETRY_DELAY_MS"),
    inheritedPrimaryBudget?.retryDelayMs,
    5000,
  );

  const secondConfig = {
    provider: options.secondProvider || readEnv("AI_REVIEW_SECOND_PROVIDER"),
    model: options.secondModel || readEnv("AI_REVIEW_SECOND_MODEL"),
    baseUrl: options.secondBaseUrl || readEnv("AI_REVIEW_SECOND_BASE_URL"),
    apiKey: options.secondApiKey || readEnv("AI_REVIEW_SECOND_API_KEY"),
    apiStyle: options.secondApiStyle || readEnv("AI_REVIEW_SECOND_API_STYLE"),
    transport: options.secondTransport || readEnv("AI_REVIEW_SECOND_TRANSPORT"),
    localCli: options.secondLocalCli || readEnv("AI_REVIEW_SECOND_LOCAL_CLI"),
    localCliArgs: options.secondLocalCliArgs || readEnv("AI_REVIEW_SECOND_LOCAL_CLI_ARGS"),
    cliCommand: options.secondCliCommand || readEnv("AI_REVIEW_SECOND_CLI_COMMAND"),
  };

  if (!isSecondReviewerConfigured(secondConfig)) {
    return null;
  }

  const secondUsesCli = secondReviewerUsesCli(secondConfig, providersConfig);

  return {
    ...options,
    usePrimaryEnv: false,
    secondReviewMode,
    timeoutMs: positiveNumber(options.secondTimeoutMs, readEnv("AI_REVIEW_SECOND_TIMEOUT_MS"), inheritedTimeoutMs),
    retries: nonNegativeInteger(options.secondRetries, readEnv("AI_REVIEW_SECOND_RETRIES"), inheritedRetries),
    retryFastFailureMs: positiveNumber(
      options.secondRetryFastFailureMs,
      readEnv("AI_REVIEW_SECOND_RETRY_FAST_FAILURE_MS"),
      inheritedRetryFastFailureMs,
    ),
    retryDelayMs: nonNegativeInteger(
      options.secondRetryDelayMs,
      readEnv("AI_REVIEW_SECOND_RETRY_DELAY_MS"),
      inheritedRetryDelayMs,
    ),
    provider: secondConfig.provider || secondReviewerCliProvider(secondConfig, options),
    model: secondConfig.model || (secondUsesCli ? undefined : options.model),
    baseUrl: secondConfig.baseUrl || (secondUsesCli ? undefined : options.baseUrl),
    apiKey: secondConfig.apiKey || (secondUsesCli ? undefined : options.apiKey),
    apiStyle: secondConfig.apiStyle || (secondUsesCli ? undefined : options.apiStyle),
    transport: secondConfig.transport || secondReviewerCliTransport(secondConfig, options, secondUsesCli),
    localCli: secondConfig.localCli || (secondUsesCli ? undefined : options.localCli),
    localCliArgs: secondConfig.localCliArgs || (secondUsesCli ? undefined : options.localCliArgs),
    cliCommand: secondConfig.cliCommand || (secondUsesCli ? undefined : options.cliCommand),
  };
}

export function resolveSecondReviewOptions(options, providersConfig) {
  return resolveSecondReviewSetup(options, providersConfig).options;
}

export function resolveSecondReviewSetup(options, providersConfig) {
  const secondOptions = buildSecondReviewOptions(options, providersConfig);
  if (!secondOptions || !providersConfig) {
    return { options: secondOptions, resolved: null, failure: null, error: null };
  }

  try {
    const resolved = resolveProviderOptions(secondOptions, providersConfig);
    assertUsableProviderConfig(resolved);
    return { options: secondOptions, resolved, failure: null, error: null };
  } catch (error) {
    const resolved = fallbackSecondReviewer(secondOptions);
    return {
      options: null,
      resolved,
      failure: buildReviewerFailure({
        phase: "code_review",
        reviewer: "second",
        resolved,
        error,
      }),
      error,
    };
  }
}

export function shouldRunSecondReview(primaryResult, options = {}) {
  const secondReviewMode = resolveSecondReviewMode(options);
  if (secondReviewMode === "off") return false;
  if (secondReviewMode === "always") return true;
  return meetsSecondReviewThreshold(primaryResult, options) || isBelowSecondReviewConfidenceThreshold(primaryResult, options);
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
    config.localCli ||
    config.cliCommand
  );
}

function assertUsableProviderConfig(providerOptions) {
  if (providerOptions.transport === "cli") {
    if (!providerOptions.cliCommand && !providerOptions.localCli) {
      throw new Error(`Missing CLI command for provider "${providerOptions.provider}".`);
    }
    return;
  }
  if (!providerOptions.baseUrl) {
    throw new Error(`Missing base URL for provider "${providerOptions.provider}".`);
  }
  if (!providerOptions.apiKey) {
    throw new Error(`Missing API key for provider "${providerOptions.provider}".`);
  }
}

function secondReviewerCliProvider(config, options = {}) {
  if (config.localCli) return "local-cli";
  if (config.cliCommand) return "cli";
  return config.model ? undefined : options.provider;
}

function secondReviewerCliTransport(config, options = {}, secondUsesCli = secondReviewerUsesCli(config)) {
  if (secondUsesCli) return "cli";
  return options.transport;
}

function secondReviewerUsesCli(config, providersConfig = null) {
  return Boolean(
    config.localCli ||
    config.cliCommand ||
    isCliProviderName(config.provider, providersConfig)
  );
}

function isCliProviderName(providerName, providersConfig = null) {
  if (!providerName || !providersConfig) return false;
  const providers = providersConfig.providers || {};
  const provider = providers[providerName] ||
    Object.values(providers).find((config) => (config.aliases || []).includes(providerName));
  return provider?.transport === "cli";
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

function isBelowSecondReviewConfidenceThreshold(result, options = {}) {
  const confidence = Number(result?.confidence);
  return Number.isFinite(confidence) && confidence < resolveSecondReviewConfidenceThreshold(options);
}

function resolveSecondReviewConfidenceThreshold(options = {}) {
  return numberInRange(
    options.secondConfidenceThreshold,
    readEnv("AI_REVIEW_SECOND_CONFIDENCE_THRESHOLD"),
    0.8,
  );
}

function positiveInteger(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

function nonNegativeInteger(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function positiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

function numberInRange(...values) {
  const fallback = values[values.length - 1];
  for (const value of values.slice(0, -1)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return fallback;
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

async function callReviewModelWithMalformedRetry(reviewOptions, callReviewModelFn = callReviewModel) {
  const retryBudget = resolveReviewerRetryBudget(reviewOptions);
  const attempts = retryBudget.retries + 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      return await callReviewModelFn(reviewOptions);
    } catch (error) {
      lastError = annotateReviewerAttempt(error, attempt);
      const elapsedMs = Date.now() - startedAt;
      if (
        !isMalformedReviewerOutput(error) ||
        attempt >= attempts ||
        elapsedMs > retryBudget.retryFastFailureMs
      ) {
        throw error;
      }
      const waitMs = retryBudget.retryDelayMs;
      process.stderr.write(
        `Reviewer output retry ${attempt}/${attempts - 1} after ${error.message}; failed after ${elapsedMs}ms; waiting ${waitMs}ms\n`,
      );
      if (waitMs > 0) await delay(waitMs);
    }
  }

  throw lastError;
}

function resolveReviewerRetryBudget(reviewOptions = {}) {
  try {
    const resolved = resolveProviderOptions(reviewOptions.options, reviewOptions.providersConfig);
    return {
      retries: nonNegativeInteger(resolved.retries, 3),
      retryFastFailureMs: positiveNumber(resolved.retryFastFailureMs, 10000),
      retryDelayMs: nonNegativeInteger(resolved.retryDelayMs, 5000),
    };
  } catch {
    return {
      retries: 3,
      retryFastFailureMs: 10000,
      retryDelayMs: 5000,
    };
  }
}

function annotateReviewerAttempt(error, attempt) {
  if (error && typeof error === "object") {
    if (!Number.isInteger(error.attempts) || error.attempts < 1) {
      error.attempts = attempt;
    }
  }
  return error;
}

function isMalformedReviewerOutput(error) {
  const message = String(error?.message || "");
  return [
    "Reviewer returned an empty response.",
    "Reviewer response did not contain valid JSON.",
  ].some((prefix) => message.startsWith(prefix));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    reviewer_failures: compactReviewerFailures([
      ...(primary.reviewer_failures || []),
      ...(secondary.reviewer_failures || []),
    ]),
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

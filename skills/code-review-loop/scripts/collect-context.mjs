import { execFile, exec, spawn } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { redactSecrets } from "./redact-secrets.mjs";
import { renderReviewBrief } from "./render-brief.mjs";
import { applyReviewProfile, maxProfileFileBytes, resolveReviewProfile } from "./review-profile.mjs";
import { formatReviewTime } from "./time-format.mjs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const FILE_CONTEXT_CACHE_VERSION = "v2-redact-2026-06-15";
const DEFAULT_MAX_FILE_BYTES = 120000;

export { redactSecrets, renderReviewBrief, getGitRoot };

export function parseArgs(argv) {
  const args = {
    docs: [],
    checklists: [],
    paths: [],
    verifications: [],
    profile: "standard",
    explicitOptions: {},
    maxFiles: 12,
    maxBriefBytes: 600000,
    maxDocBytes: 24000,
    maxFileBytes: 120000,
    maxDiffBytes: 350000,
    codegraphDepth: 5,
    unknownFlags: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--no-requirement-audit-cache") {
      args.noRequirementAuditCache = true;
    } else if (arg === "--request" && next) {
      args.request = next;
      index += 1;
    } else if (arg === "--design" && next) {
      args.design = next;
      index += 1;
    } else if (arg === "--plan" && next) {
      args.plan = next;
      index += 1;
    } else if (arg === "--doc" && next) {
      args.docs.push(next);
      index += 1;
    } else if (arg === "--checklist" && next) {
      args.checklists.push(next);
      index += 1;
    } else if (arg === "--profile" && next) {
      args.profile = next;
      index += 1;
    } else if (arg === "--path" && next) {
      args.paths.push(next);
      index += 1;
    } else if (arg === "--paths" && next) {
      args.paths.push(...splitPathList(next));
      index += 1;
    } else if (arg === "--staged") {
      args.staged = true;
    } else if (arg === "--base" && next) {
      args.base = next;
      index += 1;
    } else if (arg === "--allow-outside-docs") {
      args.allowOutsideDocs = true;
    } else if (arg === "--allow-empty") {
      args.allowEmpty = true;
    } else if (arg === "--verify" && next) {
      args.verifications.push(next);
      index += 1;
    } else if (arg === "--codegraph") {
      args.codegraph = true;
    } else if (arg === "--codegraph-depth" && next) {
      args.codegraphDepth = Number(next);
      index += 1;
    } else if (arg === "--codegraph-command" && next) {
      args.codegraphCommand = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      args.outDir = next;
      index += 1;
    } else if (arg === "--time-zone" && next) {
      args.timeZone = next;
      index += 1;
    } else if (arg === "--history-limit" && next) {
      args.historyLimit = Number(next);
      index += 1;
    } else if (arg === "--provider" && next) {
      args.provider = next;
      index += 1;
    } else if (arg === "--transport" && next) {
      args.transport = next;
      index += 1;
    } else if (arg === "--cli-command" && next) {
      args.cliCommand = next;
      index += 1;
    } else if (arg === "--second-provider" && next) {
      args.secondProvider = next;
      index += 1;
    } else if (arg === "--second-api-key" && next) {
      args.secondApiKey = next;
      index += 1;
    } else if (arg === "--second-model" && next) {
      args.secondModel = next;
      index += 1;
    } else if (arg === "--second-base-url" && next) {
      args.secondBaseUrl = next;
      index += 1;
    } else if (arg === "--second-api-style" && next) {
      args.secondApiStyle = next;
      index += 1;
    } else if (arg === "--second-transport" && next) {
      args.secondTransport = next;
      index += 1;
    } else if (arg === "--second-cli-command" && next) {
      args.secondCliCommand = next;
      index += 1;
    } else if (arg === "--second-review-mode" && next) {
      args.secondReviewMode = next;
      index += 1;
    } else if (arg === "--second-timeout-ms" && next) {
      args.secondTimeoutMs = Number(next);
      args.explicitOptions.secondTimeoutMs = true;
      index += 1;
    } else if (arg === "--second-retries" && next) {
      args.secondRetries = Number(next);
      args.explicitOptions.secondRetries = true;
      index += 1;
    } else if (arg === "--second-confidence-threshold" && next) {
      args.secondConfidenceThreshold = Number(next);
      args.explicitOptions.secondConfidenceThreshold = true;
      index += 1;
    } else if (arg === "--second-p0-threshold" && next) {
      args.secondP0Threshold = Number(next);
      index += 1;
    } else if (arg === "--second-p1-threshold" && next) {
      args.secondP1Threshold = Number(next);
      index += 1;
    } else if (arg === "--second-p2-threshold" && next) {
      args.secondP2Threshold = Number(next);
      index += 1;
    } else if (arg === "--model" && next) {
      args.model = next;
      index += 1;
    } else if (arg === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
    } else if (arg === "--api-style" && next) {
      args.apiStyle = next;
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      args.explicitOptions.timeoutMs = true;
      index += 1;
    } else if (arg === "--retries" && next) {
      args.retries = Number(next);
      args.explicitOptions.retries = true;
      index += 1;
    } else if (arg === "--max-files" && next) {
      args.maxFiles = Number(next);
      args.explicitOptions.maxFiles = true;
      index += 1;
    } else if (arg === "--max-file-bytes" && next) {
      args.maxFileBytes = Number(next);
      args.explicitOptions.maxFileBytes = true;
      index += 1;
    } else if (arg === "--max-brief-bytes" && next) {
      args.maxBriefBytes = Number(next);
      args.explicitOptions.maxBriefBytes = true;
      index += 1;
    } else if (arg === "--max-doc-bytes" && next) {
      args.maxDocBytes = Number(next);
      args.explicitOptions.maxDocBytes = true;
      index += 1;
    } else if (arg === "--max-diff-bytes" && next) {
      args.maxDiffBytes = Number(next);
      args.explicitOptions.maxDiffBytes = true;
      index += 1;
    } else if (arg.startsWith("--")) {
      args.unknownFlags.push(arg);
    }
  }

  if (args.unknownFlags.length > 0) {
    process.stderr.write(
      `警告: 未识别的参数: ${args.unknownFlags.join(", ")}\n`,
    );
  }

  return args;
}

function splitPathList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function collectReviewContext(options = {}) {
  const root = await getGitRoot();
  const scope = resolveReviewScope(root, options);
  const reviewIgnore = await loadReviewIgnore(root);
  const readSnippet = createSnippetReader();
  const [trackedChangedFilesRaw, untrackedFilesRaw, verification] = await Promise.all([
    trackedChangedFileNames(root, scope),
    untrackedFileNames(root, scope),
    runVerifications(root, options.verifications),
  ]);
  const trackedChangedFiles = filterReviewIgnoredFiles(trackedChangedFilesRaw, reviewIgnore);
  const untrackedFiles = filterReviewIgnoredFiles(untrackedFilesRaw, reviewIgnore);
  const changedFiles = mergeFileLists(trackedChangedFiles, untrackedFiles);
  const profileMaxFileBytes = maxProfileFileBytes(options);
  const [untrackedSizeBytes, profileUntrackedDiff, rawDiff] = await Promise.all([
    totalFileSizeBytes(root, untrackedFiles),
    renderUntrackedDiff(root, untrackedFiles, profileMaxFileBytes, readSnippet),
    rawGitDiff(root, scope, trackedChangedFiles),
  ]);
  const combinedDiffForProfile = [rawDiff, profileUntrackedDiff].filter(Boolean).join("\n\n");
  const profile = resolveReviewProfile({
    changedFiles,
    diff: combinedDiffForProfile,
    diffBytesHint: untrackedSizeBytes,
    options,
    verification,
  });
  applyReviewProfile(options, profile);
  const changedPathspec = toPathspec(changedFiles);
  const trackedChangedPathspec = toPathspec(trackedChangedFiles);
  const untrackedDiffPromise = options.maxFileBytes === profileMaxFileBytes
    ? Promise.resolve(profileUntrackedDiff)
    : renderUntrackedDiff(root, untrackedFiles, options.maxFileBytes, readSnippet);

  const [untrackedDiff, status, diffStat, projectRules, docs, fileContexts, codegraphContext] = await Promise.all([
    untrackedDiffPromise,
    scopedGitStatus(root, changedPathspec),
    scopedGitDiffStat(root, scope, trackedChangedPathspec),
    readIfExists(path.join(root, "AGENTS.md")),
    readDocs(root, options),
    readChangedFileContexts(root, changedFiles, options, readSnippet),
    collectCodeGraphContext(root, changedFiles, options),
  ]);
  const finalCombinedDiff = [rawDiff, untrackedDiff].filter(Boolean).join("\n\n");
  const diff = limitGitDiff(finalCombinedDiff, options.maxDiffBytes);

  return {
    root,
    generatedAt: formatReviewTime(new Date(), options),
    scope,
    profile,
    maxBriefBytes: options.maxBriefBytes,
    status,
    diffStat,
    diff,
    changedFiles,
    projectRules,
    docs,
    fileContexts,
    codegraphContext,
    verification,
  };
}

async function getGitRoot() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

function resolveReviewScope(root, options = {}) {
  const base = options.base || "HEAD";
  const paths = normalizeReviewPaths(root, options.paths || []);
  const shouldExcludeReviewArtifacts = !paths.some(isReviewArtifactPath);
  const pathspecPaths = paths.length ? paths : ["."];
  const pathspec = [
    "--",
    ...pathspecPaths,
    ...(shouldExcludeReviewArtifacts ? [":(exclude).ai-review/**"] : []),
  ];
  const diffCommand = options.staged
    ? ["diff", "--cached", "--no-ext-diff", "--unified=80"]
    : ["diff", "--no-ext-diff", "--unified=80", base];

  return {
    base,
    staged: Boolean(options.staged),
    paths,
    pathspec,
    diffCommand,
  };
}

function normalizeReviewPaths(root, paths) {
  return paths
    .map((rawPath) => {
      const trimmed = String(rawPath || "").trim();
      if (!trimmed) return "";
      if (trimmed.startsWith(":(")) {
        throw new Error(`审核路径不支持 git pathspec 语法: ${trimmed}`);
      }
      const resolved = path.resolve(root, trimmed);
      if (!isPathInsideOrSame(root, resolved)) {
        throw new Error(`审核路径必须位于仓库内: ${trimmed}`);
      }
      return path.relative(root, resolved).replace(/\\/g, "/") || ".";
    })
    .filter((item, index, items) => item && items.indexOf(item) === index);
}

function isReviewArtifactPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === ".ai-review" || normalized.startsWith(".ai-review/");
}

async function git(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 20,
    });
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (error) {
    return String(error.stderr || error.message || error);
  }
}

function limitGitDiff(diff, maxBytes = 350000) {
  return limitText(redactSecrets(diff), maxBytes, "\n\n[Diff 已被 code-review-loop 截断。如需更完整内容，请调大 --max-diff-bytes。]");
}

async function trackedChangedFileNames(root, scope) {
  const trackedCommand = scope.staged
    ? ["diff", "--name-only", "--cached", ...scope.pathspec]
    : ["diff", "--name-only", scope.base, ...scope.pathspec];
  const trackedOutput = await git(trackedCommand, root);

  return trackedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("warning:"))
    .filter((file, index, files) => files.indexOf(file) === index);
}

async function untrackedFileNames(root, scope) {
  if (scope.staged) return [];
  const output = await git(["ls-files", "--others", "--exclude-standard", ...scope.pathspec], root);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("warning:"))
    .filter((file, index, files) => files.indexOf(file) === index);
}

async function renderUntrackedDiff(root, untrackedFiles, maxFileBytes, readSnippet = readTextFileSnippet) {
  const blocks = [];
  for (const file of untrackedFiles) {
    const resolved = path.resolve(root, file);
    if (!isPathInside(root, resolved)) continue;
    if (isSecretPath(file)) {
      blocks.push(renderAddedFileDiff(file, "[疑似密钥文件已省略]"));
      continue;
    }
    const content = await readSnippet(resolved, maxFileBytes);
    if (content) blocks.push(renderAddedFileDiff(file, redactSecrets(content)));
  }
  return blocks.join("\n\n");
}

function mergeFileLists(...lists) {
  return lists
    .flatMap((files) => files || [])
    .filter((file, index, files) => file && files.indexOf(file) === index);
}

function toPathspec(files = []) {
  if (!files.length) return [];
  return ["--", ...files];
}

async function scopedGitStatus(root, pathspec) {
  if (!pathspec.length) return "";
  return git(["status", "--short", ...pathspec], root);
}

async function scopedGitDiffStat(root, scope, pathspec) {
  if (!pathspec.length) return "";
  return git([...scope.diffCommand, "--stat", ...pathspec], root);
}

async function rawGitDiff(root, scope, files) {
  const pathspec = toPathspec(files);
  if (!pathspec.length) return "";
  return git([...scope.diffCommand, ...pathspec], root);
}

async function totalFileSizeBytes(root, files) {
  let total = 0;
  for (const file of files) {
    const resolved = path.resolve(root, file);
    if (!isPathInside(root, resolved) || isSecretPath(file)) continue;
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) total += stat.size;
    } catch {
      // ignore files that disappeared while collecting context
    }
  }
  return total;
}

function renderAddedFileDiff(file, content) {
  const lines = String(content).split(/\r?\n/);
  const body = lines
    .map((line) => `+${line}`)
    .join("\n");
  return `diff --git a/${file} b/${file}
new file mode 100644
--- /dev/null
+++ b/${file}
@@ -0,0 +1,${lines.length} @@
${body}`;
}

async function readDocs(root, options) {
  const checklistDocs = Array.isArray(options.checklists) ? options.checklists : [];
  const extraDocs = Array.isArray(options.docs) ? options.docs : [];
  const docs = [
    ["用户需求", options.request || ".ai-review/review-context/current-request.md"],
    ["已接受设计", options.design || ".ai-review/review-context/current-design.md"],
    ["实现计划", options.plan || ".ai-review/review-context/current-plan.md"],
    ...checklistDocs.map((docPath, index) => [`审核清单 ${index + 1}`, docPath]),
    ...extraDocs.map((docPath, index) => [`额外文档 ${index + 1}`, docPath]),
  ].filter(([, docPath]) => docPath);

  const results = [];
  const maxDocBytes = Number.isFinite(options.maxDocBytes) ? options.maxDocBytes : 24000;
  for (const [label, docPath] of docs) {
    const resolved = path.resolve(root, docPath);
    if (!options.allowOutsideDocs && !isPathInsideOrSame(root, resolved)) {
      results.push({
        label,
        path: docPath,
        content: "[仓库外文档已省略；如确需包含，请显式传入 --allow-outside-docs]",
      });
      continue;
    }
    if (!(await fileExists(resolved))) continue;
    const contentFingerprint = await fileContentFingerprint(resolved);
    results.push({
      label,
      path: path.relative(root, resolved),
      contentHash: contentFingerprint.hash,
      contentBytes: contentFingerprint.bytes,
      content: await readTextFileSnippet(resolved, maxDocBytes),
    });
  }
  return results;
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readChangedFileContexts(root, changedFiles, options, readSnippet = readTextFileSnippet) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 12;
  const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  const cacheDir = path.join(root, ".ai-review", "cache");
  const cache = await loadFileContextCache(cacheDir);
  const contextItems = await mapWithConcurrency(changedFiles.slice(0, maxFiles), 6, async (changedFile) => {
    if (isSecretPath(changedFile)) {
      return { path: changedFile, content: "[疑似密钥文件已省略]" };
    }

    const resolved = path.resolve(root, changedFile);
    if (!isPathInside(root, resolved)) return null;

    let mtime = 0;
    try {
      const stat = await fs.stat(resolved);
      mtime = stat.mtimeMs;
    } catch {
      // file may have been deleted
    }

    const cacheKey = `${FILE_CONTEXT_CACHE_VERSION}::${changedFile}::${mtime}::${maxFileBytes}`;
    if (cache[cacheKey] !== undefined) {
      return { path: changedFile, content: cache[cacheKey] };
    }

    const content = await readSnippet(resolved, maxFileBytes);
    if (content) {
      const redacted = redactSecrets(content);
      cache[cacheKey] = redacted;
      return { path: changedFile, content: redacted };
    }
    return null;
  });
  const contexts = contextItems.filter(Boolean);

  if (changedFiles.length > maxFiles) {
    contexts.push({
      path: "[truncated]",
      content: `${changedFiles.length - maxFiles} 个变更文件已被 --max-files 省略。`,
    });
  }

  await saveFileContextCache(cacheDir, cache);
  return contexts;
}

function createSnippetReader() {
  const snippets = new Map();

  return async function readSnippet(filePath, maxBytes) {
    const normalizedMaxBytes = Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_FILE_BYTES;
    const cacheKey = path.resolve(filePath);
    const cached = snippets.get(cacheKey);
    if (cached && cached.maxBytes >= normalizedMaxBytes) {
      return limitText(cached.content, normalizedMaxBytes, "\n\n[文件上下文已截断。]");
    }

    const content = await readTextFileSnippet(filePath, normalizedMaxBytes);
    snippets.set(cacheKey, { maxBytes: normalizedMaxBytes, content });
    return content;
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

async function loadReviewIgnore(root) {
  const ignorePath = path.join(root, ".ai-reviewignore");
  const content = await readIfExists(ignorePath);
  if (!content.trim()) return [];
  return content
    .split(/\r?\n/)
    .map(parseReviewIgnoreRule)
    .filter(Boolean);
}

function parseReviewIgnoreRule(line) {
  let pattern = String(line || "").trim();
  if (!pattern) return null;
  const escapedLeading = pattern.startsWith("\\#") || pattern.startsWith("\\!");
  if (escapedLeading) {
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("#")) {
    return null;
  }

  let negated = false;
  if (!escapedLeading && pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1).trim();
  }

  if (!pattern) return null;
  const directoryOnly = pattern.endsWith("/");
  const normalizedPattern = normalizeIgnorePattern(pattern.replace(/\/+$/, ""));
  if (!normalizedPattern) return null;

  return {
    negated,
    matcher: compileReviewIgnorePattern(normalizedPattern, { directoryOnly }),
  };
}

function normalizeIgnorePattern(pattern) {
  return String(pattern || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

function compileReviewIgnorePattern(pattern, { directoryOnly = false } = {}) {
  const anchored = pattern.startsWith("/");
  const unanchoredPattern = anchored ? pattern.slice(1) : pattern;
  const hasSlash = unanchoredPattern.includes("/");

  if (!hasSlash) {
    const basenameRegex = globToRegexSource(unanchoredPattern);
    if (anchored) {
      if (directoryOnly) {
        return new RegExp(`^${basenameRegex}(?:/.*)?$`);
      }
      return new RegExp(`^${basenameRegex}(?:$|/.*)`);
    }
    if (directoryOnly) {
      return new RegExp(`(?:^|/)${basenameRegex}(?:/.*)?$`);
    }
    return new RegExp(`(?:^|/)${basenameRegex}(?:$|/.*)`);
  }

  const body = globToRegexSource(unanchoredPattern);
  if (directoryOnly) {
    return new RegExp(`^${body}(?:/.*)?$`);
  }
  return new RegExp(`^${body}(?:$|/.*)`);
}

function globToRegexSource(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*") {
      if (next === "*") {
        const afterNext = pattern[index + 2];
        if (afterNext === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegexChar(char);
  }
  return source;
}

function escapeRegexChar(char) {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function filterReviewIgnoredFiles(files, rules) {
  if (!rules.length) return files;
  return files.filter((filePath) => !isReviewIgnored(filePath, rules));
}

function isReviewIgnored(filePath, rules) {
  const normalizedPath = String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  let ignored = false;
  for (const rule of rules) {
    if (!rule.matcher.test(normalizedPath)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

async function collectCodeGraphContext(root, changedFiles, options) {
  if (!options.codegraph) return null;

  const command = options.codegraphCommand || defaultCodeGraphCommand();
  const depth = Number.isFinite(options.codegraphDepth) ? options.codegraphDepth : 5;
  const files = changedFiles
    .filter((file) => !isReviewArtifactPath(file))
    .filter((file) => !isSecretPath(file));

  const status = await runCodeGraph(command, ["status", "-j", root], root);
  const statusJson = parseJsonOutput(status.stdout);
  const hasStatusJson = statusJson && typeof statusJson === "object" && !Array.isArray(statusJson);
  const initialized = Boolean(status.exitCode === 0 && hasStatusJson && statusJson.initialized !== false);
  let affected = null;

  if (initialized && files.length > 0) {
    affected = await runCodeGraph(
      command,
      ["affected", "-p", root, "-d", String(depth), "-j", "--", ...files],
      root,
    );
  }

  return {
    command,
    depth,
    files,
    status,
    statusJson,
    initialized,
    affected,
  };
}

function defaultCodeGraphCommand() {
  return process.platform === "win32" ? "codegraph.cmd" : "codegraph";
}

async function runCodeGraph(command, args, cwd) {
  const invocation = buildCodeGraphInvocation(command, args);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: invocation.display,
        exitCode: 1,
        stdout: stdout.trim(),
        stderr: String(error.message || error).trim(),
        timedOut,
      });
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: invocation.display,
        exitCode: timedOut ? 124 : exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}

function buildCodeGraphInvocation(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const innerCommandLine = [command, ...args].map(quoteCmdArg).join(" ");
    const commandLine = `"${innerCommandLine}"`;
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
      display: commandLine,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command,
    args,
    display: [command, ...args].map(quoteDisplayArg).join(" "),
    windowsVerbatimArguments: false,
  };
}

function quoteCmdArg(value) {
  const text = String(value).replace(/%/g, "%%");
  if (!/[\s&()^|<>"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function quoteDisplayArg(value) {
  const text = String(value);
  if (!/\s/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function loadFileContextCache(cacheDir) {
  const cachePath = path.join(cacheDir, "file-contexts.json");
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => key.startsWith(`${FILE_CONTEXT_CACHE_VERSION}::`)),
    );
  } catch {
    return {};
  }
}

async function saveFileContextCache(cacheDir, cache) {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const entries = Object.entries(cache);
    if (entries.length > 200) {
      const sorted = entries.sort((a, b) => {
        const aMtime = cacheKeyMtime(a[0]);
        const bMtime = cacheKeyMtime(b[0]);
        return bMtime - aMtime;
      });
      const kept = Object.fromEntries(sorted.slice(0, 200));
      await fs.writeFile(path.join(cacheDir, "file-contexts.json"), JSON.stringify(kept), "utf8");
    } else {
      await fs.writeFile(path.join(cacheDir, "file-contexts.json"), JSON.stringify(cache), "utf8");
    }
  } catch {
    // cache write failure is non-fatal
  }
}

function cacheKeyMtime(cacheKey) {
  const parts = String(cacheKey || "").split("::");
  return Number(parts.at(-2)) || 0;
}

function isSecretPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() || "";
  if (/\.(example|sample|template|dist|tpl)$/.test(basename)) return false;
  if (/(^|\/)\.env($|\.|\/)/.test(normalized)) return true;
  return /\.(pem|key|crt|pfx|p12|der|cer|jks|keystore|truststore)$/.test(normalized)
    || /(^|\/)(id_rsa|id_ecdsa|id_ed25519|id_dsa|credentials\.json|service-account\.json|\.netrc|\.npmrc)(\/|$)/.test(normalized);
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isPathInsideOrSame(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readTextFileSnippet(filePath, maxBytes) {
  let fd;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return "";

    fd = await fs.open(filePath, "r");
    const probeSize = Math.min(4096, stat.size);
    const probeBuf = Buffer.alloc(probeSize);
    await fd.read(probeBuf, 0, probeSize, 0);
    if (probeBuf.includes(0)) return "[binary file omitted]";

    const readSize = Math.min(maxBytes + 8192, stat.size);
    const buf = Buffer.alloc(readSize);
    const { bytesRead } = await fd.read(buf, 0, readSize, 0);
    const sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) return "[binary file omitted]";
    return limitText(sample.toString("utf8"), maxBytes, "\n\n[文件上下文已截断。]");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try { await fd.close(); } catch { /* ignore */ }
    }
  }
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fileContentFingerprint(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { hash: "", bytes: 0 };

    const hash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    return { hash: hash.digest("hex"), bytes: stat.size };
  } catch {
    return { hash: "", bytes: 0 };
  }
}

async function runVerifications(root, commands = []) {
  if (!commands.length) return null;

  const results = [];
  for (const command of commands) {
    results.push(await runVerification(root, command));
  }
  return results;
}

async function runVerification(root, command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: root,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });
    return { command, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      command,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || error.message || "").trim(),
    };
  }
}

function limitText(text, maxBytes, suffix) {
  const buffer = Buffer.from(text || "", "utf8");
  if (buffer.length <= maxBytes) return text || "";
  return Buffer.concat([buffer.subarray(0, maxBytes), Buffer.from(suffix, "utf8")]).toString("utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const context = await collectReviewContext(options);
  process.stdout.write(renderReviewBrief(context));
}

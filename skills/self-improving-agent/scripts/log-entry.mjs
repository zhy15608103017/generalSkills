#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, "..");
const assetDir = path.join(skillDir, "assets");

const ENTRY_TYPES = new Set(["learning", "error", "feature"]);
const TYPE_CONFIG = {
  learning: {
    prefix: "LRN",
    file: "LEARNINGS.md",
    asset: "LEARNINGS.md"
  },
  error: {
    prefix: "ERR",
    file: "ERRORS.md",
    asset: "ERRORS.md"
  },
  feature: {
    prefix: "FEAT",
    file: "FEATURE_REQUESTS.md",
    asset: "FEATURE_REQUESTS.md"
  }
};

export async function logEntry(argv = process.argv.slice(2)) {
  const { type, options } = parseArgs(argv);
  if (type === "review") {
    return reviewEntries(options);
  }

  if (!ENTRY_TYPES.has(type)) {
    throw new Error(`Entry type must be one of: ${[...ENTRY_TYPES].join(", ")}.`);
  }

  const root = path.resolve(options.root || process.cwd());
  const now = new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --now value: ${options.now}`);
  }

  await ensureLearningsDir(root);

  if (type === "learning" && options.patternKey) {
    const updated = await updateExistingLearning(root, options, now);
    if (updated) return updated;
  }

  const config = TYPE_CONFIG[type];
  const filePath = path.join(root, ".learnings", config.file);
  const text = await readUtf8File(filePath);
  const id = buildId(config.prefix, now, options.idSuffix || nextSuffix(text, config.prefix, now));
  const entry = renderEntry(type, id, options, now);
  await writeFile(filePath, appendBlock(text, entry), "utf8");

  const result = {
    action: "logged",
    id,
    file: filePath
  };
  console.log(`Logged ${id} to ${path.relative(root, filePath).replace(/\\/g, "/")}`);
  return result;
}

async function reviewEntries(options) {
  const root = path.resolve(options.root || process.cwd());
  await ensureLearningsDir(root);

  const entries = [];
  for (const config of Object.values(TYPE_CONFIG)) {
    const filePath = path.join(root, ".learnings", config.file);
    const text = await readUtf8File(filePath);
    entries.push(
      ...parseEntries(text).map((entry) => ({
        ...entry,
        file: config.file
      }))
    );
  }

  const filtered = entries.filter((entry) => entryMatchesFilters(entry, options));
  if (filtered.length === 0) {
    console.log("No matching .learnings entries.");
    return {
      action: "reviewed",
      count: 0,
      entries: []
    };
  }

  for (const entry of filtered) {
    const pattern = entry.patternKey ? ` Pattern-Key=${entry.patternKey}` : "";
    console.log(
      `${entry.id} ${entry.file} Priority=${entry.priority || "unknown"} Status=${
        entry.status || "unknown"
      } Area=${entry.area || "unknown"}${pattern} :: ${entry.summary || entry.heading}`
    );
  }

  return {
    action: "reviewed",
    count: filtered.length,
    entries: filtered
  };
}

function parseArgs(argv) {
  const [type, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = toCamelCase(rawKey);
    if (inlineValue !== undefined && inlineValue !== "") {
      options[key] = inlineValue;
      continue;
    }

    const next = rest[index + 1];
    if (!next) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return {
    type,
    options
  };
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function ensureLearningsDir(root) {
  const learningsDir = path.join(root, ".learnings");
  await mkdir(learningsDir, { recursive: true });

  for (const config of Object.values(TYPE_CONFIG)) {
    const target = path.join(learningsDir, config.file);
    if (await pathExists(target)) continue;

    const template = await readFile(path.join(assetDir, config.asset), "utf8");
    await writeFile(target, normalizeTrailingNewline(template), "utf8");
  }
}

async function pathExists(filePath) {
  try {
    await readUtf8File(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readUtf8File(filePath) {
  const buffer = await readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${filePath} is not valid UTF-8. Stop before writing or repair it manually.`);
  }
}

async function updateExistingLearning(root, options, now) {
  const filePath = path.join(root, ".learnings", TYPE_CONFIG.learning.file);
  const text = await readUtf8File(filePath);
  const existing = findLearningBlockByPatternKey(text, options.patternKey);
  if (!existing) return null;

  const { id } = existing;
  let block = existing.block;
  block = replaceOrAppendMetadata(block, "Recurrence-Count", (value) =>
    String((Number.parseInt(value, 10) || 1) + 1)
  );
  block = replaceOrAppendMetadata(block, "Last-Seen", () => dateStamp(now));
  if (!hasMetadataField(block, "First-Seen")) {
    block = replaceOrAppendMetadata(block, "First-Seen", () => dateStamp(now));
  }

  await writeFile(
    filePath,
    `${text.slice(0, existing.start)}${block}${text.slice(existing.end)}`,
    "utf8"
  );

  const result = {
    action: "updated",
    id,
    file: filePath
  };
  console.log(`Updated ${id} recurrence in ${path.relative(root, filePath).replace(/\\/g, "/")}`);
  return result;
}

function findLearningBlockByPatternKey(text, patternKey) {
  const entries = parseEntries(text).filter((entry) => entry.id.startsWith("LRN-"));
  return entries.find((entry) => entry.patternKey === patternKey) || null;
}

function parseEntries(text) {
  const lines = text.split(/(?<=\n)/);
  let inFence = false;
  let current = null;
  let offset = 0;
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    }

    const heading = !inFence && line.match(/^## \[((?:LRN|ERR|FEAT)-\d{8}-[A-Za-z0-9]+)\]\s*(.*)/);
    if (heading) {
      if (current) {
        entries.push(enrichEntry(current));
      }
      current = {
        id: heading[1],
        heading: heading[2].trim(),
        start: offset,
        end: offset + line.length,
        block: line
      };
    } else if (current) {
      current.end = offset + line.length;
      current.block += line;
    }

    offset += line.length;
  }

  if (current) {
    entries.push(enrichEntry(current));
  }
  return entries;
}

function enrichEntry(entry) {
  return {
    ...entry,
    priority: matchField(entry.block, "Priority"),
    status: matchField(entry.block, "Status"),
    area: matchField(entry.block, "Area"),
    patternKey: matchMetadata(entry.block, "Pattern-Key"),
    summary: firstSectionLine(entry.block, "Summary") || firstSectionLine(entry.block, "Requested Capability")
  };
}

function entryMatchesFilters(entry, options) {
  if (options.status && entry.status !== options.status) return false;
  if (options.priority && entry.priority !== options.priority) return false;
  if (options.area && entry.area !== options.area) return false;
  if (options.patternKey && entry.patternKey !== options.patternKey) return false;
  return true;
}

function matchField(block, name) {
  const match = outsideFenceText(block).match(
    new RegExp(`^\\*\\*${escapeRegExp(name)}\\*\\*: (.*)$`, "m")
  );
  return match?.[1]?.trim() || "";
}

function matchMetadata(block, name) {
  const match = outsideFenceText(block).match(
    new RegExp(`^- ${escapeRegExp(name)}: (.*)$`, "m")
  );
  return match?.[1]?.trim() || "";
}

function firstSectionLine(block, sectionName) {
  const lines = block.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `### ${sectionName}`);
  if (index === -1) return "";
  for (const line of lines.slice(index + 1)) {
    if (line.startsWith("### ")) return "";
    if (line.trim()) return line.trim();
  }
  return "";
}

function outsideFenceText(text) {
  const kept = [];
  let inFence = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

function replaceOrAppendMetadata(block, key, nextValue) {
  const lines = block.split(/(?<=\n)/);
  let inFence = false;
  let inMetadata = false;
  let metadataIndex = -1;
  const pattern = new RegExp(`^- ${escapeRegExp(key)}: (.*?)(\\r?\\n)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && trimmed === "### Metadata") {
      inMetadata = true;
      metadataIndex = index;
      continue;
    }
    if (!inFence && inMetadata && trimmed.startsWith("### ")) {
      inMetadata = false;
    }
    if (!inFence && inMetadata) {
      const match = line.match(pattern);
      if (match) {
        lines[index] = `- ${key}: ${nextValue(match[1])}${match[2] || ""}`;
        return lines.join("");
      }
    }
  }

  if (metadataIndex === -1) {
    return `${block.trimEnd()}\n\n### Metadata\n- ${key}: ${nextValue("")}\n`;
  }

  const insertIndex = findMetadataInsertIndex(lines, metadataIndex);
  lines.splice(insertIndex, 0, `- ${key}: ${nextValue("")}\n`);
  return lines.join("");
}

function hasMetadataField(block, key) {
  const lines = block.split(/(?<=\n)/);
  let inFence = false;
  let inMetadata = false;
  const pattern = new RegExp(`^- ${escapeRegExp(key)}: `);

  for (const line of lines) {
    const trimmed = line.trim();
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && trimmed === "### Metadata") {
      inMetadata = true;
      continue;
    }
    if (!inFence && inMetadata && trimmed.startsWith("### ")) {
      inMetadata = false;
    }
    if (!inFence && inMetadata && pattern.test(line)) {
      return true;
    }
  }

  return false;
}

function findMetadataInsertIndex(lines, metadataIndex) {
  let inFence = false;
  for (let index = metadataIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && line.trim() === "---") return index;
    if (!inFence && line.trim().startsWith("### ")) return index;
  }
  return lines.length;
}

function renderEntry(type, id, options, now) {
  if (type === "learning") return renderLearning(id, options, now);
  if (type === "error") return renderError(id, options, now);
  return renderFeature(id, options, now);
}

function renderLearning(id, options, now) {
  const category = sanitizeText(requireOption(options, "category"));
  const summary = requireOption(options, "summary");
  const details = requireOption(options, "details");
  const action = requireOption(options, "action");
  const metadata = [
    `- Source: ${safeOption(options, "source", "investigation")}`,
    `- Related Files: ${safeOption(options, "relatedFiles", "N/A")}`,
    `- Tags: ${safeOption(options, "tags", "N/A")}`,
    `- See Also: ${safeOption(options, "seeAlso", "N/A")}`,
    `- Pattern-Key: ${safeOption(options, "patternKey", "N/A")}`,
    "- Recurrence-Count: 1",
    `- First-Seen: ${dateStamp(now)}`,
    `- Last-Seen: ${dateStamp(now)}`
  ];

  return [
    `## [${id}] ${category}`,
    "",
    `**Logged**: ${isoStamp(now)}`,
    `**Priority**: ${safeOption(options, "priority", "medium")}`,
    "**Status**: pending",
    `**Area**: ${safeOption(options, "area", "general")}`,
    "",
    "### Summary",
    sanitizeText(summary),
    "",
    "### Details",
    sanitizeText(details),
    "",
    "### Suggested Action",
    sanitizeText(action),
    "",
    "### Metadata",
    ...metadata,
    "",
    "---"
  ].join("\n");
}

function renderError(id, options, now) {
  const tool = safeOption(options, "tool", "command_or_tool_name");
  const summary = requireOption(options, "summary");
  const error = requireOption(options, "error");

  return [
    `## [${id}] ${tool}`,
    "",
    `**Logged**: ${isoStamp(now)}`,
    `**Priority**: ${safeOption(options, "priority", "medium")}`,
    "**Status**: pending",
    `**Area**: ${safeOption(options, "area", "general")}`,
    "",
    "### Summary",
    sanitizeText(summary),
    "",
    "### Error",
    "```text",
    sanitizeText(error),
    "```",
    "",
    "### Context",
    `- Command/operation attempted: ${sanitizeText(options.command || "N/A")}`,
    `- Input or parameters: ${sanitizeText(options.input || "N/A")}`,
    `- Environment details: ${sanitizeText(options.environment || "N/A")}`,
    "",
    "### Suggested Fix",
    sanitizeText(options.fix || "Unknown; investigate before retrying."),
    "",
    "### Metadata",
    `- Reproducible: ${safeOption(options, "reproducible", "unknown")}`,
    `- Related Files: ${safeOption(options, "relatedFiles", "N/A")}`,
    `- See Also: ${safeOption(options, "seeAlso", "N/A")}`,
    "",
    "---"
  ].join("\n");
}

function renderFeature(id, options, now) {
  const capability = safeOption(options, "capability", options.summary || "capability_name");
  const requested = requireOption(options, "requested");
  const context = requireOption(options, "context");

  return [
    `## [${id}] ${slugify(capability)}`,
    "",
    `**Logged**: ${isoStamp(now)}`,
    `**Priority**: ${safeOption(options, "priority", "medium")}`,
    "**Status**: pending",
    `**Area**: ${safeOption(options, "area", "general")}`,
    "",
    "### Requested Capability",
    sanitizeText(requested),
    "",
    "### User Context",
    sanitizeText(context),
    "",
    "### Complexity Estimate",
    safeOption(options, "complexity", "medium"),
    "",
    "### Suggested Implementation",
    sanitizeText(options.implementation || "Needs design before implementation."),
    "",
    "### Metadata",
    `- Frequency: ${safeOption(options, "frequency", "first_time")}`,
    `- Related Features: ${safeOption(options, "relatedFeatures", "N/A")}`,
    "",
    "---"
  ].join("\n");
}

function requireOption(options, key) {
  const value = options[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key.replace(/[A-Z]/g, "-$&").toLowerCase()} option.`);
  }
  return value;
}

function safeOption(options, key, fallback) {
  const value = options[key];
  return sanitizeText(value && value !== true ? value : fallback);
}

function sanitizeText(value) {
  return stripTerminalControls(String(value ?? ""))
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|token|secret|password)=\S+/gi, "$1=[REDACTED]")
    .replace(
      /(["']?\b(?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*:\s*["']?)([^\s"',}]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

function stripTerminalControls(value) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r(?!\n)/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function buildId(prefix, now, suffix) {
  return `${prefix}-${dateStamp(now).replaceAll("-", "")}-${suffix}`;
}

function nextSuffix(text, prefix, now) {
  const date = dateStamp(now).replaceAll("-", "");
  const matches = [...text.matchAll(new RegExp(`\\[${prefix}-${date}-(\\d{3})\\]`, "g"))];
  const next =
    matches.reduce((max, match) => Math.max(max, Number.parseInt(match[1], 10)), 0) + 1;
  return String(next).padStart(3, "0");
}

function dateStamp(now) {
  return now.toISOString().slice(0, 10);
}

function isoStamp(now) {
  return now.toISOString().replace(".000Z", "Z");
}

function appendBlock(text, block) {
  return `${text.trimEnd()}\n\n${block}\n`;
}

function normalizeTrailingNewline(text) {
  return `${text.trimEnd()}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function printUsage() {
  console.error(`Usage:
  node scripts/log-entry.mjs learning --summary <text> --details <text> --action <text> [options]
  node scripts/log-entry.mjs error --summary <text> --error <text> [options]
  node scripts/log-entry.mjs feature --requested <text> --context <text> [options]
  node scripts/log-entry.mjs review [--status pending] [--priority high] [--pattern-key key]

Common options:
  --root <path>             Project root. Defaults to current directory.
  --now <iso timestamp>     Override timestamp for deterministic tests.
  --id-suffix <suffix>      Override entry suffix, for example 001 or A7B.
  --priority <level>        low | medium | high | critical.
  --area <area>             frontend | backend | infra | tests | docs | config | tooling | general.
`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  logEntry().catch((error) => {
    printUsage();
    console.error(error.message);
    process.exitCode = 1;
  });
}

import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const INSTRUCTIONS = [
  "## AI Code Review",
  "",
  "For feature, bug fix, refactor, or other code-bearing local changes, use the `code-review-loop` skill before reporting completion. Skip docs-only, formatting-only, comments-only, typo-only, lockfile-only, generated-output, `.ai-review/` artifact, and plain dependency-version-only changes. Fix blocking `P0/P1` findings or report review setup failure."
].join("\n");
const REVIEW_IGNORE_ENTRY = ".ai-review";
const REVIEW_SCOPE_IGNORE_ENTRY = ".ai-reviewignore";
const ENV_TEMPLATE_FILE = path.join("assets", "env-template.env");
const ENV_TEMPLATE_START = "# gskills:code-review-loop env:start";
const ENV_TEMPLATE_END = "# gskills:code-review-loop env:end";

export async function install(context) {
  await upsertAgentsBlock(context.destDir, context.skillName, INSTRUCTIONS);
  await ensureEnvTemplate(context.destDir, context.skillDir);
  await removeInstalledAssets(context.targets || []);
  await ensureGitignoreEntry(context.destDir, REVIEW_IGNORE_ENTRY);
  await ensureGitignoreEntry(context.destDir, REVIEW_SCOPE_IGNORE_ENTRY);
  await ensureReviewIgnoreFile(context.destDir);
}

async function upsertAgentsBlock(destDir, skillName, instructions) {
  const agentsPath = path.join(destDir, "AGENTS.md");
  const existingText = await readTextIfExists(agentsPath);
  const updatedText = upsertBlock(existingText, skillName, instructions.trim());

  await mkdir(path.dirname(agentsPath), { recursive: true });
  await writeFile(agentsPath, updatedText, "utf8");
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function ensureGitignoreEntry(destDir, entry) {
  const gitignorePath = path.join(destDir, ".gitignore");
  const existingText = await readTextIfExists(gitignorePath);
  const updatedText = appendLineIfMissing(existingText, entry);

  await mkdir(path.dirname(gitignorePath), { recursive: true });
  await writeFile(gitignorePath, updatedText, "utf8");
}

async function ensureReviewIgnoreFile(destDir) {
  const reviewIgnorePath = path.join(destDir, REVIEW_SCOPE_IGNORE_ENTRY);
  const existingText = await readTextIfExists(reviewIgnorePath);
  if (existingText !== "") return;

  await mkdir(path.dirname(reviewIgnorePath), { recursive: true });
  await writeFile(reviewIgnorePath, "", "utf8");
}

async function ensureEnvTemplate(destDir, skillDir) {
  const envPath = path.join(destDir, ".env");
  const existingText = await readTextIfExists(envPath);
  const template = await readEnvTemplate(skillDir);
  if (hasEnvTemplate(existingText, template)) return;

  const updatedText = appendEnvTemplate(existingText, template);

  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, updatedText, "utf8");
}

async function removeInstalledAssets(targets) {
  for (const target of targets) {
    await rm(path.join(target.installedPath, "assets"), { recursive: true, force: true });
  }
}

async function readEnvTemplate(skillDir) {
  const templatePath = path.join(skillDir, ENV_TEMPLATE_FILE);
  const templateText = await readTextIfExists(templatePath);
  if (!templateText) {
    throw new Error(`code-review-loop: missing ${ENV_TEMPLATE_FILE} template.`);
  }

  return sanitizeEnvTemplate(stripEnvTemplateMarkers(templateText));
}

function stripEnvTemplateMarkers(templateText) {
  return templateText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== ENV_TEMPLATE_START && line.trim() !== ENV_TEMPLATE_END)
    .join("\n");
}

function sanitizeEnvTemplate(templateText) {
  const normalizedText = templateText.replace(/\r\n/g, "\n");
  return normalizedText.replace(
    /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*(?:API_KEY|BASE_URL))\s*=\s*)(.*?)(\s+#.*)?$/gm,
    (line, prefix, key, value, comment = "") => `${prefix}${envValuePlaceholder(key)}${comment}`
  );
}

function envValuePlaceholder(key) {
  if (key === "AI_REVIEW_PRIMARY_API_KEY") return "<primary-api-key>";
  if (key === "AI_REVIEW_SECOND_API_KEY") return "<second-api-key>";
  if (key === "AI_REVIEW_PRIMARY_BASE_URL") return "<primary-base-url>";
  if (key === "AI_REVIEW_SECOND_BASE_URL") return "<second-base-url>";
  if (key.endsWith("BASE_URL")) return "<base-url>";
  return "<api-key>";
}

function hasEnvTemplate(text, template) {
  if (!text) return false;
  if (text.includes(ENV_TEMPLATE_START) && text.includes(ENV_TEMPLATE_END)) return true;
  return normalizeNewlines(text).includes(template);
}

function appendEnvTemplate(text, template) {
  const templateBody = template.endsWith("\n") ? template : `${template}\n`;
  const templateBlock = `${ENV_TEMPLATE_START}\n${templateBody}${ENV_TEMPLATE_END}\n`;
  if (!text) return templateBlock;

  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${templateBlock}`;
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function upsertBlock(text, skillName, instructions) {
  const startMarker = `<!-- gskills:start ${skillName} -->`;
  const endMarker = `<!-- gskills:end ${skillName} -->`;
  const block = [startMarker, instructions, endMarker].join("\n");
  const blockPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "g"
  );
  let blockFound = false;
  const replacedText = text.replace(blockPattern, () => {
    if (blockFound) return "";
    blockFound = true;
    return block;
  });

  if (blockFound) {
    return `${replacedText.trimEnd()}\n`;
  }

  const existingText = text.trimEnd();
  if (!existingText) {
    return `${block}\n`;
  }
  return `${existingText}\n\n${block}\n`;
}

function appendLineIfMissing(text, line) {
  const escapedLine = escapeRegExp(line);
  const linePattern = new RegExp(`(^|\\r?\\n)${escapedLine}(?=\\r?\\n|$)`);
  if (linePattern.test(text)) {
    return text || `${line}\n`;
  }

  if (!text) {
    return `${line}\n`;
  }

  const separator = text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${line}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

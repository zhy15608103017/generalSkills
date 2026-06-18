import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const INSTRUCTIONS = [
  "## AI Code Review",
  "",
  "For feature, bug fix, refactor, or other local code changes, use the `code-review-loop` skill before reporting completion. Create `.ai-review/review-context/current-request.md`, run verification and the review loop, fix blocking `P0/P1` findings, and clearly report any review setup failure."
].join("\n");
const REVIEW_IGNORE_ENTRY = ".ai-review";

export async function install(context) {
  await upsertAgentsBlock(context.destDir, context.skillName, INSTRUCTIONS);
  await ensureGitignoreEntry(context.destDir, REVIEW_IGNORE_ENTRY);
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

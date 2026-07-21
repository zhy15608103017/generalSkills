import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const INSTRUCTIONS = [
  "## Prototype to Existing UI",
  "",
  "- When turning prototypes, wireframes, mockups, Figma exports, screenshots, or UI images into frontend pages, read `.ui-reference/` first; if absent, infer the project style from the codebase before coding.",
  "- Treat `.ui-reference/` as the human-confirmed source of truth. Keep machine-derived snapshots and inferred drafts under `.ai-ui/`; do not create or overwrite `.ui-reference/` unless the user explicitly asks.",
  "- Reuse a valid `.ai-ui/inferred-reference.md` cache. Use CodeGraph or another code graph only as an optional enhancement, and fall back to deterministic repository scanning when unavailable.",
  "- Reuse existing design tokens, theme colors, radii, spacing, fonts, components, and layout patterns; avoid one-off visual values and do not introduce a new component or style library unless the user asks.",
  "- Preserve the prototype's product intent and interactions while adapting colors, radii, spacing, fonts, and controls to the existing project style."
].join("\n");

export async function install(context) {
  await upsertAgentsBlock(context.destDir, context.skillName, INSTRUCTIONS);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

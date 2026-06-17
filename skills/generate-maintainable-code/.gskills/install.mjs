import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const INSTRUCTIONS = [
  "## Code Generation",
  "",
  "- Inspect nearby files before editing and follow the existing project style, naming, layering, and dependency placement.",
  "- Prefer simple native or project-local implementations. Do not add new dependencies, frameworks, or abstractions unless clearly justified by existing project precedent.",
  "- Preserve existing public function signatures, return shapes, and behavior unless explicitly requested.",
  "- Handle null/undefined, empty data, invalid input, external failures, and expected business errors with clear messages.",
  "- Keep pure data transformations separate from IO, requests, database access, and external clients.",
  "- For CSS, follow the existing styling system. Prefer CSS Modules or project stylesheet conventions before inline styles, and extract reusable colors and visual values into variables or theme tokens.",
  "- Add concise Chinese comments for public APIs, complex logic, and magic numbers.",
  "- Run relevant tests, lint, typecheck, or validation commands after changes."
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

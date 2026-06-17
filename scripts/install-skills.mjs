import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  copyDirectory,
  listSkillDirs,
  parseCliArgs,
  pathExists,
  resolveToolTargets,
  validateSkillDir,
  writeTargetConfig
} from "./lib/skill-utils.mjs";

export async function installSkills({
  repoDir = process.cwd(),
  destDir = process.cwd(),
  tool = "all",
  skills
} = {}) {
  const selectedNames = skills ? new Set(skills) : null;
  const skillDirs = (await listSkillDirs(repoDir)).filter(
    (skill) => !selectedNames || selectedNames.has(skill.name)
  );

  if (selectedNames && skillDirs.length !== selectedNames.size) {
    const found = new Set(skillDirs.map((skill) => skill.name));
    const missing = [...selectedNames].filter((name) => !found.has(name));
    throw new Error(`Missing skill(s): ${missing.join(", ")}`);
  }

  for (const skillDir of skillDirs) {
    const validation = await validateSkillDir(skillDir);
    if (validation.errors.length > 0) {
      throw new Error(validation.errors.join("\n"));
    }
  }

  const targets = resolveToolTargets(tool);
  const installed = [];
  for (const target of targets) {
    for (const skillDir of skillDirs) {
      const destination = path.join(destDir, target.relativePath, skillDir.name);
      await copyDirectory(skillDir.path, destination);
      await writeTargetConfig({ destDir, target });
      installed.push({
        tool: target.tool,
        skillName: skillDir.name,
        path: destination
      });
    }
  }

  const agentsInstructions = [];
  for (const skillDir of skillDirs) {
    const injected = await installAgentsInstructions({ destDir, skillDir });
    if (injected) {
      agentsInstructions.push(injected);
    }
  }

  return { installed, agentsInstructions };
}

async function installAgentsInstructions({ destDir, skillDir }) {
  const sourcePath = path.join(skillDir.path, "assets", "AGENTS.md");
  if (!(await pathExists(sourcePath))) {
    return null;
  }

  const sourceText = await readFile(sourcePath, "utf8");
  const instructions = sourceText.trim();
  if (!instructions) {
    return null;
  }

  const agentsPath = path.join(destDir, "AGENTS.md");
  const existingText = (await pathExists(agentsPath)) ? await readFile(agentsPath, "utf8") : "";
  const updatedText = upsertAgentsBlock(existingText, skillDir.name, instructions);

  await mkdir(path.dirname(agentsPath), { recursive: true });
  await writeFile(agentsPath, updatedText, "utf8");

  return {
    skillName: skillDir.name,
    path: agentsPath
  };
}

function upsertAgentsBlock(text, skillName, instructions) {
  const startMarker = `<!-- gskills:start ${skillName} -->`;
  const endMarker = `<!-- gskills:end ${skillName} -->`;
  const block = [startMarker, instructions, endMarker].join("\n");
  const blockPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "g"
  );
  let blockFound = false;
  const replacedText = text.replace(blockPattern, () => {
    if (blockFound) {
      return "";
    }
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

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const skills = args.skills ? String(args.skills).split(",").map((name) => name.trim()) : undefined;
  const result = await installSkills({
    repoDir: path.resolve(args.repo || "."),
    destDir: path.resolve(args.dest || "."),
    tool: args.aicoding || args.tool || "all",
    skills
  });

  for (const entry of result.installed) {
    console.log(`Installed ${entry.skillName} for ${entry.tool}: ${entry.path}`);
  }
  for (const entry of result.agentsInstructions) {
    console.log(`Updated AGENTS.md for ${entry.skillName}: ${entry.path}`);
  }
  if (result.installed.length === 0) {
    console.log("No skills to install.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

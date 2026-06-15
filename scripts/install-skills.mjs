import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  copyDirectory,
  listSkillDirs,
  parseCliArgs,
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

  return { installed };
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

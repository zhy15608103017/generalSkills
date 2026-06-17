import path from "node:path";
import { rm, stat } from "node:fs/promises";
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
  const targetsBySkill = new Map();
  for (const target of targets) {
    for (const skillDir of skillDirs) {
      const destination = path.join(destDir, target.relativePath, skillDir.name);
      await copyDirectory(skillDir.path, destination);
      await writeTargetConfig({ destDir, target });
      const entry = {
        tool: target.tool,
        skillName: skillDir.name,
        path: destination
      };
      installed.push(entry);
      const skillTargets = targetsBySkill.get(skillDir.name) || [];
      skillTargets.push({
        tool: target.tool,
        relativePath: target.relativePath,
        installedPath: destination
      });
      targetsBySkill.set(skillDir.name, skillTargets);
    }
  }

  const installScripts = [];
  try {
    for (const skillDir of skillDirs) {
      const script = await runInstallScript({
        destDir,
        selectedTool: tool,
        skillDir,
        targets: targetsBySkill.get(skillDir.name) || []
      });
      if (script) {
        installScripts.push(script);
      }
    }
  } finally {
    await removeInstalledLifecycleDirs(installed);
  }

  return { installed, installScripts };
}

async function runInstallScript({ destDir, selectedTool, skillDir, targets }) {
  const scriptPath = path.join(skillDir.path, ".gskills", "install.mjs");
  if (!(await pathExists(scriptPath))) {
    return null;
  }

  const moduleUrl = await cacheBustedFileUrl(scriptPath);
  const module = await import(moduleUrl);
  if (typeof module.install !== "function") {
    throw new Error(`${skillDir.name}: .gskills/install.mjs must export an install(context) function.`);
  }

  await module.install({
    skillName: skillDir.name,
    skillDir: skillDir.path,
    destDir,
    tool: selectedTool,
    targets
  });

  return {
    skillName: skillDir.name,
    path: path.join(".gskills", "install.mjs")
  };
}

async function cacheBustedFileUrl(filePath) {
  const fileStat = await stat(filePath);
  const url = pathToFileURL(filePath);
  url.searchParams.set("mtime", String(fileStat.mtimeMs));
  return url.href;
}

async function removeInstalledLifecycleDirs(installed) {
  for (const entry of installed) {
    await rm(path.join(entry.path, ".gskills"), { recursive: true, force: true });
  }
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
  for (const entry of result.installScripts) {
    console.log(`Ran install script for ${entry.skillName}: ${entry.path}`);
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

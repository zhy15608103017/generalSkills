import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  normalizeSkillName,
  parseCliArgs,
  parseResourceList,
  pathExists,
  validateSkillName
} from "./lib/skill-utils.mjs";

export async function createSkill({
  repoDir = process.cwd(),
  name,
  description,
  resources = [],
  force = false
}) {
  const skillName = normalizeSkillName(name);
  const nameErrors = validateSkillName(skillName);
  if (nameErrors.length > 0) {
    throw new Error(nameErrors.join(" "));
  }

  const skillDescription =
    description?.trim() || `Use when working with ${skillName.replaceAll("-", " ")}.`;
  const skillDir = path.join(repoDir, "skills", skillName);
  if (!force && (await pathExists(skillDir))) {
    throw new Error(`Skill "${skillName}" already exists. Use --force to replace it.`);
  }

  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), renderSkillMarkdown(skillName, skillDescription));

  for (const resource of parseResourceList(resources)) {
    await mkdir(path.join(skillDir, resource), { recursive: true });
    await writeFile(path.join(skillDir, resource, ".gitkeep"), "");
  }

  return {
    name: skillName,
    path: skillDir
  };
}

function renderSkillMarkdown(name, description) {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${titleCase(name)}`,
    "",
    "Use this skill when the request matches the frontmatter description.",
    "",
    "## Workflow",
    "",
    "1. Read any relevant files in this skill before acting.",
    "2. Prefer bundled scripts for repeatable operations.",
    "3. Keep outputs focused on the user's request.",
    ""
  ].join("\n");
}

function titleCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const name = args._[0];
  if (!name) {
    throw new Error(
      "Usage: npm run new-skill -- <name> --description \"Use when ...\" --resources references,scripts"
    );
  }

  const result = await createSkill({
    repoDir: path.resolve(args.repo || "."),
    name,
    description: args.description,
    resources: parseResourceList(args.resources),
    force: Boolean(args.force)
  });
  console.log(`Created skill ${result.name} at ${result.path}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

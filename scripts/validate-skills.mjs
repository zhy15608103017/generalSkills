import path from "node:path";
import { pathToFileURL } from "node:url";

import { listSkillDirs, parseCliArgs, validateSkillDir } from "./lib/skill-utils.mjs";

export async function validateRepository({ repoDir = process.cwd() } = {}) {
  const skills = await listSkillDirs(repoDir);
  const validations = await Promise.all(skills.map((skillDir) => validateSkillDir(skillDir)));
  const errors = validations.flatMap((result) => result.errors);

  return {
    skills: skills.map((skill) => skill.name),
    errors
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await validateRepository({
    repoDir: path.resolve(args.repo || ".")
  });

  if (result.skills.length === 0) {
    console.log("No skills found under skills/. Repository scaffold is valid.");
  } else {
    console.log(`Validated ${result.skills.length} skill(s).`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

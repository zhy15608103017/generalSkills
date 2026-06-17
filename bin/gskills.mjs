#!/usr/bin/env node
import path from "node:path";

import {
  getCliAICodingTarget,
  promptAICodingTarget,
  renderAICodingChoices
} from "../scripts/lib/aicoding-select.mjs";
import { listAICodingTargets, parseCliArgs } from "../scripts/lib/skill-utils.mjs";
import {
  DEFAULT_REF,
  DEFAULT_SOURCE,
  addRemoteSkills,
  listRemoteSkills,
  removeInstalledSkills,
  resolveRemoteConfig
} from "../scripts/lib/remote-skills.mjs";

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const args = parseCliArgs(rest);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "tools" || command === "aicodings" || command === "targets") {
    printAICodings();
    return;
  }

  if (command === "list") {
    const config = resolveRemoteConfig({ source: args.source, ref: args.ref });
    const skills = await listRemoteSkills(config);
    if (skills.length === 0) {
      console.log("No remote skills found.");
      return;
    }
    for (const skill of skills) {
      console.log(`${skill.name} - ${skill.description}`);
    }
    return;
  }

  if (command === "add") {
    const target = getCliAICodingTarget(args);
    const aicoding = target || (await promptAICodingTarget());
    const result = await addRemoteSkills({
      source: args.source,
      ref: args.ref,
      destDir: path.resolve(args.dest || "."),
      tool: aicoding,
      skills: args._
    });
    for (const entry of result.installed) {
      console.log(`Added ${entry.skillName} for ${entry.tool}: ${entry.path}`);
    }
    for (const entry of result.installScripts) {
      console.log(`Ran install script for ${entry.skillName}: ${entry.path}`);
    }
    return;
  }

  if (command === "remove" || command === "rm") {
    const target = getCliAICodingTarget(args);
    const aicoding = target || (await promptAICodingTarget());
    const result = await removeInstalledSkills({
      destDir: path.resolve(args.dest || "."),
      tool: aicoding,
      skills: args._
    });
    for (const entry of result.removed) {
      console.log(`Removed ${entry.skillName} for ${entry.tool}: ${entry.path}`);
    }
    return;
  }

  throw new Error(`Unknown command "${command}". Run gskills help.`);
}

function printAICodings() {
  console.log(renderAICodingChoices());
}

function printHelp() {
  console.log(`gskills

Usage:
  gskills list [--source owner/repo] [--ref main]
  gskills add <skill...> [--aicoding target] [--dest path]
  gskills remove <skill...> [--aicoding target] [--dest path]
  gskills aicodings

Defaults:
  source: ${DEFAULT_SOURCE}
  ref: ${DEFAULT_REF}
  aicoding: interactive selection in a TTY, default in scripts

Targets:
${listAICodingTargets()
  .map((target) => `  ${target.name} -> ${target.relativePath}`)
  .join("\n")}

Compatibility:
  --tool works as an alias for --aicoding

Environment:
  GSKILLS_SOURCE=owner/repo
  GSKILLS_REF=main`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

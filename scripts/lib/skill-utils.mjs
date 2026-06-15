import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const AI_CODING_TARGETS = [
  {
    name: "default",
    label: "Default / Agent Skills",
    relativePath: ".agents/skills",
    aliases: ["agent", "agents"]
  },
  {
    name: "codex",
    label: "Codex",
    relativePath: ".agents/skills",
    aliases: ["openai-codex"]
  },
  {
    name: "claude",
    label: "Claude Code",
    relativePath: ".claude/skills",
    aliases: ["claude-code"]
  },
  {
    name: "cursor",
    label: "Cursor",
    relativePath: ".cursor/skills",
    aliases: []
  },
  {
    name: "gemini",
    label: "Gemini CLI",
    relativePath: ".gemini/skills",
    aliases: ["gemini-cli"]
  },
  {
    name: "opencode",
    label: "opencode",
    relativePath: ".opencode/skills",
    aliases: ["open-code"]
  },
  {
    name: "trae",
    label: "Trae",
    relativePath: ".trae/skills",
    aliases: ["trae-ai"]
  },
  {
    name: "windsurf",
    label: "Windsurf / Cascade",
    relativePath: ".windsurf/skills",
    aliases: ["cascade"]
  }
];

export const TOOL_TARGETS = Object.fromEntries(
  AI_CODING_TARGETS.filter((target) => target.name !== "default").map((target) => [
    target.name,
    target.relativePath
  ])
);

export function normalizeSkillName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function validateSkillName(name) {
  const errors = [];
  if (!name) {
    errors.push("Skill name is required.");
    return errors;
  }
  if (name.length > 64) {
    errors.push("Skill name must be 64 characters or fewer.");
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    errors.push("Skill name must use lowercase letters, digits, and hyphens only.");
  }
  if (name.includes("--")) {
    errors.push("Skill name must not contain repeated hyphens.");
  }
  return errors;
}

export function parseSkillFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    throw new Error("SKILL.md frontmatter must end with a closing --- line.");
  }

  const data = {};
  for (const line of lines.slice(1, endIndex)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }
    const [, key, rawValue] = match;
    data[key] = stripYamlString(rawValue.trim());
  }

  if (!data.name) {
    throw new Error("SKILL.md frontmatter must include name.");
  }
  if (!data.description) {
    throw new Error("SKILL.md frontmatter must include description.");
  }

  return {
    name: data.name,
    description: data.description
  };
}

function stripYamlString(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export async function listSkillDirs(repoDir) {
  const skillsDir = path.join(repoDir, "skills");
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: path.join(skillsDir, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function validateSkillDir(skillDir) {
  const errors = [];
  const skillFile = path.join(skillDir.path, "SKILL.md");

  for (const error of validateSkillName(skillDir.name)) {
    errors.push(`${skillDir.name}: ${error}`);
  }

  let frontmatter;
  try {
    const text = await readFile(skillFile, "utf8");
    frontmatter = parseSkillFrontmatter(text);
  } catch (error) {
    errors.push(`${skillDir.name}: ${error.message}`);
    return { skill: skillDir.name, errors };
  }

  if (frontmatter.name !== skillDir.name) {
    errors.push(
      `${skillDir.name}: frontmatter name must match folder name "${skillDir.name}".`
    );
  }
  for (const error of validateSkillName(frontmatter.name)) {
    errors.push(`${skillDir.name}: frontmatter ${error}`);
  }
  if (!frontmatter.description.trim()) {
    errors.push(`${skillDir.name}: frontmatter description must not be empty.`);
  }

  return { skill: skillDir.name, errors };
}

export function resolveToolTargets(tool) {
  const selected = String(tool ?? "default").toLowerCase();
  const targets =
    selected === "all"
      ? AI_CODING_TARGETS.filter((target) => target.name !== "default")
      : [resolveSingleAICodingTarget(selected)];

  return targets.map((target) => ({
    tool: target.name,
    label: target.label,
    relativePath: target.relativePath
  }));
}

export function resolveSingleAICodingTarget(value) {
  const selected = String(value ?? "default").toLowerCase();
  const target = AI_CODING_TARGETS.find(
    (entry) => entry.name === selected || entry.aliases.includes(selected)
  );
  if (!target) {
    const names = AI_CODING_TARGETS.map((entry) => entry.name).join(", ");
    throw new Error(`Unsupported AI coding target "${value}". Use ${names}, or all.`);
  }
  return target;
}

export function listAICodingTargets() {
  return AI_CODING_TARGETS.map((target) => ({
    name: target.name,
    label: target.label,
    relativePath: target.relativePath,
    aliases: [...target.aliases]
  }));
}

export async function writeTargetConfig({ destDir, target }) {
  if (target.tool !== "gemini") {
    return [];
  }

  const extensionDir = path.join(destDir, ".gemini", "extensions", "gskills");
  await mkdir(extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "gemini-extension.json");
  const manifest = {
    name: "gskills",
    version: "0.1.0",
    mcpServers: {}
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return [manifestPath];
}

export function parseResourceList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  const allowed = new Set(["scripts", "references", "assets"]);
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!allowed.has(entry)) {
        throw new Error(`Unsupported resource "${entry}". Use scripts, references, or assets.`);
      }
      return entry;
    });
}

export async function copyDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function parseCliArgs(argv) {
  const args = {
    _: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (inlineValue !== undefined && inlineValue !== "") {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

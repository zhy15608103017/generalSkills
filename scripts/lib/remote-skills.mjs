import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { installSkills } from "../install-skills.mjs";
import {
  parseSkillFrontmatter,
  resolveToolTargets,
  validateSkillName
} from "./skill-utils.mjs";

export const DEFAULT_SOURCE = "zhy15608103017/generalSkills";
export const DEFAULT_REF = "main";

export function resolveRemoteConfig({
  source,
  ref,
  env = process.env
} = {}) {
  return {
    source: source || env.GSKILLS_SOURCE || DEFAULT_SOURCE,
    ref: ref || env.GSKILLS_REF || DEFAULT_REF
  };
}

export function parseGitHubSource(source) {
  const value = String(source || "").trim();
  const https = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (https) {
    return {
      owner: https[1],
      repo: stripGitSuffix(https[2])
    };
  }

  const ssh = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) {
    return {
      owner: ssh[1],
      repo: stripGitSuffix(ssh[2])
    };
  }

  const ownerRepo = value.match(/^([^/:\s]+)\/([^/:\s]+)$/);
  if (ownerRepo) {
    return {
      owner: ownerRepo[1],
      repo: stripGitSuffix(ownerRepo[2])
    };
  }

  throw new Error(`Invalid GitHub source "${source}". Use owner/repo or a GitHub URL.`);
}

function stripGitSuffix(value) {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

export async function listRemoteSkills({
  source,
  ref,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = resolveRemoteConfig({ source, ref });
  const tree = await fetchRemoteTree({ ...config, fetchImpl });
  const skillNames = discoverSkillNames(tree);
  const skills = [];

  for (const skillName of skillNames) {
    const text = await fetchRawText({
      ...config,
      remotePath: `skills/${skillName}/SKILL.md`,
      fetchImpl
    });
    const frontmatter = parseSkillFrontmatter(text);
    skills.push({
      name: frontmatter.name,
      description: frontmatter.description
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addRemoteSkills({
  source,
  ref,
  destDir = process.cwd(),
  tool = "all",
  skills,
  fetchImpl = globalThis.fetch
} = {}) {
  const requestedSkills = normalizeRequestedSkills(skills);
  const config = resolveRemoteConfig({ source, ref });
  const tree = await fetchRemoteTree({ ...config, fetchImpl });
  const available = new Set(discoverSkillNames(tree));
  const missing = requestedSkills.filter((skill) => !available.has(skill));
  if (missing.length > 0) {
    throw new Error(`Missing remote skill(s): ${missing.join(", ")}`);
  }

  const tempRepo = await makeTempRepo();
  try {
    for (const skillName of requestedSkills) {
      await downloadRemoteSkill({
        ...config,
        tree,
        skillName,
        repoDir: tempRepo,
        fetchImpl
      });
    }

    return await installSkills({
      repoDir: tempRepo,
      destDir,
      tool,
      skills: requestedSkills
    });
  } finally {
    await rm(tempRepo, { recursive: true, force: true });
  }
}

export async function removeInstalledSkills({
  destDir = process.cwd(),
  tool = "all",
  skills
} = {}) {
  const requestedSkills = normalizeRequestedSkills(skills);
  const targets = resolveToolTargets(tool);
  const removed = [];

  for (const target of targets) {
    for (const skillName of requestedSkills) {
      const destination = path.join(destDir, target.relativePath, skillName);
      await rm(destination, { recursive: true, force: true });
      removed.push({
        tool: target.tool,
        skillName,
        path: destination
      });
    }
  }

  return { removed };
}

async function fetchRemoteTree({ source, ref, fetchImpl }) {
  ensureFetch(fetchImpl);
  const { owner, repo } = parseGitHubSource(source);
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gskills"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch remote skill tree: HTTP ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.tree)) {
    throw new Error("GitHub tree response did not include a tree array.");
  }
  return data.tree;
}

function discoverSkillNames(tree) {
  return tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .map((remotePath) => remotePath.match(/^skills\/([^/]+)\/SKILL\.md$/))
    .filter(Boolean)
    .map((match) => match[1])
    .filter((name) => validateSkillName(name).length === 0)
    .sort((a, b) => a.localeCompare(b));
}

async function downloadRemoteSkill({
  source,
  ref,
  tree,
  skillName,
  repoDir,
  fetchImpl
}) {
  const prefix = `skills/${skillName}/`;
  const files = tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .filter((remotePath) => remotePath.startsWith(prefix));

  for (const remotePath of files) {
    const bytes = await fetchRawBytes({
      source,
      ref,
      remotePath,
      fetchImpl
    });
    const outputPath = path.join(repoDir, ...remotePath.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
}

async function fetchRawText(options) {
  const bytes = await fetchRawBytes(options);
  return bytes.toString("utf8");
}

async function fetchRawBytes({ source, ref, remotePath, fetchImpl }) {
  ensureFetch(fetchImpl);
  const { owner, repo } = parseGitHubSource(source);
  const url = rawGitHubUrl({ owner, repo, ref, remotePath });
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "gskills"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${remotePath}: HTTP ${response.status} ${response.statusText}`);
  }
  if (typeof response.arrayBuffer === "function") {
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(await response.text(), "utf8");
}

function rawGitHubUrl({ owner, repo, ref, remotePath }) {
  const encodedPath = remotePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodedPath}`;
}

function normalizeRequestedSkills(skills) {
  const requested = Array.isArray(skills) ? skills : String(skills || "").split(",");
  const normalized = requested.map((skill) => String(skill).trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("At least one skill name is required.");
  }
  const errors = normalized.flatMap((skill) => validateSkillName(skill).map((error) => `${skill}: ${error}`));
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return [...new Set(normalized)];
}

async function makeTempRepo() {
  return await mkdtemp(path.join(os.tmpdir(), "gskills-"));
}

function ensureFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable. Use Node.js 20 or newer.");
  }
}

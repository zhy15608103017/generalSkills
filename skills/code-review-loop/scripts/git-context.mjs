import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EMPTY_GIT_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function getGitRoot() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

export async function resolveReviewScope(root, options = {}) {
  const base = options.base || await resolveDefaultGitBase(root);
  const paths = normalizeReviewPaths(root, options.paths || []);
  const shouldExcludeReviewArtifacts = !paths.some(isReviewArtifactPath);
  const pathspecPaths = paths.length ? paths : ["."];
  const pathspec = [
    "--",
    ...pathspecPaths,
    ...(shouldExcludeReviewArtifacts ? [":(exclude).ai-review/**"] : []),
  ];
  const diffCommand = options.staged
    ? ["diff", "--cached", "--no-ext-diff", "--unified=80"]
    : ["diff", "--no-ext-diff", "--unified=80", base];

  return { base, staged: Boolean(options.staged), paths, pathspec, diffCommand };
}

export async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 20,
    });
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    const command = ["git", ...args].join(" ");
    throw new Error(`Git 命令执行失败: ${command}${detail ? `\n${detail}` : ""}`, {
      cause: error,
    });
  }
}

export function isReviewArtifactPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === ".ai-review" || normalized.startsWith(".ai-review/");
}

function normalizeReviewPaths(root, paths) {
  return paths
    .map((rawPath) => {
      const trimmed = String(rawPath || "").trim();
      if (!trimmed) return "";
      if (trimmed.startsWith(":")) {
        throw new Error(`审核路径不支持 git pathspec 语法: ${trimmed}`);
      }
      const resolved = path.resolve(root, trimmed);
      if (!isPathInsideOrSame(root, resolved)) {
        throw new Error(`审核路径必须位于仓库内: ${trimmed}`);
      }
      return path.relative(root, resolved).replace(/\\/g, "/") || ".";
    })
    .filter((item, index, items) => item && items.indexOf(item) === index);
}

async function resolveDefaultGitBase(root) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root });
    return "HEAD";
  } catch {
    return EMPTY_GIT_TREE;
  }
}

function isPathInsideOrSame(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

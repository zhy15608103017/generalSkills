import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const skillDir = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const files = await listModules(skillDir);
  for (const filePath of files) {
    await execFileAsync(process.execPath, ["--check", filePath], {
      windowsHide: true,
    });
  }
  process.stdout.write(`Syntax checked ${files.length} module(s).\n`);
}

async function listModules(rootDir) {
  const files = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listModules(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(entryPath);
    }
  }
  return files.sort((first, second) => first.localeCompare(second));
}

main().catch((error) => {
  process.stderr.write(`code-review-loop 语法检查失败: ${error.message}\n`);
  process.exitCode = 1;
});

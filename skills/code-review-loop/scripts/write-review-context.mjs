import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_OUT = ".ai-review/review-context/current-request.md";
const MAX_FIELD_CHARS = 4000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(process.cwd(), args.out || DEFAULT_OUT);
  const content = await readContent(args);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, normalizeMarkdown(content), "utf8");
  process.stdout.write(`已写入审核上下文: ${outPath}\n`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--from-stdin") {
      args.fromStdin = true;
    } else if (arg === "--from-file" && next) {
      args.fromFile = next;
      index += 1;
    } else if (arg === "--out" && next) {
      args.out = next;
      index += 1;
    } else if (arg === "--request" && next) {
      args.request = next;
      index += 1;
    } else if (arg === "--design" && next) {
      args.design = next;
      index += 1;
    } else if (arg === "--acceptance" && next) {
      args.acceptance = next;
      index += 1;
    } else if (arg === "--non-goals" && next) {
      args.nonGoals = next;
      index += 1;
    } else if (arg === "--verification" && next) {
      args.verification = next;
      index += 1;
    }
  }

  return args;
}

async function readContent(args) {
  if (args.fromStdin && args.fromFile) {
    throw new Error("--from-stdin and --from-file cannot be used together.");
  }

  if (args.fromFile) {
    const filePath = path.resolve(process.cwd(), args.fromFile);
    return await fs.readFile(filePath, "utf8");
  }

  if (args.fromStdin) {
    const content = await readStdin();
    if (looksQuestionMarkCorrupted(content)) {
      throw new Error(
        "stdin 内容看起来已经发生编码损坏（出现大量连续问号）。在 Windows PowerShell 中，请改用 --request/--design/--acceptance 等参数，或先保存为 UTF-8 文件后使用 --from-file <path>。"
      );
    }
    return content;
  }

  return renderContext(args);
}

function renderContext(args) {
  return `# 当前审核需求上下文

> 保持精简：只记录当前功能的需求、设计结论和验收标准，不粘贴完整聊天记录。每次新功能开始时覆盖本文件。

## 原始需求

${compact(args.request) || "请在开始功能变更前补充本次用户原始需求。"}

## 设计结论

${compact(args.design) || "请补充本次实现采用的设计方案、关键边界和取舍。"}

## 非目标

${compact(args.nonGoals) || "请补充本次明确不处理的范围；如果没有，请写“无”。"}

## 验收标准

${compact(args.acceptance) || "请补充审核模型应据此判断是否满足需求的验收标准。"}

## 建议验证

${compact(args.verification) || "请补充本次变更建议运行的验证命令。"}
`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeMarkdown(content) {
  const trimmed = String(content || "").trim();
  return `${trimmed}\n`;
}

function compact(value = "") {
  const text = String(value).trim();
  if (text.length <= MAX_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_FIELD_CHARS)}\n\n[已截断：单字段超过 ${MAX_FIELD_CHARS} 字符，请改写为摘要。]`;
}

function looksQuestionMarkCorrupted(content) {
  const text = String(content || "");
  const questionCount = (text.match(/\?/g) || []).length;
  const visibleCount = text.replace(/\s/g, "").length;
  if (questionCount < 8 || visibleCount === 0) return false;
  if (!/\?{4,}/.test(text)) return false;
  if (/[\u4e00-\u9fff]/.test(text)) return false;
  return questionCount / visibleCount > 0.25;
}

main().catch((error) => {
  process.stderr.write(`write-review-context 执行失败: ${error.message}\n`);
  process.exitCode = 1;
});

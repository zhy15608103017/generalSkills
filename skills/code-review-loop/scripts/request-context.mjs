import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_REQUEST_CONTEXT = ".ai-review/review-context/current-request.md";

const REQUIRED_SECTIONS = [
  {
    name: "用户原始请求",
    patterns: [/^##\s*用户原始请求/m, /^##\s*原始(请求|需求)/m],
  },
  {
    name: "用户后续纠正/澄清",
    patterns: [/^##\s*用户后续纠正\/澄清/m, /^##\s*(后续)?(纠正|澄清)/m],
  },
  {
    name: "当前模型理解",
    patterns: [/^##\s*当前模型理解/m, /^##\s*模型理解/m],
  },
  {
    name: "明确反例/非期望行为",
    patterns: [/^##\s*明确反例\/非期望行为/m, /^##\s*(反例|非期望行为)/m],
  },
  {
    name: "验收标准",
    patterns: [/^##\s*验收(标准|准则)/m, /^##\s*Acceptance Criteria/m],
  },
];

export async function assertRequestContext(root, options = {}) {
  const requestPath = options.request || DEFAULT_REQUEST_CONTEXT;
  const resolved = path.resolve(root, requestPath);

  if (!options.allowOutsideDocs && !isPathInsideOrSame(root, resolved)) {
    throw new Error(`审核需求上下文必须位于仓库内: ${requestPath}。如确需使用仓库外文件，请显式传入 --allow-outside-docs。`);
  }

  let content;
  try {
    content = await fs.readFile(resolved, "utf8");
  } catch {
    throw new Error(`缺少审核需求上下文: ${requestPath}。请先创建 .ai-review/review-context/current-request.md，或通过 --request 指定非空需求文件。`);
  }

  if (!content.trim()) {
    throw new Error(`审核需求上下文为空: ${requestPath}。请写入本次需求、用户纠正、当前模型理解、验收标准和非目标后再运行审核。`);
  }

  const missingSections = missingRequestContextSections(content);
  if (missingSections.length) {
    throw new Error(
      `审核需求上下文缺少必需章节: ${missingSections.join(", ")}。请使用 write-review-context.mjs 重新生成，或补齐这些 Markdown 二级标题。`,
    );
  }
}

export function missingRequestContextSections(content) {
  return REQUIRED_SECTIONS
    .filter((section) => !section.patterns.some((pattern) => pattern.test(content)))
    .map((section) => section.name);
}

function isPathInsideOrSame(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".output",
  "coverage", ".cache", ".turbo", ".vercel", ".netlify", ".ai-ui",
  ".ai-review", ".learnings", ".idea", ".vscode", "out", "tmp", "temp",
  ".terraform", ".serverless", "__snapshots__", "__tests__"
]);
const STYLE_EXTS = new Set([".css", ".scss", ".less", ".sass", ".styl", ".pcss"]);
const TOKEN_BASENAMES = ["tailwind.config", "theme", "tokens", "design-system"];
const TOKEN_EXTS = [".js", ".ts", ".cjs", ".mjs", ".json", ".css"];
const COMPONENT_DIRS = [
  "src/components",
  "src/shared",
  "src/ui",
  "src/lib/components",
  "components",
  "app/components",
  "src/app/components",
  "packages/components/src"
];
const COMPONENT_NAMES = [
  "Button", "IconButton", "Input", "Textarea", "Select", "Checkbox", "Radio",
  "Switch", "Tabs", "Table", "DataGrid", "Card", "Panel", "Modal", "Dialog",
  "Drawer", "Dropdown", "Popover", "Tooltip", "Badge", "Tag", "Avatar",
  "Breadcrumb", "Pagination", "EmptyState", "Skeleton", "Toast", "Spinner",
  "Alert", "Notification", "Form", "Field", "Menu", "Navigation", "Sidebar",
  "Header", "Footer", "Layout"
];
const UI_LIBS = {
  "antd": "Ant Design",
  "@mui/material": "Material UI",
  "@mui/core": "Material UI",
  "@mui/joy": "Joy UI",
  "@chakra-ui/react": "Chakra UI",
  "@mantine/core": "Mantine",
  "react-bootstrap": "React Bootstrap",
  "reactstrap": "Reactstrap",
  "semantic-ui-react": "Semantic UI",
  "evergreen-ui": "Evergreen",
  "@fluentui/react-components": "Fluent UI",
  "element-plus": "Element Plus",
  "naive-ui": "Naive UI",
  "vant": "Vant",
  "tdesign-vue-next": "TDesign",
  "tdesign-react": "TDesign",
  "@arco-design/web-react": "Arco Design",
  "primereact": "PrimeReact",
  "primevue": "PrimeVue",
  "@headlessui/react": "Headless UI",
  "react-aria": "React Aria",
  "@ark-ui/react": "Ark UI"
};
const ICON_LIBS = {
  "lucide-react": "Lucide",
  "lucide-vue-next": "Lucide",
  "@heroicons/react": "Heroicons",
  "react-icons": "react-icons",
  "@iconify/react": "Iconify",
  "@iconify/vue": "Iconify",
  "@fortawesome/fontawesome-svg-core": "Font Awesome",
  "@fortawesome/react-fontawesome": "Font Awesome",
  "@ant-design/icons": "Ant Design Icons",
  "@element-plus/icons-vue": "Element Plus Icons",
  "primeicons": "PrimeIcons"
};
const STYLING_LIBS = {
  "tailwindcss": "Tailwind CSS",
  "unocss": "UnoCSS",
  "@unocss/core": "UnoCSS",
  "styled-components": "styled-components",
  "@emotion/react": "Emotion",
  "@emotion/css": "Emotion",
  "sass": "Sass/SCSS",
  "node-sass": "Sass/SCSS",
  "less": "Less",
  "stylus": "Stylus",
  "@vanilla-extract/css": "Vanilla Extract",
  "styled-jsx": "styled-jsx"
};
const MAX_STYLE_FILES = 400;
const MAX_UI_SOURCE_FILES = 1200;
const SNAPSHOT_DIR = ".ai-ui";
const SNAPSHOT_FILE = "style-snapshot.md";
const INFERRED_REFERENCE_FILE = "inferred-reference.md";
const INFERENCE_META_FILE = "inference-meta.json";
const GRAPH_EVIDENCE_FILE = "graph-evidence.json";
const INFERENCE_SCHEMA_VERSION = 1;
const INFERENCE_VERSION = 1;
const GRAPH_EVIDENCE_SCHEMA_VERSION = 1;
const UI_SOURCE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".css", ".scss",
  ".less", ".sass", ".styl", ".pcss"
]);
const UI_SOURCE_DIRS = [
  ...COMPONENT_DIRS,
  "app",
  "src/app",
  "pages",
  "src/pages",
  "layouts",
  "src/layouts",
  "router",
  "src/router",
  "routes",
  "src/routes"
];

export async function discoverStyle({
  root = process.cwd(),
  now = new Date(),
  graphEvidencePath,
  forceRefresh = false
} = {}) {
  const resolvedRoot = path.resolve(root);
  const uiReference = await readUiReference(resolvedRoot);
  const pkg = await readPackageJson(resolvedRoot);
  const tokenFiles = await findTokenFiles(resolvedRoot);
  const styleFiles = await collectStyleFiles(resolvedRoot);
  const cssVars = await collectCssVars(styleFiles);
  const configColors = await collectConfigColors(tokenFiles);
  const components = await findComponents(resolvedRoot);
  const uiSourceFiles = await collectUiSourceFiles(resolvedRoot);
  const codeSignals = await collectCodeSignals(uiSourceFiles, resolvedRoot);
  const styleSourceSignatures = await collectStyleSourceSignatures(
    [...tokenFiles, ...styleFiles],
    resolvedRoot
  );
  const inputSources = await buildInputSources(resolvedRoot, {
    uiReference,
    tokenFiles,
    styleFiles,
    uiSourceFiles
  });
  const inputFingerprint = hashValue({
    relevantDependencies: pkg.relevantDependencies,
    sources: inputSources
  });
  const staticSemanticSignature = buildStaticSemanticSignature({
    pkg,
    tokenFiles,
    cssVars,
    configColors,
    components,
    codeSignals,
    styleSourceSignatures,
    root: resolvedRoot
  });
  const staticSemanticFingerprint = hashValue(staticSemanticSignature);
  const graphEvidence = await readGraphEvidence({
    root: resolvedRoot,
    graphEvidencePath,
    inputFingerprint
  });
  const semanticFingerprint = hashValue({
    static: staticSemanticSignature,
    graph: graphEvidence.status === "valid" ? graphEvidence.signature : null
  });
  const fingerprints = {
    schemaVersion: INFERENCE_SCHEMA_VERSION,
    inferenceVersion: INFERENCE_VERSION,
    input: inputFingerprint,
    staticSemantic: staticSemanticFingerprint,
    graph: graphEvidence.fingerprint,
    semantic: semanticFingerprint,
    inputFileCount: inputSources.length
  };
  const inferenceCache = await inspectInferenceCache({
    root: resolvedRoot,
    fingerprints,
    graphEvidence,
    forceRefresh
  });

  const sources = [];
  if (uiReference.exists) sources.push(".ui-reference/");
  if (pkg.exists || tokenFiles.length > 0 || styleFiles.length > 0 || components.found.length > 0) {
    sources.push("代码库");
  }

  return {
    generatedAt: toIso(now),
    root: toPosixPath(resolvedRoot),
    sources: sources.length > 0 ? sources.join(" + ") : "未检测到",
    uiReference,
    packageJson: pkg,
    tokenFiles: tokenFiles.map((entry) => toPosixPath(path.relative(resolvedRoot, entry.path))),
    styleFileCount: styleFiles.length,
    cssVars,
    configColors,
    components,
    codeSignals,
    palette: buildPalette(cssVars.colors, configColors),
    fingerprints,
    graphEvidence: summarizeGraphEvidence(graphEvidence),
    inferenceCache
  };
}

export function renderSnapshotMarkdown(snapshot) {
  const lines = [];
  lines.push("# UI 风格快照", "");
  lines.push(`- 生成时间: ${snapshot.generatedAt}`);
  lines.push(`- 仓库根目录: ${snapshot.root}`);
  lines.push(`- 风格来源: ${snapshot.sources}`);
  lines.push("");

  lines.push("## 参考目录 (.ui-reference/)");
  if (snapshot.uiReference.exists && snapshot.uiReference.files.length > 0) {
    for (const file of snapshot.uiReference.files) {
      lines.push(`- \`${file.path}\`${file.preview ? ` — ${file.preview}` : ""}`);
    }
  } else {
    lines.push("- 未找到 `.ui-reference/` 目录，风格从代码库推断。");
  }
  lines.push("");

  lines.push("## 组件库");
  lines.push(listOrNone(snapshot.packageJson.uiLibs));
  lines.push("");

  lines.push("## 图标体系");
  lines.push(listOrNone(snapshot.packageJson.iconLibs));
  lines.push("");

  lines.push("## CSS 体系");
  lines.push(listOrNone(snapshot.packageJson.stylingLibs));
  lines.push("");

  lines.push("## 颜色方案");
  lines.push(colorLinesOrNone(snapshot.cssVars.colors, snapshot.configColors));
  lines.push("");

  lines.push("## 圆角体系");
  lines.push(varsOrNone(snapshot.cssVars.radii));
  lines.push("");

  lines.push("## 间距密度");
  lines.push(varsOrNone(snapshot.cssVars.spacing));
  lines.push("");

  lines.push("## 字体排版");
  lines.push(varsOrNone(snapshot.cssVars.fonts));
  lines.push("");

  lines.push("## 边框与阴影");
  lines.push(varsOrNone([...snapshot.cssVars.borders, ...snapshot.cssVars.shadows]));
  lines.push("");

  lines.push("## 可复用组件");
  if (snapshot.components.found.length === 0) {
    lines.push("- 未在常见组件目录中检测到可复用组件。");
  } else {
    if (snapshot.components.dirs.length > 0) {
      lines.push(`- 扫描目录: ${snapshot.components.dirs.join(", ")}`);
    }
    for (const component of snapshot.components.found) {
      lines.push(`- ${component.name} — \`${component.path}\``);
    }
  }
  lines.push("");

  lines.push("## token 来源文件");
  if (snapshot.tokenFiles.length === 0) {
    lines.push("- 未检测到 `tailwind.config.*` / `theme.*` / `tokens.*` / `design-system.*` 文件。");
  } else {
    for (const file of snapshot.tokenFiles) lines.push(`- \`${file}\``);
  }
  lines.push("");

  lines.push("## 机器推断缓存");
  lines.push(`- 输入指纹: \`${snapshot.fingerprints.input}\``);
  lines.push(`- 静态 UI 语义指纹: \`${snapshot.fingerprints.staticSemantic}\``);
  lines.push(`- 综合 UI 语义指纹: \`${snapshot.fingerprints.semantic}\``);
  lines.push(`- UI 输入文件数: ${snapshot.fingerprints.inputFileCount}`);
  lines.push(`- 图谱证据: ${renderGraphEvidenceStatus(snapshot.graphEvidence)}`);
  lines.push(`- 推断参考缓存: ${snapshot.inferenceCache.status} — ${snapshot.inferenceCache.reason}`);
  lines.push("");

  lines.push("## 原型适配说明");
  lines.push("- 实现时填充：保留原型的产品意图与交互，把颜色、圆角、间距、字体和控件适配到上面的项目风格。");
  lines.push("");

  return lines.join("\n");
}

export async function recordInferenceCache({
  root = process.cwd(),
  snapshot,
  now = new Date()
} = {}) {
  const resolvedRoot = path.resolve(root);
  const inferredPath = path.join(resolvedRoot, SNAPSHOT_DIR, INFERRED_REFERENCE_FILE);
  const inferredText = await readUtf8Safe(inferredPath);
  if (!inferredText.trim()) {
    throw new Error(`无法记录推断缓存：未找到 ${SNAPSHOT_DIR}/${INFERRED_REFERENCE_FILE}。`);
  }
  const currentSnapshot = snapshot || await discoverStyle({ root: resolvedRoot, now });
  const metadata = {
    schemaVersion: INFERENCE_SCHEMA_VERSION,
    inferenceVersion: INFERENCE_VERSION,
    generatedAt: toIso(now),
    inputFingerprint: currentSnapshot.fingerprints.input,
    staticSemanticFingerprint: currentSnapshot.fingerprints.staticSemantic,
    semanticFingerprint: currentSnapshot.fingerprints.semantic,
    graphFingerprint: currentSnapshot.fingerprints.graph,
    graphProvider: currentSnapshot.graphEvidence.provider || null
  };
  const outPath = path.join(resolvedRoot, SNAPSHOT_DIR, INFERENCE_META_FILE);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return { path: outPath, metadata };
}

async function buildInputSources(root, {
  uiReference,
  tokenFiles,
  styleFiles,
  uiSourceFiles
}) {
  const paths = new Set();
  for (const file of uiReference.files) paths.add(path.resolve(root, file.path));
  for (const file of [...tokenFiles, ...styleFiles, ...uiSourceFiles]) {
    paths.add(path.resolve(file.path));
  }

  const sources = [];
  for (const filePath of [...paths].sort()) {
    const info = await statSafe(filePath);
    if (!info?.isFile()) continue;
    const content = await readFile(filePath);
    sources.push({
      path: toPosixPath(path.relative(root, filePath)),
      hash: hashBuffer(content)
    });
  }
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectUiSourceFiles(root) {
  const files = new Map();
  for (const rel of UI_SOURCE_DIRS) {
    const start = path.join(root, rel);
    if (!(await statSafe(start))) continue;
    await walkUiSources(start, 0, 6, files);
    if (files.size >= MAX_UI_SOURCE_FILES) break;
  }
  return [...files.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_UI_SOURCE_FILES);
}

async function walkUiSources(dir, depth, maxDepth, files) {
  if (depth > maxDepth || files.size >= MAX_UI_SOURCE_FILES) return;
  const entries = await listDirSafe(dir);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = await statSafe(full);
    if (!info) continue;
    if (info.isDirectory()) {
      await walkUiSources(full, depth + 1, maxDepth, files);
    } else if (info.isFile() && UI_SOURCE_EXTS.has(path.extname(entry))) {
      files.set(path.resolve(full), { path: full });
      if (files.size >= MAX_UI_SOURCE_FILES) return;
    }
  }
}

async function collectCodeSignals(files, root) {
  const exportedSymbols = new Set();
  const layoutFiles = new Set();
  const sharedClassTokens = new Set();
  const jsxUsage = new Map();

  for (const file of files) {
    const text = await readUtf8Safe(file.path);
    if (!text) continue;
    const rel = toPosixPath(path.relative(root, file.path));
    const basename = path.basename(file.path, path.extname(file.path));
    if (/(layout|shell|navigation|sidebar|header|footer)/i.test(basename)) {
      layoutFiles.add(rel);
    }

    const exportRe = /export\s+(?:default\s+)?(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = exportRe.exec(text)) !== null) {
      exportedSymbols.add(`${rel}#${match[1]}`);
    }

    const jsxRe = /<([A-Z][A-Za-z0-9_.]*)\b/g;
    while ((match = jsxRe.exec(text)) !== null) {
      if (!jsxUsage.has(match[1])) jsxUsage.set(match[1], new Set());
      jsxUsage.get(match[1]).add(rel);
    }

    if (isSharedUiPath(rel)) {
      const classRe = /(?:className|class)\s*=\s*["'`]([^"'`]+)["'`]/g;
      while ((match = classRe.exec(text)) !== null) {
        for (const token of match[1].split(/\s+/)) {
          if (/^[A-Za-z0-9_:[\]./%-]+$/.test(token)) sharedClassTokens.add(token);
        }
      }
    }
  }

  return {
    exportedSymbols: [...exportedSymbols].sort().slice(0, 400),
    layoutFiles: [...layoutFiles].sort().slice(0, 120),
    sharedClassTokens: [...sharedClassTokens].sort().slice(0, 400),
    jsxUsage: [...jsxUsage.entries()]
      .map(([name, sourceFiles]) => ({
        name,
        usage: sourceFiles.size >= 2 ? "shared-pattern" : "local-example"
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400)
  };
}

async function collectStyleSourceSignatures(files, root) {
  const paths = new Map();
  for (const file of files) paths.set(path.resolve(file.path), file.path);
  const signatures = [];
  for (const filePath of [...paths.keys()].sort()) {
    const text = await readUtf8Safe(filePath);
    if (!text) continue;
    const ext = path.extname(filePath);
    const normalized = normalizeStyleSource(text, ext);
    signatures.push({
      path: toPosixPath(path.relative(root, filePath)),
      hash: hashBuffer(Buffer.from(normalized, "utf8"))
    });
  }
  return signatures;
}

function normalizeStyleSource(text, ext) {
  if (ext === ".json") {
    try {
      return stableStringify(JSON.parse(text));
    } catch {
      return text.replace(/\s+/g, " ").trim();
    }
  }
  const withoutComments = STYLE_EXTS.has(ext)
    ? text.replace(/\/\*[\s\S]*?\*\//g, " ")
    : stripCodeComments(text);
  return withoutComments.replace(/\s+/g, " ").trim();
}

function stripCodeComments(text) {
  let result = "";
  let state = "code";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        result += char;
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state !== "code") {
      result += char;
      if (char === "\\" && next !== undefined) {
        result += next;
        index += 1;
        continue;
      }
      if (
        (state === "single-quote" && char === "'") ||
        (state === "double-quote" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else {
      result += char;
      if (char === "'") state = "single-quote";
      else if (char === '"') state = "double-quote";
      else if (char === "`") state = "template";
    }
  }
  return result;
}

function isSharedUiPath(relativePath) {
  return COMPONENT_DIRS.some((dir) => {
    const prefix = `${toPosixPath(dir).replace(/\/$/, "")}/`;
    return relativePath.startsWith(prefix);
  }) || /(^|\/)(layout|layouts|shell|navigation)(\/|\.|$)/i.test(relativePath);
}

function buildStaticSemanticSignature({
  pkg,
  tokenFiles,
  cssVars,
  configColors,
  components,
  codeSignals,
  styleSourceSignatures,
  root
}) {
  return {
    relevantDependencies: pkg.relevantDependencies,
    tokenFiles: tokenFiles
      .map((entry) => toPosixPath(path.relative(root, entry.path)))
      .sort(),
    cssVars: Object.fromEntries(
      Object.entries(cssVars).map(([category, entries]) => [
        category,
        [...entries].sort(compareNamedValues)
      ])
    ),
    configColors: [...configColors].sort(compareNamedValues),
    styleSourceSignatures,
    components: [...components.found]
      .map(({ name, path: componentPath }) => ({ name, path: componentPath }))
      .sort((a, b) => `${a.name}:${a.path}`.localeCompare(`${b.name}:${b.path}`)),
    codeSignals
  };
}

async function readGraphEvidence({ root, graphEvidencePath, inputFingerprint }) {
  const filePath = graphEvidencePath
    ? path.resolve(root, graphEvidencePath)
    : path.join(root, SNAPSHOT_DIR, GRAPH_EVIDENCE_FILE);
  const relativePath = toPosixPath(path.relative(root, filePath));
  const evidence = await readJsonSafe(filePath);
  if (!evidence.exists) {
    return {
      status: "missing",
      path: relativePath,
      provider: null,
      fingerprint: null,
      signature: null,
      reason: "未提供可选图谱证据。"
    };
  }
  if (!evidence.value || evidence.value.schemaVersion !== GRAPH_EVIDENCE_SCHEMA_VERSION) {
    return {
      status: "invalid",
      path: relativePath,
      provider: evidence.value?.provider || null,
      fingerprint: null,
      signature: null,
      reason: `图谱证据 schemaVersion 必须为 ${GRAPH_EVIDENCE_SCHEMA_VERSION}。`
    };
  }
  if (evidence.value.inputFingerprint !== inputFingerprint) {
    return {
      status: "stale",
      path: relativePath,
      provider: evidence.value.provider || null,
      fingerprint: null,
      signature: null,
      reason: "图谱证据对应的 UI 输入已变化。"
    };
  }
  const signature = normalizeGraphEvidence(evidence.value);
  return {
    status: "valid",
    path: relativePath,
    provider: evidence.value.provider || "unknown",
    fingerprint: hashValue(signature),
    signature,
    reason: "图谱证据与当前 UI 输入匹配。"
  };
}

function normalizeGraphEvidence(evidence) {
  return {
    sharedComponents: normalizeGraphEntries(evidence.sharedComponents, (entry) => ({
      name: String(entry.name || "").trim(),
      path: normalizeOptionalPath(entry.path),
      usage: normalizeUsage(entry.usage || entry.classification, entry.callers)
    })),
    layouts: normalizeGraphEntries(evidence.layouts, (entry) => ({
      name: String(entry.name || "").trim(),
      path: normalizeOptionalPath(entry.path)
    })),
    pagePatterns: normalizeGraphEntries(evidence.pagePatterns, (entry) => ({
      name: String(entry.name || "").trim(),
      usage: normalizeUsage(entry.usage || entry.classification, entry.callers),
      components: Array.isArray(entry.components)
        ? [...new Set(entry.components.map(String))].sort()
        : []
    }))
  };
}

function normalizeGraphEntries(entries, mapper) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map(mapper)
    .filter((entry) => entry.name)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function normalizeUsage(value, callers) {
  if (["unused", "local-example", "shared-pattern"].includes(value)) return value;
  const numericCount = Number(callers);
  const count = Array.isArray(callers)
    ? callers.length
    : Number.isFinite(numericCount) ? numericCount : 0;
  if (count <= 0) return "unused";
  if (count === 1) return "local-example";
  return "shared-pattern";
}

function normalizeOptionalPath(value) {
  return value ? toPosixPath(String(value).trim()) : "";
}

async function inspectInferenceCache({ root, fingerprints, graphEvidence, forceRefresh }) {
  const inferredPath = path.join(root, SNAPSHOT_DIR, INFERRED_REFERENCE_FILE);
  const metaPath = path.join(root, SNAPSHOT_DIR, INFERENCE_META_FILE);
  if (forceRefresh) {
    return cacheResult("forced-refresh", "用户显式要求刷新机器推断。", inferredPath, metaPath);
  }
  const inferredText = await readUtf8Safe(inferredPath);
  const metadata = await readJsonSafe(metaPath);
  if (!inferredText.trim() || !metadata.exists) {
    return cacheResult("missing", "尚未生成可复用的机器推断参考。", inferredPath, metaPath);
  }
  const meta = metadata.value;
  if (!meta || typeof meta !== "object") {
    return cacheResult("invalid", "推断缓存元数据不是有效 JSON 对象。", inferredPath, metaPath);
  }
  if (
    meta.schemaVersion !== INFERENCE_SCHEMA_VERSION ||
    meta.inferenceVersion !== INFERENCE_VERSION
  ) {
    return cacheResult("stale-version", "推断 schema 或规则版本已变化。", inferredPath, metaPath);
  }
  if (meta.staticSemanticFingerprint !== fingerprints.staticSemantic) {
    return cacheResult("stale-semantic", "静态 UI 语义已经变化。", inferredPath, metaPath);
  }

  const inputMatches = meta.inputFingerprint === fingerprints.input;
  if (graphEvidence.status === "valid") {
    if (meta.graphFingerprint !== graphEvidence.fingerprint) {
      return cacheResult("stale-graph", "可用图谱证据与上次推断不同。", inferredPath, metaPath);
    }
  } else if (!inputMatches && meta.graphFingerprint) {
    return cacheResult(
      "graph-refresh-required",
      "UI 输入变化，但上次推断使用过图谱证据；刷新图谱证据后再判断。",
      inferredPath,
      metaPath
    );
  }

  if (inputMatches) {
    return cacheResult("valid", "UI 输入和语义均未变化，可直接复用。", inferredPath, metaPath);
  }
  return cacheResult(
    "reusable",
    "相关文件发生变化，但归一化 UI 语义未变化，可继续复用。",
    inferredPath,
    metaPath
  );
}

function cacheResult(status, reason, inferredPath, metaPath) {
  return {
    status,
    reason,
    inferredPath: toPosixPath(inferredPath),
    metaPath: toPosixPath(metaPath)
  };
}

function summarizeGraphEvidence(graphEvidence) {
  return {
    status: graphEvidence.status,
    path: graphEvidence.path,
    provider: graphEvidence.provider,
    fingerprint: graphEvidence.fingerprint,
    reason: graphEvidence.reason
  };
}

function renderGraphEvidenceStatus(graphEvidence) {
  const provider = graphEvidence.provider ? `，provider=${graphEvidence.provider}` : "";
  return `${graphEvidence.status}${provider} — ${graphEvidence.reason}`;
}

function compareNamedValues(a, b) {
  return `${a.name || ""}:${a.value || ""}`.localeCompare(
    `${b.name || ""}:${b.value || ""}`
  );
}

function hashBuffer(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashValue(value) {
  return hashBuffer(Buffer.from(stableStringify(value), "utf8"));
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])])
  );
}

async function readJsonSafe(filePath) {
  const text = await readUtf8Safe(filePath);
  if (!text) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(text) };
  } catch {
    return { exists: true, value: null };
  }
}

function buildPalette(cssVarColors, configColors) {
  const seen = new Set();
  const palette = [];
  for (const entry of [...cssVarColors, ...configColors]) {
    const value = String(entry.value || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push({ name: entry.name || "", value });
    if (palette.length >= 32) break;
  }
  return palette;
}

async function readUiReference(root) {
  const dir = path.join(root, ".ui-reference");
  const entries = await listDirSafe(dir);
  if (!entries) {
    return { exists: false, dir: ".ui-reference", files: [] };
  }
  const files = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const filePath = path.join(dir, entry);
    const info = await statSafe(filePath);
    if (!info || !info.isFile()) continue;
    const preview = await readFilePreview(filePath, 160);
    files.push({
      name: entry,
      path: toPosixPath(path.relative(root, filePath)),
      preview
    });
  }
  return { exists: true, dir: ".ui-reference", files };
}

async function readPackageJson(root) {
  const pkgPath = path.join(root, "package.json");
  const text = await readUtf8Safe(pkgPath);
  if (!text) {
    return {
      exists: false,
      dependencies: [],
      relevantDependencies: {},
      uiLibs: [],
      iconLibs: [],
      stylingLibs: []
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return {
      exists: false,
      dependencies: [],
      relevantDependencies: {},
      uiLibs: [],
      iconLibs: [],
      stylingLibs: []
    };
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return {
    exists: true,
    dependencies: Object.keys(deps).sort(),
    relevantDependencies: selectRelevantDependencies(deps),
    uiLibs: matchLibs(deps, UI_LIBS),
    iconLibs: matchLibs(deps, ICON_LIBS),
    stylingLibs: matchLibs(deps, STYLING_LIBS)
  };
}

function selectRelevantDependencies(deps) {
  const relevantNames = new Set([
    ...Object.keys(UI_LIBS),
    ...Object.keys(ICON_LIBS),
    ...Object.keys(STYLING_LIBS)
  ]);
  return Object.fromEntries(
    Object.keys(deps)
      .filter((name) => relevantNames.has(name))
      .sort()
      .map((name) => [name, deps[name]])
  );
}

function matchLibs(deps, table) {
  const found = new Set();
  for (const dep of Object.keys(deps)) {
    if (table[dep]) found.add(table[dep]);
  }
  return [...found].sort();
}

async function findTokenFiles(root) {
  const results = [];
  const candidates = [
    root,
    path.join(root, "src"),
    path.join(root, "config"),
    path.join(root, "theme"),
    path.join(root, "src", "theme"),
    path.join(root, "styles"),
    path.join(root, "src", "styles")
  ];
  for (const dir of candidates) {
    const entries = await listDirSafe(dir);
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const ext = path.extname(entry);
      if (!ext) continue;
      const base = entry.slice(0, -ext.length);
      if (!TOKEN_BASENAMES.some((name) => base === name || base.startsWith(`${name}.`))) continue;
      if (!TOKEN_EXTS.includes(ext)) continue;
      results.push({ path: path.join(dir, entry) });
    }
  }
  return results;
}

async function collectStyleFiles(root) {
  const roots = ["src", "app", "styles"].map((rel) => path.join(root, rel));
  const files = [];
  for (const start of roots) {
    if (!(await statSafe(start))) continue;
    await walkStyle(start, 0, 6, files);
    if (files.length >= MAX_STYLE_FILES) break;
  }
  return files.slice(0, MAX_STYLE_FILES);
}

async function walkStyle(dir, depth, maxDepth, files) {
  if (depth > maxDepth || files.length >= MAX_STYLE_FILES) return;
  const entries = await listDirSafe(dir);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = await statSafe(full);
    if (!info) continue;
    if (info.isDirectory()) {
      await walkStyle(full, depth + 1, maxDepth, files);
    } else if (info.isFile() && isStyleFile(entry)) {
      files.push({ path: full });
      if (files.length >= MAX_STYLE_FILES) return;
    }
  }
}

function isStyleFile(name) {
  const ext = path.extname(name);
  if (STYLE_EXTS.has(ext)) return true;
  return /\.(css|scss|less)\.(ts|js|cjs|mjs)$/.test(name);
}

async function collectCssVars(styleFiles) {
  const buckets = {
    colors: [],
    radii: [],
    spacing: [],
    fonts: [],
    shadows: [],
    borders: [],
    other: []
  };
  const seen = new Set();
  const re = /--([A-Za-z0-9_-]+)\s*:\s*([^;}\n]+?)\s*[;}]/g;
  for (const file of styleFiles) {
    const text = await readUtf8Safe(file.path);
    if (!text) continue;
    let match;
    while ((match = re.exec(text)) !== null) {
      const name = match[1];
      const value = match[2].trim();
      const key = `${name}=${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const category = categorizeVar(name, value);
      buckets[category].push({ name: `--${name}`, value });
    }
  }
  for (const key of Object.keys(buckets)) {
    buckets[key] = buckets[key].slice(0, 48);
  }
  return buckets;
}

function categorizeVar(name, value) {
  const n = name.toLowerCase();
  const v = value.toLowerCase().trim();
  const isColorValue = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|color-mix\(|color\()/.test(v);
  if (/(radius|rounded|corner)/.test(n)) return "radii";
  if (/(spacing|space|gap|pad|margin|offset|inset|gutter)/.test(n)) return "spacing";
  if (/(shadow|elevation)/.test(n)) return "shadows";
  if (/(font|family|typo|text-size|font-size|weight|leading|line-height|tracking|letter)/.test(n)) return "fonts";
  if (
    /(color|colour|primary|secondary|accent|neutral|muted|background|bg-|foreground|fg-|surface|brand|success|warning|danger|error|info|fill|tint)/.test(n) ||
    isColorValue
  ) {
    return "colors";
  }
  if (/(border|outline|ring|divider|stroke)/.test(n)) return "borders";
  return "other";
}

async function collectConfigColors(tokenFiles) {
  const colors = [];
  const seen = new Set();
  const namedRe =
    /(['"]?)([A-Za-z0-9_-]+)\1\s*:\s*['"]?\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))/g;
  for (const file of tokenFiles) {
    const text = await readUtf8Safe(file.path);
    if (!text) continue;
    let match;
    while ((match = namedRe.exec(text)) !== null) {
      const name = match[2];
      const value = match[3];
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push({ name, value });
    }
  }
  return colors.slice(0, 32);
}

async function findComponents(root) {
  const found = [];
  const foundNames = new Set();
  const scannedDirs = [];
  for (const rel of COMPONENT_DIRS) {
    const dir = path.join(root, rel);
    if (!(await statSafe(dir))) continue;
    scannedDirs.push(toPosixPath(path.relative(root, dir)));
    await scanComponents(dir, root, 0, 2, found, foundNames);
  }
  return {
    dirs: scannedDirs,
    found: found.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function scanComponents(dir, root, depth, maxDepth, found, foundNames) {
  if (depth > maxDepth) return;
  const entries = await listDirSafe(dir);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = await statSafe(full);
    if (!info) continue;
    if (info.isDirectory()) {
      if (COMPONENT_NAMES.includes(entry) && !foundNames.has(entry)) {
        foundNames.add(entry);
        found.push({ name: entry, path: toPosixPath(path.relative(root, full)) });
      }
      await scanComponents(full, root, depth + 1, maxDepth, found, foundNames);
    } else if (info.isFile()) {
      const ext = path.extname(entry);
      const stem = ext ? entry.slice(0, -ext.length) : entry;
      if (COMPONENT_NAMES.includes(stem) && !foundNames.has(stem)) {
        foundNames.add(stem);
        found.push({ name: stem, path: toPosixPath(path.relative(root, full)) });
      }
    }
  }
}

async function readUtf8Safe(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function listDirSafe(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function statSafe(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readFilePreview(filePath, max) {
  const text = await readUtf8Safe(filePath);
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, "/");
}

function toIso(now) {
  return now.toISOString().replace(".000Z", "Z");
}

function listOrNone(items) {
  if (!items || items.length === 0) return "- 未检测到。";
  return items.map((item) => `- ${item}`).join("\n");
}

function varsOrNone(vars) {
  if (!vars || vars.length === 0) return "- 未检测到。";
  return vars.map((v) => `- \`${v.name}\`: \`${v.value}\``).join("\n");
}

function colorLinesOrNone(cssVarColors, configColors) {
  const seen = new Set();
  const rows = [];
  for (const entry of [...cssVarColors, ...configColors]) {
    const value = String(entry.value || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`- ${entry.name ? `\`${entry.name}\`` : "(未命名)"}: \`${value}\``);
    if (rows.length >= 32) break;
  }
  if (rows.length === 0) return "- 未检测到颜色 token。";
  return rows.join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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

function formatSummaryLine(snapshot) {
  const parts = [`风格来源: ${snapshot.sources}`];
  if (snapshot.packageJson.uiLibs.length) {
    parts.push(`组件库: ${snapshot.packageJson.uiLibs.join("/")}`);
  }
  if (snapshot.packageJson.stylingLibs.length) {
    parts.push(`CSS: ${snapshot.packageJson.stylingLibs.join("/")}`);
  }
  parts.push(`可复用组件: ${snapshot.components.found.length}`);
  parts.push(`token 文件: ${snapshot.tokenFiles.length}`);
  parts.push(`颜色: ${snapshot.cssVars.colors.length + snapshot.configColors.length}`);
  parts.push(`推断缓存: ${snapshot.inferenceCache.status}`);
  return `${parts.join(" | ")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root || process.cwd());
  if (args.recordInference && args.noWrite) {
    throw new Error("--record-inference 不能与 --no-write 同时使用。");
  }
  const snapshot = await discoverStyle({
    root,
    graphEvidencePath: args.graphEvidence,
    forceRefresh: Boolean(args.forceRefresh)
  });

  if (args.recordInference) {
    const recorded = await recordInferenceCache({ root, snapshot });
    snapshot.inferenceCache = cacheResult(
      "valid",
      "已记录当前机器推断及其 UI 语义指纹。",
      path.join(root, SNAPSHOT_DIR, INFERRED_REFERENCE_FILE),
      recorded.path
    );
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }

  const markdown = renderSnapshotMarkdown(snapshot);
  if (!args.noWrite) {
    const outFile = args.output
      ? path.resolve(args.output)
      : path.join(root, SNAPSHOT_DIR, SNAPSHOT_FILE);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, `${markdown.trimEnd()}\n`, "utf8");
    const rel = toPosixPath(path.relative(root, outFile)) || path.basename(outFile);
    process.stdout.write(`UI 风格快照已写入: ${rel}\n`);
  }
  if (args.recordInference) {
    process.stdout.write(`机器推断缓存已记录: ${SNAPSHOT_DIR}/${INFERENCE_META_FILE}\n`);
  }
  process.stdout.write(formatSummaryLine(snapshot));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
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
const SNAPSHOT_DIR = ".ai-ui";
const SNAPSHOT_FILE = "style-snapshot.md";

export async function discoverStyle({ root = process.cwd(), now = new Date() } = {}) {
  const resolvedRoot = path.resolve(root);
  const uiReference = await readUiReference(resolvedRoot);
  const pkg = await readPackageJson(resolvedRoot);
  const tokenFiles = await findTokenFiles(resolvedRoot);
  const styleFiles = await collectStyleFiles(resolvedRoot);
  const cssVars = await collectCssVars(styleFiles);
  const configColors = await collectConfigColors(tokenFiles);
  const components = await findComponents(resolvedRoot);

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
    palette: buildPalette(cssVars.colors, configColors)
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

  lines.push("## 原型适配说明");
  lines.push("- 实现时填充：保留原型的产品意图与交互，把颜色、圆角、间距、字体和控件适配到上面的项目风格。");
  lines.push("");

  return lines.join("\n");
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
    return { exists: false, dependencies: [], uiLibs: [], iconLibs: [], stylingLibs: [] };
  }
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return { exists: false, dependencies: [], uiLibs: [], iconLibs: [], stylingLibs: [] };
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return {
    exists: true,
    dependencies: Object.keys(deps).sort(),
    uiLibs: matchLibs(deps, UI_LIBS),
    iconLibs: matchLibs(deps, ICON_LIBS),
    stylingLibs: matchLibs(deps, STYLING_LIBS)
  };
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
  const candidates = [root, path.join(root, "src"), path.join(root, "config")];
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
  return `${parts.join(" | ")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root || process.cwd());
  const snapshot = await discoverStyle({ root });

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
  process.stdout.write(formatSummaryLine(snapshot));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

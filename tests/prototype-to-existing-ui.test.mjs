import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  discoverStyle,
  recordInferenceCache,
  renderSnapshotMarkdown
} from "../skills/prototype-to-existing-ui/scripts/discover-style.mjs";
import { installSkills } from "../scripts/install-skills.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(
  "skills/prototype-to-existing-ui/scripts/discover-style.mjs"
);

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prototype-ui-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

async function seedProject(dir) {
  await mkdir(path.join(dir, ".ui-reference"), { recursive: true });
  await writeFile(
    path.join(dir, ".ui-reference", "style.md"),
    "# Style\n项目使用青色主色和 8px 圆角。\n",
    "utf8"
  );
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo",
        dependencies: {
          antd: "^5.0.0",
          "lucide-react": "^0.4.0",
          tailwindcss: "^3.4.0"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(dir, "tailwind.config.js"),
    [
      "module.exports = {",
      "  theme: {",
      "    colors: { primary: '#0891b2', accent: '#f59e0b' },",
      "    borderRadius: { lg: '0.5rem' }",
      "  }",
      "};"
    ].join("\n"),
    "utf8"
  );
  await mkdir(path.join(dir, "src", "styles"), { recursive: true });
  await writeFile(
    path.join(dir, "src", "styles", "tokens.css"),
    [
      ":root {",
      "  --color-primary: #0891b2;",
      "  --radius-md: 0.375rem;",
      "  --font-sans: 'Inter', sans-serif;",
      "  --spacing-4: 1rem;",
      "  --shadow-card: 0 1px 2px rgba(0,0,0,0.1);",
      "}"
    ].join("\n"),
    "utf8"
  );
  await mkdir(path.join(dir, "src", "components"), { recursive: true });
  await writeFile(
    path.join(dir, "src", "components", "Button.tsx"),
    "export const Button = () => null;",
    "utf8"
  );
  await writeFile(
    path.join(dir, "src", "components", "Modal.tsx"),
    "export const Modal = () => null;",
    "utf8"
  );
}

test("discoverStyle detects ui-reference, libs, tokens, and components", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const snapshot = await discoverStyle({
      root: dir,
      now: new Date("2026-07-09T08:00:00Z")
    });

    assert.equal(snapshot.generatedAt, "2026-07-09T08:00:00Z");
    assert.equal(snapshot.uiReference.exists, true);
    assert.ok(snapshot.uiReference.files.some((file) => file.name === "style.md"));
    assert.ok(snapshot.packageJson.uiLibs.includes("Ant Design"));
    assert.ok(snapshot.packageJson.iconLibs.includes("Lucide"));
    assert.ok(snapshot.packageJson.stylingLibs.includes("Tailwind CSS"));
    assert.ok(
      snapshot.tokenFiles.some((file) => file.endsWith("tailwind.config.js"))
    );
    assert.ok(
      snapshot.cssVars.colors.some(
        (entry) => entry.name === "--color-primary" && entry.value === "#0891b2"
      )
    );
    assert.ok(snapshot.cssVars.radii.some((entry) => entry.name === "--radius-md"));
    assert.ok(snapshot.cssVars.fonts.some((entry) => entry.name === "--font-sans"));
    assert.ok(snapshot.cssVars.shadows.some((entry) => entry.name === "--shadow-card"));
    assert.ok(
      snapshot.configColors.some(
        (entry) => entry.value.toLowerCase() === "#0891b2"
      )
    );
    assert.ok(snapshot.components.found.some((entry) => entry.name === "Button"));
    assert.ok(snapshot.components.found.some((entry) => entry.name === "Modal"));
    assert.ok(snapshot.sources.includes(".ui-reference/"));
    assert.ok(snapshot.sources.includes("代码库"));
  });
});

test("renderSnapshotMarkdown produces a readable summary", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const snapshot = await discoverStyle({
      root: dir,
      now: new Date("2026-07-09T08:00:00Z")
    });
    const markdown = renderSnapshotMarkdown(snapshot);

    assert.match(markdown, /# UI 风格快照/);
    assert.match(markdown, /## 组件库[\s\S]*- Ant Design/);
    assert.match(markdown, /## 图标体系[\s\S]*- Lucide/);
    assert.match(markdown, /--color-primary/);
    assert.match(markdown, /## 可复用组件[\s\S]*Button/);
    assert.match(markdown, /## token 来源文件[\s\S]*tailwind\.config\.js/);
  });
});

test("CLI writes .ai-ui/style-snapshot.md by default", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const result = await execFileAsync(process.execPath, [scriptPath, "--root", dir]);

    assert.match(result.stdout, /UI 风格快照已写入: \.ai-ui\/style-snapshot\.md/);
    const text = await readFile(path.join(dir, ".ai-ui", "style-snapshot.md"), "utf8");
    assert.match(text, /Ant Design/);
    assert.match(text, /Button/);
    assert.match(text, /风格来源: \.ui-reference\/ \+ 代码库/);
  });
});

test("CLI --no-write --json emits JSON without writing a file", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      "--root",
      dir,
      "--no-write",
      "--json"
    ]);

    const snapshot = JSON.parse(result.stdout);
    assert.ok(snapshot.packageJson.uiLibs.includes("Ant Design"));
    assert.ok(snapshot.components.found.some((entry) => entry.name === "Button"));
    await assert.rejects(
      () => stat(path.join(dir, ".ai-ui", "style-snapshot.md")),
      /ENOENT/
    );
  });
});

test("CLI --record-inference records cache metadata without invoking a model", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    await mkdir(path.join(dir, ".ai-ui"), { recursive: true });
    await writeFile(
      path.join(dir, ".ai-ui", "inferred-reference.md"),
      "# 推断 UI 参考\n\n> 机器推断，待人工确认。\n",
      "utf8"
    );

    const result = await execFileAsync(process.execPath, [
      scriptPath,
      "--root",
      dir,
      "--record-inference"
    ]);
    assert.match(result.stdout, /机器推断缓存已记录/);

    const metadata = JSON.parse(
      await readFile(path.join(dir, ".ai-ui", "inference-meta.json"), "utf8")
    );
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.inferenceVersion, 1);
    assert.match(metadata.inputFingerprint, /^sha256:/);
    assert.match(metadata.staticSemanticFingerprint, /^sha256:/);
  });
});

test("discoverStyle works without .ui-reference or package.json", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, "src", "components"), { recursive: true });
    await writeFile(
      path.join(dir, "src", "components", "Card.tsx"),
      "export const Card = () => null;",
      "utf8"
    );
    const snapshot = await discoverStyle({
      root: dir,
      now: new Date("2026-07-09T08:00:00Z")
    });

    assert.equal(snapshot.uiReference.exists, false);
    assert.equal(snapshot.packageJson.exists, false);
    assert.ok(snapshot.components.found.some((entry) => entry.name === "Card"));
    assert.equal(snapshot.sources, "代码库");
  });
});

test("fingerprints separate source changes from UI semantic changes", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const first = await discoverStyle({ root: dir });

    await writeFile(
      path.join(dir, "src", "components", "Button.tsx"),
      "// implementation note\nexport const Button = () => null;",
      "utf8"
    );
    const commentOnly = await discoverStyle({ root: dir });

    assert.notEqual(commentOnly.fingerprints.input, first.fingerprints.input);
    assert.equal(
      commentOnly.fingerprints.staticSemantic,
      first.fingerprints.staticSemantic
    );

    const originalConfig = await readFile(path.join(dir, "tailwind.config.js"), "utf8");
    await writeFile(
      path.join(dir, "tailwind.config.js"),
      `// documentation only\n${originalConfig}`,
      "utf8"
    );
    const configCommentOnly = await discoverStyle({ root: dir });
    assert.notEqual(
      configCommentOnly.fingerprints.input,
      commentOnly.fingerprints.input
    );
    assert.equal(
      configCommentOnly.fingerprints.staticSemantic,
      commentOnly.fingerprints.staticSemantic
    );

    await writeFile(
      path.join(dir, "tailwind.config.js"),
      [
        "module.exports = {",
        "  theme: {",
        "    colors: { primary: '#0891b2', accent: '#f59e0b' },",
        "    borderRadius: { lg: '1rem' }",
        "  }",
        "};"
      ].join("\n"),
      "utf8"
    );
    const configChanged = await discoverStyle({ root: dir });
    assert.notEqual(
      configChanged.fingerprints.staticSemantic,
      configCommentOnly.fingerprints.staticSemantic
    );

    await writeFile(
      path.join(dir, "src", "styles", "tokens.css"),
      ":root { --color-primary: #7c3aed; --radius-md: 0.375rem; }\n",
      "utf8"
    );
    const tokenChanged = await discoverStyle({ root: dir });
    assert.notEqual(
      tokenChanged.fingerprints.staticSemantic,
      configChanged.fingerprints.staticSemantic
    );
  });
});

test("inference cache is reused until normalized UI semantics change", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    await mkdir(path.join(dir, ".ai-ui"), { recursive: true });
    await writeFile(
      path.join(dir, ".ai-ui", "inferred-reference.md"),
      "# 推断 UI 参考\n\n> 机器推断，待人工确认。\n",
      "utf8"
    );

    const initial = await discoverStyle({ root: dir });
    await recordInferenceCache({
      root: dir,
      snapshot: initial,
      now: new Date("2026-07-17T08:00:00Z")
    });
    const valid = await discoverStyle({ root: dir });
    assert.equal(valid.inferenceCache.status, "valid");

    await writeFile(
      path.join(dir, "src", "components", "Button.tsx"),
      "// no UI effect\nexport const Button = () => null;",
      "utf8"
    );
    const reusable = await discoverStyle({ root: dir });
    assert.equal(reusable.inferenceCache.status, "reusable");

    await writeFile(
      path.join(dir, "src", "styles", "tokens.css"),
      ":root { --color-primary: #dc2626; --radius-md: 0.75rem; }\n",
      "utf8"
    );
    const stale = await discoverStyle({ root: dir });
    assert.equal(stale.inferenceCache.status, "stale-semantic");

    const forced = await discoverStyle({ root: dir, forceRefresh: true });
    assert.equal(forced.inferenceCache.status, "forced-refresh");
  });
});

test("graph evidence is optional and refreshed only after UI inputs change", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    await mkdir(path.join(dir, ".ai-ui"), { recursive: true });
    await writeFile(
      path.join(dir, ".ai-ui", "inferred-reference.md"),
      "# 推断 UI 参考\n\n> 机器推断，待人工确认。\n",
      "utf8"
    );

    const initial = await discoverStyle({ root: dir });
    const graphPath = path.join(dir, ".ai-ui", "graph-evidence.json");
    const graphEvidence = {
      schemaVersion: 1,
      inputFingerprint: initial.fingerprints.input,
      provider: "codegraph",
      sharedComponents: [
        { name: "Button", path: "src/components/Button.tsx", callers: 3 }
      ],
      layouts: [],
      pagePatterns: []
    };
    await writeFile(graphPath, JSON.stringify(graphEvidence, null, 2), "utf8");

    const withGraph = await discoverStyle({ root: dir });
    assert.equal(withGraph.graphEvidence.status, "valid");
    await recordInferenceCache({ root: dir, snapshot: withGraph });

    graphEvidence.sharedComponents[0].callers = 4;
    await writeFile(graphPath, JSON.stringify(graphEvidence, null, 2), "utf8");
    const sameReuseClass = await discoverStyle({ root: dir });
    assert.equal(sameReuseClass.fingerprints.graph, withGraph.fingerprints.graph);
    assert.equal(sameReuseClass.inferenceCache.status, "valid");

    await writeFile(
      path.join(dir, "src", "components", "Button.tsx"),
      "// graph refresh only\nexport const Button = () => null;",
      "utf8"
    );
    const graphStale = await discoverStyle({ root: dir });
    assert.equal(graphStale.graphEvidence.status, "stale");
    assert.equal(graphStale.inferenceCache.status, "graph-refresh-required");

    graphEvidence.inputFingerprint = graphStale.fingerprints.input;
    await writeFile(graphPath, JSON.stringify(graphEvidence, null, 2), "utf8");
    const graphRefreshed = await discoverStyle({ root: dir });
    assert.equal(graphRefreshed.graphEvidence.status, "valid");
    assert.equal(graphRefreshed.inferenceCache.status, "reusable");
  });
});

test("malformed optional graph fields do not block static discovery", async () => {
  await withTempDir(async (dir) => {
    await seedProject(dir);
    const initial = await discoverStyle({ root: dir });
    await mkdir(path.join(dir, ".ai-ui"), { recursive: true });
    await writeFile(
      path.join(dir, ".ai-ui", "graph-evidence.json"),
      JSON.stringify({
        schemaVersion: 1,
        inputFingerprint: initial.fingerprints.input,
        provider: "custom-graph",
        sharedComponents: [{ name: "Button", callers: { unexpected: true } }],
        pagePatterns: [{ name: "table-page", components: "DataTable" }]
      }),
      "utf8"
    );

    const snapshot = await discoverStyle({ root: dir });
    assert.equal(snapshot.graphEvidence.status, "valid");
    assert.match(snapshot.fingerprints.graph, /^sha256:/);
  });
});

test("install hook writes Prototype to Existing UI AGENTS block", async () => {
  await withTempDir(async (destDir) => {
    const result = await installSkills({
      repoDir: path.resolve("."),
      destDir,
      tool: "codex",
      skills: ["prototype-to-existing-ui"]
    });

    assert.deepEqual(
      result.installScripts.map((entry) => entry.skillName),
      ["prototype-to-existing-ui"]
    );

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.match(agentsText, /<!-- gskills:start prototype-to-existing-ui -->/);
    assert.match(agentsText, /## Prototype to Existing UI/);
    assert.match(agentsText, /- Reuse existing design tokens/);
    assert.match(agentsText, /Treat `\.ui-reference\/` as the human-confirmed source of truth/);
    assert.match(agentsText, /CodeGraph or another code graph only as an optional enhancement/);
    assert.match(agentsText, /<!-- gskills:end prototype-to-existing-ui -->/);

    for (const entry of result.installed) {
      await assert.rejects(
        () => stat(path.join(entry.path, ".gskills")),
        /ENOENT/
      );
    }
  });
});

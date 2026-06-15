import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package exposes the gskills binary without bundling skills", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.deepEqual(packageJson.bin, {
    gskills: "./bin/gskills.mjs"
  });
  assert.ok(Array.isArray(packageJson.files));
  assert.ok(packageJson.files.includes("bin/"));
  assert.ok(packageJson.files.includes("scripts/"));
  assert.ok(!packageJson.files.includes("skills/"));
  assert.notEqual(packageJson.private, true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  getCliAICodingTarget,
  renderAICodingChoices
} from "../scripts/lib/aicoding-select.mjs";

test("uses explicit --aicoding before legacy --tool", () => {
  assert.equal(getCliAICodingTarget({ aicoding: "claude", tool: "cursor" }, { isTTY: true }), "claude");
});

test("keeps --tool as a compatibility alias", () => {
  assert.equal(getCliAICodingTarget({ tool: "cursor" }, { isTTY: true }), "cursor");
});

test("returns null for interactive selection when no target is provided", () => {
  assert.equal(getCliAICodingTarget({}, { isTTY: true }), null);
});

test("uses default target in non-interactive environments", () => {
  assert.equal(getCliAICodingTarget({}, { isTTY: false }), "default");
});

test("renders mainstream AI coding choices", () => {
  const text = renderAICodingChoices();
  assert.match(text, /default/);
  assert.match(text, /codex/);
  assert.match(text, /claude/);
  assert.match(text, /cursor/);
  assert.match(text, /trae/);
  assert.match(text, /windsurf/);
  assert.match(text, /gemini/);
});

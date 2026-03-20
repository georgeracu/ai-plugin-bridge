import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { detectSourceTool } from "../dist/detector.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");

test("detects gemini-cli from gemini-extension.json", () => {
  const result = detectSourceTool(join(FIXTURES, "gemini-cli-full"));
  assert.ok(result);
  assert.equal(result.tool, "gemini-cli");
  assert.equal(result.confidence, "definite");
});

test("detects claude-code from .claude-plugin/plugin.json", () => {
  const result = detectSourceTool(join(FIXTURES, "claude-code-full"));
  assert.ok(result);
  assert.equal(result.tool, "claude-code");
  assert.equal(result.confidence, "definite");
});

test("detects copilot-cli from plugin.json", () => {
  const result = detectSourceTool(join(FIXTURES, "copilot-cli-full"));
  assert.ok(result);
  assert.equal(result.tool, "copilot-cli");
  assert.equal(result.confidence, "definite");
});

test("returns null when no manifest is present", () => {
  const result = detectSourceTool(join(FIXTURES, "no-manifest"));
  assert.equal(result, null);
});

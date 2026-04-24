import { describe, test, } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { scanForAgents } from "../dist/agent-scanner.js";

const FIXTURES = join(import.meta.dirname, "../test/fixtures");
const AGENT_REPO = join(FIXTURES, "agent-repo");

describe("agent-scanner", () => {
  test("finds all agent files and skips non-agents", () => {
    const agents = scanForAgents(AGENT_REPO);
    const names = agents.map((a) => a.frontmatter["name"]);
    assert.ok(names.includes("claude-reviewer"));
    assert.ok(names.includes("copilot-helper"));
    assert.ok(names.includes("simple-agent"));
    assert.ok(names.includes("nested-agent"));
    assert.ok(!names.includes("skip")); // node_modules excluded
    assert.equal(agents.length, 4);
  });

  test("infers claude-code source from Claude-specific frontmatter", () => {
    const agents = scanForAgents(AGENT_REPO);
    const claude = agents.find((a) => a.frontmatter["name"] === "claude-reviewer");
    assert.equal(claude?.inferredSource, "claude-code");
  });

  test("infers copilot-cli source from mcp-servers key", () => {
    const agents = scanForAgents(AGENT_REPO);
    const copilot = agents.find((a) => a.frontmatter["name"] === "copilot-helper");
    assert.equal(copilot?.inferredSource, "copilot-cli");
  });

  test("marks agents with only name+description as ambiguous", () => {
    const agents = scanForAgents(AGENT_REPO);
    const simple = agents.find((a) => a.frontmatter["name"] === "simple-agent");
    assert.equal(simple?.inferredSource, "ambiguous");
  });

  test("detects .agent.md files without frontmatter heuristic", () => {
    const agents = scanForAgents(AGENT_REPO);
    const nested = agents.find((a) => a.frontmatter["name"] === "nested-agent");
    assert.ok(nested);
    assert.equal(nested.path, "nested/deep/another.agent.md");
  });

  test("returns results sorted by path", () => {
    const agents = scanForAgents(AGENT_REPO);
    const paths = agents.map((a) => a.path);
    const sorted = [...paths].sort();
    assert.deepEqual(paths, sorted);
  });

  test("extracts body content after frontmatter", () => {
    const agents = scanForAgents(AGENT_REPO);
    const simple = agents.find((a) => a.frontmatter["name"] === "simple-agent");
    assert.ok(simple?.body.includes("You are a helpful assistant."));
  });

  test("returns empty array for directory with no agents", () => {
    const agents = scanForAgents(join(FIXTURES, "no-manifest"));
    assert.equal(agents.length, 0);
  });

  test("supports --subdir by accepting a subdirectory", () => {
    const agents = scanForAgents(join(AGENT_REPO, "agents"));
    assert.equal(agents.length, 3); // only the agents/ dir, not nested/
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { translateAgent } from "../dist/agent-translator.js";
import type { ScannedAgent } from "../dist/agent-scanner.js";

function makeAgent(overrides: Partial<ScannedAgent> = {}): ScannedAgent {
  return {
    path: "agents/test.md",
    filename: "test.md",
    content: "---\nname: test\ndescription: A test agent\n---\n\nYou are a test agent.",
    frontmatter: { name: "test", description: "A test agent" },
    body: "\nYou are a test agent.",
    inferredSource: "ambiguous",
    ...overrides,
  };
}

describe("agent-translator", () => {
  describe("no-op cases", () => {
    test("returns as-is when inferredSource matches target", () => {
      const agent = makeAgent({ inferredSource: "claude-code" });
      const result = translateAgent(agent, "claude-code");
      assert.equal(result.content, agent.content);
      assert.equal(result.warnings.length, 0);
    });

    test("returns as-is when inferredSource is ambiguous", () => {
      const agent = makeAgent({ inferredSource: "ambiguous" });
      const result = translateAgent(agent, "copilot-cli");
      assert.equal(result.content, agent.content);
      assert.equal(result.warnings.length, 0);
    });

    test("treats missing inferredSource as ambiguous", () => {
      const agent = makeAgent();
      delete (agent as unknown as Record<string, unknown>)["inferredSource"];
      const result = translateAgent(agent, "copilot-cli");
      assert.equal(result.content, agent.content);
    });
  });

  describe("claude-code → copilot-cli", () => {
    test("preserves name and description in frontmatter", () => {
      const agent = makeAgent({
        inferredSource: "claude-code",
        frontmatter: { name: "reviewer", description: "Reviews code", tools: "Read, Grep", model: "sonnet" },
        content: "---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou review code.",
        body: "\nYou review code.",
      });
      const result = translateAgent(agent, "copilot-cli");
      assert.ok(result.content.includes("name: reviewer"));
      assert.ok(result.content.includes("description: Reviews code"));
    });

    test("moves Claude-only fields to comments", () => {
      const agent = makeAgent({
        inferredSource: "claude-code",
        frontmatter: { name: "r", description: "d", tools: "Read, Grep", model: "sonnet" },
        content: "---\nname: r\ndescription: d\ntools: Read, Grep\nmodel: sonnet\n---\n\nBody.",
        body: "\nBody.",
      });
      const result = translateAgent(agent, "copilot-cli");
      assert.ok(result.content.includes("# claude-original-tools:"));
      assert.ok(result.content.includes("# claude-original-model: sonnet"));
      // Should not have tools/model as real frontmatter keys
      assert.ok(!result.content.match(/^tools:/m));
      assert.ok(!result.content.match(/^model:/m));
    });

    test("serialises complex values as JSON in comments", () => {
      const agent = makeAgent({
        inferredSource: "claude-code",
        frontmatter: {
          name: "r", description: "d",
          mcpServers: { playwright: { type: "stdio", command: "npx" } },
        },
        content: "---\nname: r\ndescription: d\n---\n\nBody.",
        body: "\nBody.",
      });
      const result = translateAgent(agent, "copilot-cli");
      assert.ok(result.content.includes('# claude-original-mcpServers: {'));
    });

    test("preserves prompt body unchanged", () => {
      const agent = makeAgent({
        inferredSource: "claude-code",
        frontmatter: { name: "r", description: "d", model: "sonnet" },
        content: "---\nname: r\ndescription: d\nmodel: sonnet\n---\n\nDo the thing.\n\nWith multiple paragraphs.",
        body: "\nDo the thing.\n\nWith multiple paragraphs.",
      });
      const result = translateAgent(agent, "copilot-cli");
      assert.ok(result.content.includes("Do the thing.\n\nWith multiple paragraphs."));
    });

    test("emits warnings for dropped fields", () => {
      const agent = makeAgent({
        inferredSource: "claude-code",
        frontmatter: { name: "r", description: "d", hooks: { PreToolUse: [] } },
        content: "---\nname: r\ndescription: d\n---\n\nBody.",
        body: "\nBody.",
      });
      const result = translateAgent(agent, "copilot-cli");
      assert.ok(result.warnings.length > 0);
      assert.ok(result.warnings.some((w) => w.includes("hooks")));
    });
  });

  describe("copilot-cli → claude-code", () => {
    test("translates mcp-servers to mcpServers", () => {
      const agent = makeAgent({
        inferredSource: "copilot-cli",
        frontmatter: { name: "helper", description: "Helps", "mcp-servers": ["playwright"] },
        content: '---\nname: helper\ndescription: Helps\nmcp-servers:\n  - playwright\n---\n\nYou help.',
        body: "\nYou help.",
      });
      const result = translateAgent(agent, "claude-code");
      assert.ok(result.content.includes("mcpServers:"));
      assert.ok(!result.content.includes("mcp-servers:"));
    });
  });

  describe("round-trip restoration", () => {
    test("restores claude-original comments when translating back to claude-code", () => {
      // Simulate a file that was previously translated Claude → Copilot
      const agent = makeAgent({
        inferredSource: "copilot-cli",
        frontmatter: { name: "r", description: "d" },
        content: "---\n# claude-original-tools: [\"Read\",\"Grep\"]\n# claude-original-model: sonnet\nname: r\ndescription: d\n---\n\nBody.",
        body: "\nBody.",
      });
      const result = translateAgent(agent, "claude-code");
      assert.ok(result.content.includes("tools:"));
      assert.ok(result.content.includes("model: sonnet"));
      // Comments should be consumed, not duplicated
      assert.ok(!result.content.includes("# claude-original-tools:"));
    });
  });
});

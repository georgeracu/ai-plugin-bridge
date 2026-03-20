import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseGeminiCliExtension } from "../dist/parsers/gemini-cli.js";
import { parseClaudeCodePlugin } from "../dist/parsers/claude-code.js";
import { parseCopilotCliPlugin } from "../dist/parsers/copilot-cli.js";
import type { PluginSource } from "../dist/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");

const SOURCE: PluginSource = { repo: "test/fixture", ref: "main" };

// ---------------------------------------------------------------------------
// Gemini CLI parser
// ---------------------------------------------------------------------------

describe("parseGeminiCliExtension", () => {
  test("parses name, version, and description from manifest", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-full"), SOURCE);
    assert.equal(plugin.name, "code-review");
    assert.equal(plugin.version, "1.2.0");
    assert.equal(plugin.description, "AI-powered code review extension");
    assert.equal(plugin.sourceTool, "gemini-cli");
  });

  test("parses MCP server with command and normalises ${extensionPath} args", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-full"), SOURCE);
    assert.equal(plugin.mcpServers.length, 1);
    const server = plugin.mcpServers[0];
    assert.equal(server.name, "review-server");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, ["{{PLUGIN_DIR}}/server.js", "--port", "3000"]);
    assert.deepEqual(server.env, { DEBUG: "1" });
    assert.equal(plugin.parseWarnings, undefined);
  });

  test("parses skills", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-full"), SOURCE);
    assert.equal(plugin.skills.length, 1);
    assert.equal(plugin.skills[0].path, "skills/code-review");
    assert.equal(plugin.skills[0].frontmatter["name"], "code-review");
  });

  test("parses commands", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-full"), SOURCE);
    assert.equal(plugin.commands.length, 1);
    assert.equal(plugin.commands[0].name, "review");
  });

  test("parses context file as GEMINI.md", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-full"), SOURCE);
    assert.ok(plugin.contextFile);
    assert.equal(plugin.contextFile.originalFilename, "GEMINI.md");
    assert.ok(plugin.contextFile.content.includes("code reviews"));
  });

  test("emits parseWarning when MCP server has no command", () => {
    const plugin = parseGeminiCliExtension(join(FIXTURES, "gemini-cli-no-cmd"), SOURCE);
    assert.equal(plugin.mcpServers.length, 1);
    assert.equal(plugin.mcpServers[0].command, undefined);
    assert.ok(Array.isArray(plugin.parseWarnings));
    assert.equal(plugin.parseWarnings!.length, 1);
    assert.ok(plugin.parseWarnings![0].includes("hosted-server"));
    assert.ok(plugin.parseWarnings![0].includes("no command"));
  });
});

// ---------------------------------------------------------------------------
// Claude Code parser
// ---------------------------------------------------------------------------

describe("parseClaudeCodePlugin", () => {
  test("parses name, version, and description from .claude-plugin/plugin.json", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.name, "my-plugin");
    assert.equal(plugin.version, "2.0.0");
    assert.equal(plugin.description, "A Claude Code plugin for testing");
    assert.equal(plugin.sourceTool, "claude-code");
  });

  test("parses MCP server from .mcp.json", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.mcpServers.length, 1);
    assert.equal(plugin.mcpServers[0].name, "my-server");
    assert.equal(plugin.mcpServers[0].command, "node");
    assert.deepEqual(plugin.mcpServers[0].args, ["server.js"]);
  });

  test("parses skills", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.skills.length, 1);
    assert.equal(plugin.skills[0].path, "skills/code-review");
  });

  test("parses agents", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.agents.length, 1);
    assert.equal(plugin.agents[0].filename, "reviewer.md");
    assert.equal(plugin.agents[0].frontmatter["name"], "reviewer");
  });

  test("parses commands", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.commands.length, 1);
    assert.equal(plugin.commands[0].name, "review");
  });

  test("parses hooks.json", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.equal(plugin.hooks.length, 1);
    assert.equal(plugin.hooks[0].sourceTool, "claude-code");
    assert.deepEqual(plugin.hooks[0].raw, { onFileChange: ["lint", "format"] });
  });

  test("parses context file as CLAUDE.md", () => {
    const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
    assert.ok(plugin.contextFile);
    assert.equal(plugin.contextFile.originalFilename, "CLAUDE.md");
    assert.ok(plugin.contextFile.content.includes("code review"));
  });
});

// ---------------------------------------------------------------------------
// Copilot CLI parser
// ---------------------------------------------------------------------------

describe("parseCopilotCliPlugin", () => {
  test("parses name, version, and description from plugin.json", () => {
    const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
    assert.equal(plugin.name, "copilot-plugin");
    assert.equal(plugin.version, "1.5.0");
    assert.equal(plugin.description, "A Copilot CLI plugin for testing");
    assert.equal(plugin.sourceTool, "copilot-cli");
  });

  test("parses agents from the directory named in manifest", () => {
    const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
    assert.equal(plugin.agents.length, 1);
    assert.equal(plugin.agents[0].filename, "reviewer.md");
  });

  test("parses skills", () => {
    const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
    assert.equal(plugin.skills.length, 1);
    assert.equal(plugin.skills[0].frontmatter["name"], "code-review");
  });

  test("parses context file as .copilot-instructions.md", () => {
    const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
    assert.ok(plugin.contextFile);
    assert.equal(plugin.contextFile.originalFilename, ".copilot-instructions.md");
    assert.ok(plugin.contextFile.content.includes("correctness"));
  });

  test("has no commands (copilot-cli uses agents instead)", () => {
    const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
    assert.equal(plugin.commands.length, 0);
  });
});

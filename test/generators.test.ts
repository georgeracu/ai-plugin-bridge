import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateClaudeCodePlugin } from "../dist/generators/claude-code.js";
import { generateGeminiCliExtension } from "../dist/generators/gemini-cli.js";
import { generateCopilotCliPlugin } from "../dist/generators/copilot-cli.js";
import type { UniversalPlugin, PluginSource } from "../dist/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE: PluginSource = { repo: "test/fixture", ref: "main" };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Build a minimal but complete UniversalPlugin for generator tests. */
function makePlugin(overrides: Partial<UniversalPlugin> = {}): UniversalPlugin {
  return {
    name: "test-plugin",
    version: "1.0.0",
    description: "A test plugin",
    sourceTool: "gemini-cli",
    source: SOURCE,
    mcpServers: [{ name: "my-server", command: "node", args: ["server.js"] }],
    skills: [{ path: "skills/my-skill", content: "---\nname: my-skill\n---\n# Skill", frontmatter: { name: "my-skill" } }],
    agents: [{ filename: "agent.md", content: "---\nname: agent\n---\n# Agent", frontmatter: { name: "agent" } }],
    commands: [{ name: "run", path: "commands/run.md", content: "Run the task." }],
    hooks: [],
    contextFile: { content: "# Context\nTest context.", originalFilename: "GEMINI.md" },
    extraFiles: [],
    ...overrides,
  };
}

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aib-test-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Claude Code generator
// ---------------------------------------------------------------------------

describe("generateClaudeCodePlugin", () => {
  test("writes .claude-plugin/plugin.json with name, version, description", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    const manifest = readJson(join(out, ".claude-plugin", "plugin.json")) as Record<string, string>;
    assert.equal(manifest.name, "test-plugin");
    assert.equal(manifest.version, "1.0.0");
    assert.equal(manifest.description, "A test plugin");
  });

  test("writes .mcp.json with command and args", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    const mcp = readJson(join(out, ".mcp.json")) as { mcpServers: Record<string, unknown> };
    assert.ok(mcp.mcpServers["my-server"]);
    assert.equal((mcp.mcpServers["my-server"] as Record<string, unknown>)["command"], "node");
  });

  test("writes skill SKILL.md", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, "skills", "my-skill", "SKILL.md")));
  });

  test("writes agent file", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, "agents", "agent.md")));
  });

  test("writes command file", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, "commands", "run.md")));
  });

  test("writes CLAUDE.md from contextFile", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    const content = readFileSync(join(out, "CLAUDE.md"), "utf-8");
    assert.ok(content.includes("Test context."));
  });

  test("writes translation-report.json", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin(), out);
    const report = readJson(join(out, "translation-report.json")) as { targetTool: string };
    assert.equal(report.targetTool, "claude-code");
  });

  test("marks MCP server as partial when command is missing", () => {
    const out = makeTmpDir();
    const plugin = makePlugin({
      mcpServers: [{ name: "hosted", args: [] }],
      parseWarnings: ['MCP server "hosted" has no command field — it cannot be started by any target tool'],
    });
    const report = generateClaudeCodePlugin(plugin, out);
    const mcpComponent = report.components.find((c: { type: string; status: string }) => c.type === "mcp-server");
    assert.ok(mcpComponent);
    assert.equal(mcpComponent.status, "partial");
    assert.ok(report.warnings.some((w: string) => w.includes("hosted")));
  });

  test("omits command field from .mcp.json when it is undefined", () => {
    const out = makeTmpDir();
    generateClaudeCodePlugin(makePlugin({ mcpServers: [{ name: "hosted", args: [] }] }), out);
    const mcp = readJson(join(out, ".mcp.json")) as { mcpServers: Record<string, unknown> };
    const server = mcp.mcpServers["hosted"] as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(server, "command"), false);
  });
});

// ---------------------------------------------------------------------------
// Gemini CLI generator
// ---------------------------------------------------------------------------

describe("generateGeminiCliExtension", () => {
  test("writes gemini-extension.json with name, version, description", () => {
    const out = makeTmpDir();
    generateGeminiCliExtension(makePlugin(), out);
    const manifest = readJson(join(out, "gemini-extension.json")) as Record<string, unknown>;
    assert.equal(manifest.name, "test-plugin");
    assert.equal(manifest.version, "1.0.0");
  });

  test("includes MCP server in gemini-extension.json with ${extensionPath} variable", () => {
    const plugin = makePlugin({
      mcpServers: [{ name: "srv", command: "node", args: ["{{PLUGIN_DIR}}/server.js"] }],
    });
    const out = makeTmpDir();
    generateGeminiCliExtension(plugin, out);
    const manifest = readJson(join(out, "gemini-extension.json")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    assert.ok(manifest.mcpServers["srv"]);
    assert.ok(manifest.mcpServers["srv"].args[0].includes("${extensionPath}"));
  });

  test("writes GEMINI.md from contextFile", () => {
    const out = makeTmpDir();
    generateGeminiCliExtension(makePlugin(), out);
    const content = readFileSync(join(out, "GEMINI.md"), "utf-8");
    assert.ok(content.includes("Test context."));
  });

  test("writes skill SKILL.md", () => {
    const out = makeTmpDir();
    generateGeminiCliExtension(makePlugin(), out);
    assert.ok(existsSync(join(out, "skills", "my-skill", "SKILL.md")));
  });

  test("writes translation-report.json", () => {
    const out = makeTmpDir();
    generateGeminiCliExtension(makePlugin(), out);
    const report = readJson(join(out, "translation-report.json")) as { targetTool: string };
    assert.equal(report.targetTool, "gemini-cli");
  });

  test("marks MCP server as partial when command is missing", () => {
    const out = makeTmpDir();
    const plugin = makePlugin({ mcpServers: [{ name: "hosted", args: [] }] });
    const report = generateGeminiCliExtension(plugin, out);
    const mcpComponent = report.components.find((c: { type: string; status: string }) => c.type === "mcp-server");
    assert.ok(mcpComponent);
    assert.equal(mcpComponent.status, "partial");
  });
});

// ---------------------------------------------------------------------------
// Copilot CLI generator
// ---------------------------------------------------------------------------

describe("generateCopilotCliPlugin", () => {
  test("writes plugin.json with name, version, description", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    const manifest = readJson(join(out, "plugin.json")) as Record<string, string>;
    assert.equal(manifest.name, "test-plugin");
    assert.equal(manifest.version, "1.0.0");
  });

  test("writes agent file to agents/", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, "agents", "agent.agent.md")));
  });

  test("writes skill SKILL.md", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, "skills", "my-skill", "SKILL.md")));
  });

  test("writes .copilot-instructions.md from contextFile", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    const content = readFileSync(join(out, ".copilot-instructions.md"), "utf-8");
    assert.ok(content.includes("Test context."));
  });

  test("writes .mcp.json", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    assert.ok(existsSync(join(out, ".mcp.json")));
  });

  test("writes translation-report.json", () => {
    const out = makeTmpDir();
    generateCopilotCliPlugin(makePlugin(), out);
    const report = readJson(join(out, "translation-report.json")) as { targetTool: string };
    assert.equal(report.targetTool, "copilot-cli");
  });
});

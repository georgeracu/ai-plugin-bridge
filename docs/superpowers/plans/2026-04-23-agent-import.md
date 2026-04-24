# Agent Import & Semantic Translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable semantic agent translation between Claude Code and Copilot CLI formats, plus standalone agent import from git repos.

**Architecture:** Two new modules (`agent-scanner.ts`, `agent-translator.ts`) provide the core logic. The CLI gains an `agent import` subcommand and a fallback in the existing `import` command. Existing generators are updated to call `translateAgent()` instead of copying agents verbatim.

**Tech Stack:** TypeScript, Node.js built-in `fs`/`readline`/`path`, existing `utils.ts` helpers, `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-04-22-agent-import-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent-scanner.ts` | Create | Recursively scan directory for agent `.md` files, detect frontmatter, infer source tool |
| `src/agent-translator.ts` | Create | Translate agent frontmatter between Claude Code ↔ Copilot CLI, comment preservation for round-trips |
| `src/agent-import.ts` | Create | Orchestrate standalone agent import flow: clone, scan, select, translate, install |
| `src/types.ts` | Modify | Add `inferredSource` to `Agent` interface |
| `src/parsers/claude-code.ts` | Modify | Set `inferredSource: "claude-code"` on parsed agents |
| `src/parsers/copilot-cli.ts` | Modify | Set `inferredSource: "copilot-cli"` on parsed agents |
| `src/generators/claude-code.ts` | Modify | Call `translateAgent()` instead of verbatim copy |
| `src/generators/copilot-cli.ts` | Modify | Call `translateAgent()` instead of verbatim copy |
| `src/cli.ts` | Modify | Add `agent import` subcommand, add fallback in `import` |
| `test/agent-scanner.test.ts` | Create | Tests for scanner |
| `test/agent-translator.test.ts` | Create | Tests for translator |
| `test/agent-import.test.ts` | Create | Tests for import orchestration |
| `test/fixtures/agent-repo/` | Create | Fixture directory simulating a git repo with mixed agents |

---

### Task 1: Add `inferredSource` to the Agent type

**Files:**
- Modify: `src/types.ts:44-51`

- [ ] **Step 1: Write the failing test**

In `test/parsers.test.ts`, add a test that checks the existing Claude Code parser sets `inferredSource`:

```typescript
test("claude-code parser sets inferredSource on agents", () => {
  const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
  assert.equal(plugin.agents[0].inferredSource, "claude-code");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `inferredSource` is `undefined`

- [ ] **Step 3: Add `inferredSource` to the Agent interface**

In `src/types.ts`, update the `Agent` interface:

```typescript
export interface Agent {
  /** Filename (e.g. "reviewer.agent.md") */
  filename: string;
  /** Raw file content */
  content: string;
  /** Parsed frontmatter */
  frontmatter: Record<string, unknown>;
  /** Inferred source tool, set by parser or scanner */
  inferredSource?: "claude-code" | "copilot-cli" | "ambiguous";
}
```

- [ ] **Step 4: Set `inferredSource` in the Claude Code parser**

In `src/parsers/claude-code.ts`, in the `parseAgents` function, set the field on each agent:

```typescript
agents.push({ filename: entry, content, frontmatter, inferredSource: "claude-code" });
```

- [ ] **Step 5: Set `inferredSource` in the Copilot CLI parser**

In `src/parsers/copilot-cli.ts`, in the `parseAgents` function:

```typescript
agents.push({ filename: entry, content, frontmatter, inferredSource: "copilot-cli" });
```

- [ ] **Step 6: Add a parallel test for the Copilot parser**

In `test/parsers.test.ts`:

```typescript
test("copilot-cli parser sets inferredSource on agents", () => {
  const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
  assert.equal(plugin.agents[0].inferredSource, "copilot-cli");
});
```

- [ ] **Step 7: Run tests to verify all pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/parsers/claude-code.ts src/parsers/copilot-cli.ts test/parsers.test.ts
git commit -m "feat: add inferredSource field to Agent type"
```

---

### Task 2: Create the agent scanner

**Files:**
- Create: `src/agent-scanner.ts`
- Create: `test/agent-scanner.test.ts`
- Create: `test/fixtures/agent-repo/` (fixture directory)

- [ ] **Step 1: Create test fixtures**

Create `test/fixtures/agent-repo/` with these files:

`test/fixtures/agent-repo/agents/claude-reviewer.md`:
```markdown
---
name: claude-reviewer
description: Reviews code with Claude-specific tools
tools: Read, Grep, Glob
model: sonnet
---

You are an expert code reviewer with read-only access.
```

`test/fixtures/agent-repo/agents/copilot-helper.md` (note: `mcp-servers` is kept as a flat key since the existing `parseFrontmatter()` only handles flat key-value pairs — the scanner only checks for key existence, not parsed values, so this is sufficient for inference):
```markdown
---
name: copilot-helper
description: A Copilot coding assistant
mcp-servers: playwright
---

You help with coding tasks using available tools.
```

`test/fixtures/agent-repo/agents/simple-agent.md`:
```markdown
---
name: simple-agent
description: A minimal agent that works anywhere
---

You are a helpful assistant.
```

`test/fixtures/agent-repo/nested/deep/another.agent.md`:
```markdown
---
name: nested-agent
description: An agent in a nested directory
---

You are nested.
```

`test/fixtures/agent-repo/not-an-agent.md`:
```markdown
# Just a README

This file has no frontmatter with name+description.
```

`test/fixtures/agent-repo/node_modules/skip-me.md`:
```markdown
---
name: skip
description: Should be skipped
---
```

- [ ] **Step 2: Write the failing tests**

Create `test/agent-scanner.test.ts`:

```typescript
import { describe, test, } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { scanForAgents } from "../dist/agent-scanner.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../src/agent-scanner.js` does not exist

- [ ] **Step 4: Implement the agent scanner**

Create `src/agent-scanner.ts`:

```typescript
import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { readTextFile, parseFrontmatter } from "./utils.js";

/** Frontmatter keys that indicate a Claude Code agent. */
const CLAUDE_KEYS = new Set([
  "tools", "model", "permissionMode", "hooks", "mcpServers",
  "maxTurns", "skills", "memory", "effort", "isolation",
  "color", "disallowedTools",
]);

/** Directories to skip when scanning. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

export interface ScannedAgent {
  /** Relative path within the scanned directory */
  path: string;
  /** Basename of the file */
  filename: string;
  /** Raw file content */
  content: string;
  /** Parsed YAML frontmatter */
  frontmatter: Record<string, unknown>;
  /** Prompt content after frontmatter */
  body: string;
  /** Which tool this agent was likely written for */
  inferredSource: "claude-code" | "copilot-cli" | "ambiguous";
}

/**
 * Recursively scan a directory for markdown files that look like agent definitions.
 * Returns results sorted by relative path.
 */
export function scanForAgents(dir: string): ScannedAgent[] {
  const agents: ScannedAgent[] = [];
  walk(dir, dir, agents);
  return agents.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(current: string, root: string, results: ScannedAgent[]): void {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;

    const full = join(current, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(full, root, results);
      continue;
    }

    if (!entry.endsWith(".md")) continue;

    const content = readTextFile(full);
    if (!content) continue;

    const { frontmatter, body } = parseFrontmatter(content);
    const isAgentExt = entry.endsWith(".agent.md");

    // Detection: .agent.md files are always agents; others need name + description
    const hasName = Boolean(frontmatter["name"]);
    const hasDesc = Boolean(frontmatter["description"]);

    if (!isAgentExt && !(hasName && hasDesc)) continue;

    const relPath = relative(root, full);
    const inferredSource = inferSource(frontmatter);

    results.push({
      path: relPath,
      filename: basename(full),
      content,
      frontmatter,
      body,
      inferredSource,
    });
  }
}

function inferSource(
  fm: Record<string, unknown>
): "claude-code" | "copilot-cli" | "ambiguous" {
  for (const key of Object.keys(fm)) {
    if (CLAUDE_KEYS.has(key)) return "claude-code";
  }
  if ("mcp-servers" in fm) return "copilot-cli";
  return "ambiguous";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent-scanner.ts test/agent-scanner.test.ts test/fixtures/agent-repo/
git commit -m "feat: add agent scanner for detecting agent files in repos"
```

---

### Task 3: Create the agent translator

**Files:**
- Create: `src/agent-translator.ts`
- Create: `test/agent-translator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/agent-translator.test.ts`:

```typescript
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
      delete (agent as Record<string, unknown>)["inferredSource"];
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../src/agent-translator.js` does not exist

- [ ] **Step 3: Implement the agent translator**

Create `src/agent-translator.ts`:

```typescript
import type { ScannedAgent } from "./agent-scanner.js";

type AgentTargetTool = "claude-code" | "copilot-cli";

export interface TranslatedAgent {
  filename: string;
  /** Full file content: frontmatter + body */
  content: string;
  /** Translation warnings */
  warnings: string[];
}

/** Frontmatter keys exclusive to Claude Code agents. */
const CLAUDE_ONLY_KEYS = new Set([
  "tools", "model", "permissionMode", "hooks", "mcpServers",
  "maxTurns", "skills", "memory", "effort", "isolation",
  "color", "disallowedTools",
]);

/**
 * Translate an agent between Claude Code and Copilot CLI formats.
 * Returns the agent as-is when no translation is needed.
 */
export function translateAgent(
  agent: ScannedAgent,
  target: AgentTargetTool
): TranslatedAgent {
  const source = agent.inferredSource ?? "ambiguous";

  // No translation needed
  if (source === target || source === "ambiguous") {
    return { filename: agent.filename, content: agent.content, warnings: [] };
  }

  if (source === "claude-code" && target === "copilot-cli") {
    return translateClaudeToCopilot(agent);
  }

  if (source === "copilot-cli" && target === "claude-code") {
    return translateCopilotToClaude(agent);
  }

  // Fallback — should not be reached
  return { filename: agent.filename, content: agent.content, warnings: [] };
}

function translateClaudeToCopilot(agent: ScannedAgent): TranslatedAgent {
  const warnings: string[] = [];
  const kept: Record<string, unknown> = {};
  const comments: string[] = [];

  for (const [key, value] of Object.entries(agent.frontmatter)) {
    if (CLAUDE_ONLY_KEYS.has(key)) {
      const serialised = typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
      comments.push(`# claude-original-${key}: ${serialised}`);
      warnings.push(`${key} preserved as comment — Copilot CLI has no equivalent`);
    } else {
      kept[key] = value;
    }
  }

  const content = buildMarkdown(kept, comments, agent.body);
  return { filename: agent.filename, content, warnings };
}

function translateCopilotToClaude(agent: ScannedAgent): TranslatedAgent {
  const warnings: string[] = [];
  const restored: Record<string, unknown> = {};

  // Parse claude-original comments from the raw content
  const restoredFromComments = extractOriginalComments(agent.content);

  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(agent.frontmatter)) {
    if (key === "mcp-servers") {
      kept["mcpServers"] = value;
      warnings.push("mcp-servers renamed to mcpServers");
    } else {
      kept[key] = value;
    }
  }

  // Merge restored values (they take precedence for keys they define)
  const merged = { ...kept, ...restoredFromComments };

  const content = buildMarkdown(merged, [], agent.body);
  return { filename: agent.filename, content, warnings };
}

/**
 * Extract `# claude-original-<key>: <value>` comments from raw file content.
 * Returns a record of restored key-value pairs.
 */
function extractOriginalComments(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pattern = /^# claude-original-(\S+?):\s*(.+)$/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const key = match[1];
    const raw = match[2].trim();
    // Try JSON parse for complex values, fall back to string
    try {
      result[key] = JSON.parse(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

/**
 * Build a markdown file from frontmatter, optional comment lines, and body.
 */
function buildMarkdown(
  frontmatter: Record<string, unknown>,
  comments: string[],
  body: string
): string {
  const lines: string[] = ["---"];

  // Comments go at the top of the frontmatter block
  for (const c of comments) {
    lines.push(c);
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "object" && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");

  return lines.join("\n") + body;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-translator.ts test/agent-translator.test.ts
git commit -m "feat: add agent translator for Claude/Copilot format conversion"
```

---

### Task 4: Integrate translator into existing generators

**Files:**
- Modify: `src/generators/claude-code.ts`
- Modify: `src/generators/copilot-cli.ts`

- [ ] **Step 1: Write the failing test for Claude Code generator**

In `test/generators.test.ts`, add a test that verifies agents from Copilot source get translated:

```typescript
test("translates copilot-cli agent when generating claude-code output", () => {
  // Create a plugin with a copilot-sourced agent
  const plugin = parseClaudeCodePlugin(join(FIXTURES, "claude-code-full"), SOURCE);
  // Override one agent to simulate copilot source
  plugin.agents = [{
    filename: "helper.md",
    content: '---\nname: helper\ndescription: Helps\nmcp-servers:\n  - playwright\n---\n\nYou help.',
    frontmatter: { name: "helper", description: "Helps", "mcp-servers": ["playwright"] },
    inferredSource: "copilot-cli",
  }];
  generateClaudeCode(plugin, tmpDir);

  const agentContent = readFileSync(join(tmpDir, "agents", "helper.md"), "utf-8");
  assert.ok(agentContent.includes("mcpServers:"));
  assert.ok(!agentContent.includes("mcp-servers:"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — agent is written verbatim, still has `mcp-servers`

- [ ] **Step 3: Update Claude Code generator to use `translateAgent()`**

In `src/generators/claude-code.ts`, find the agent-writing loop and replace the verbatim write with a call through the translator. Import `translateAgent` and `ScannedAgent` adapter. Before writing each agent:

```typescript
import { translateAgent } from "../agent-translator.js";
import { parseFrontmatter } from "../utils.js";

// Inside the agent writing loop, replace:
//   writeFileSync(join(agentsDir, a.filename), a.content);
// With:
const scanned = {
  path: a.filename,
  filename: a.filename,
  content: a.content,
  frontmatter: a.frontmatter,
  body: parseFrontmatter(a.content).body,
  inferredSource: a.inferredSource ?? "ambiguous" as const,
};
const translated = translateAgent(scanned, "claude-code");
writeFileSync(join(agentsDir, translated.filename), translated.content);
for (const w of translated.warnings) {
  report.components.push({ name: a.filename, type: "agent", status: "partial", reason: w });
}
```

Remove the existing `"translated"` report entry for agents — it should only be added when `translated.warnings` is empty.

- [ ] **Step 4: Write the same test for Copilot CLI generator**

In `test/generators.test.ts`:

```typescript
test("translates claude-code agent when generating copilot-cli output", () => {
  const plugin = parseCopilotCliPlugin(join(FIXTURES, "copilot-cli-full"), SOURCE);
  plugin.agents = [{
    filename: "reviewer.md",
    content: '---\nname: reviewer\ndescription: Reviews\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou review.',
    frontmatter: { name: "reviewer", description: "Reviews", tools: "Read, Grep", model: "sonnet" },
    inferredSource: "claude-code",
  }];
  generateCopilotCli(plugin, tmpDir);

  // Note: Copilot generator renames .md to .agent.md
  const agentContent = readFileSync(join(tmpDir, "agents", "reviewer.agent.md"), "utf-8");
  assert.ok(agentContent.includes("# claude-original-tools:"));
  assert.ok(agentContent.includes("# claude-original-model: sonnet"));
});
```

- [ ] **Step 5: Update Copilot CLI generator to use `translateAgent()`**

Same pattern as step 3 but for `src/generators/copilot-cli.ts`, targeting `"copilot-cli"`.

**Important:** The existing Copilot generator already renames `.md` files to `.agent.md` (lines 97-99). This rename logic must be preserved **after** the `translateAgent()` call. Apply the translator first, then apply the existing `.agent.md` rename to `translated.filename`:

```typescript
const translated = translateAgent(scanned, "copilot-cli");
// Preserve existing .agent.md rename
let outFilename = translated.filename;
if (!outFilename.endsWith(".agent.md")) {
  outFilename = outFilename.replace(/\.md$/, ".agent.md");
}
writeFileSync(join(agentsDir, outFilename), translated.content);
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npm test`
Expected: All tests PASS (including existing tests — no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/generators/claude-code.ts src/generators/copilot-cli.ts test/generators.test.ts
git commit -m "feat: use semantic agent translation in generators"
```

---

### Task 5: Create the interactive selection helper

**Files:**
- Create: `src/select.ts`

- [ ] **Step 1: Write the failing test**

Create a minimal test for the selection parser (the part that doesn't need stdin):

```typescript
// In test/agent-import.test.ts (will be expanded in task 7)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseSelection } from "../dist/select.js";

describe("parseSelection", () => {
  test("parses comma-separated numbers", () => {
    assert.deepEqual(parseSelection("1,3,5", 7), [0, 2, 4]);
  });

  test("parses ranges", () => {
    assert.deepEqual(parseSelection("2-4", 5), [1, 2, 3]);
  });

  test("parses mixed input", () => {
    assert.deepEqual(parseSelection("1,3-5,7", 7), [0, 2, 3, 4, 6]);
  });

  test("ignores out-of-range values", () => {
    assert.deepEqual(parseSelection("0,1,99", 3), [0]);
  });

  test("deduplicates", () => {
    assert.deepEqual(parseSelection("1,1,2-3,2", 5), [0, 1, 2]);
  });

  test("returns empty array for empty input", () => {
    assert.deepEqual(parseSelection("", 5), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `../src/select.js` does not exist

- [ ] **Step 3: Implement the selection helper**

Create `src/select.ts`:

```typescript
import * as readline from "node:readline";

/**
 * Parse a user selection string like "1,3,5-7" into zero-based indices.
 * Numbers are 1-based in the UI. Out-of-range values are silently dropped.
 */
export function parseSelection(input: string, count: number): number[] {
  const indices = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= count) indices.add(i - 1);
      }
    } else {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= count) indices.add(n - 1);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

/**
 * Display a numbered list and prompt the user to select items.
 * Returns the selected zero-based indices.
 */
export async function promptSelection(
  items: { label: string }[],
  prompt: string
): Promise<number[]> {
  for (let i = 0; i < items.length; i++) {
    console.log(`  ${i + 1}. ${items[i].label}`);
  }
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${prompt} `, (answer) => {
      rl.close();
      resolve(parseSelection(answer, items.length));
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/select.ts test/agent-import.test.ts
git commit -m "feat: add interactive selection helper for agent import"
```

---

### Task 6: Create the agent import orchestrator

**Files:**
- Create: `src/agent-import.ts`

- [ ] **Step 1: Implement the import orchestrator**

Create `src/agent-import.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { scanForAgents, type ScannedAgent } from "./agent-scanner.js";
import { translateAgent } from "./agent-translator.js";
import { normalizeGitUrl, cloneOrUpdate } from "./utils.js";
import { header, step, ok, warn, fail } from "./output.js";
import { confirm } from "./confirm.js";
import { promptSelection } from "./select.js";

export interface AgentImportOptions {
  source: string;
  subdir?: string;
  ref?: string;
  to?: string;
  all?: boolean;
  project?: string;
}

const UNI_HOME = process.env["AI_PLUGIN_BRIDGE_HOME"] ?? join(homedir(), ".ai-plugin-bridge");

/**
 * Standalone agent import: clone repo, scan for agents, select, translate, install.
 */
export async function importAgents(opts: AgentImportOptions): Promise<void> {
  header("Agent Import");

  // 1. Clone
  const url = normalizeGitUrl(opts.source);
  const repoName = basename(opts.source).replace(/\.git$/, "");
  const sourcesDir = join(UNI_HOME, "sources", repoName);
  step(`Cloning ${url}`);
  cloneOrUpdate(sourcesDir, url, opts.ref ?? "main");
  ok("Repository ready");

  // 2. Scan
  const scanDir = opts.subdir ? join(sourcesDir, opts.subdir) : sourcesDir;
  step("Scanning for agent definitions");
  const agents = scanForAgents(scanDir);

  if (agents.length === 0) {
    fail("No agent definitions found");
    return;
  }
  ok(`Found ${agents.length} agent(s)`);

  // 3. Select
  let selected: ScannedAgent[];
  if (opts.all) {
    selected = agents;
  } else {
    const items = agents.map((a) => ({
      label: `${a.frontmatter["name"] ?? a.filename}  (${a.inferredSource})  ${a.frontmatter["description"] ?? ""}`,
    }));
    console.log();
    const indices = await promptSelection(items, "Select agents (e.g. 1,3,5-7):");
    if (indices.length === 0) {
      fail("No agents selected");
      return;
    }
    selected = indices.map((i) => agents[i]);
  }
  ok(`${selected.length} agent(s) selected`);

  // 4. Determine targets
  const targets = resolveTargets(opts.to);
  if (targets.length === 0) return;

  // 5. Translate and install
  for (const target of targets) {
    const targetDir = getInstallDir(target, opts.project);
    if (!targetDir) continue;

    step(`Installing to ${target}`);
    mkdirSync(targetDir, { recursive: true });

    for (const agent of selected) {
      const result = translateAgent(agent, target);
      writeFileSync(join(targetDir, result.filename), result.content);
      ok(`  ${result.filename}`);
      for (const w of result.warnings) {
        warn(`  ${w}`);
      }
    }
  }

  ok("Agent import complete");
}

function resolveTargets(to?: string): Array<"claude-code" | "copilot-cli"> {
  if (to === "claude-code") return ["claude-code"];
  if (to === "copilot-cli") return ["copilot-cli"];
  if (to === "all") return ["claude-code", "copilot-cli"];
  // Default: both
  return ["claude-code", "copilot-cli"];
}

function getInstallDir(
  target: "claude-code" | "copilot-cli",
  project?: string
): string | null {
  if (target === "claude-code") {
    return join(homedir(), ".claude", "agents");
  }

  // Copilot: project-scoped
  const base = project ?? process.cwd();
  if (!existsSync(join(base, ".git"))) {
    fail(`No git repository at ${base} — use --project to specify a repo path`);
    return null;
  }
  return join(base, ".github", "agents");
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: No compilation errors

- [ ] **Step 3: Commit**

```bash
git add src/agent-import.ts
git commit -m "feat: add agent import orchestrator"
```

---

### Task 7: Wire up the CLI commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the `agent import` subcommand**

In `src/cli.ts`, add a new subcommand group after the existing commands:

```typescript
import { importAgents } from "./agent-import.js";
import { scanForAgents } from "./agent-scanner.js";

// Add agent subcommand group
const agentCmd = program
  .command("agent")
  .description("Manage standalone agents");

agentCmd
  .command("import <source>")
  .description("Import agents from a git repository")
  .option("--subdir <path>", "Only scan a subdirectory of the repo")
  .option("--ref <ref>", "Git reference (branch, tag, SHA) to checkout")
  .option("--to <tool>", "Target tool: claude-code, copilot-cli, or all")
  .option("--all", "Import all detected agents (skip selection)")
  .option("--project <path>", "Project directory for Copilot agent install")
  .action(action(async (source: string, opts: Record<string, string | boolean | undefined>) => {
    await importAgents({
      source,
      subdir: opts["subdir"] as string | undefined,
      ref: opts["ref"] as string | undefined,
      to: opts["to"] as string | undefined,
      all: opts["all"] as boolean | undefined,
      project: opts["project"] as string | undefined,
    });
  }));
```

- [ ] **Step 2: Add agent fallback to the existing `import` command**

**Important context:** The existing `import` command does NOT call `detectSourceTool()` directly. Detection happens inside `translate()` in `src/translator.ts`, which throws an error if no manifest is found. The fallback must be added **before** the `translate()` call in `cli.ts`.

In the import command action (in `src/cli.ts`), add a pre-check before the `translate()` call. Import `detectSourceTool` from `./detector.js`:

```typescript
import { detectSourceTool } from "./detector.js";

// In the import action, BEFORE the existing translate() call:
const detection = detectSourceTool(pluginDir);
if (!detection) {
  const agents = scanForAgents(pluginDir);
  if (agents.length > 0) {
    step(`No plugin manifest found, but detected ${agents.length} agent(s)`);
    const proceed = await confirm("Import as standalone agents?");
    if (proceed) {
      await importAgents({
        source,
        subdir: opts["subdir"] as string | undefined,
        ref: opts["ref"] as string | undefined,
        to: opts["only"] as string | undefined,  // --only forwarded as --to
        all: opts["all"] as boolean | undefined,
      });
      return;
    }
  }
  fatal(new Error(`Could not detect source tool in ${pluginDir}`));
}

// Existing translate() call continues here for the happy path
```

The existing `import` action will need to become `async` if it isn't already. The `detectSourceTool` import is already available — it's exported from `src/detector.ts`.

- [ ] **Step 2b: Update shell completions**

In `src/cli.ts`, find the completions command (around line 941) where commands are hardcoded. Add `"agent"` to the list of commands so shell completions include the new subcommand.

- [ ] **Step 3: Verify CLI help text**

Run: `node dist/cli.js agent import --help`
Expected: Shows the agent import help with all flags

Run: `node dist/cli.js import --help`
Expected: Existing import help (unchanged)

- [ ] **Step 4: Manual smoke test**

Run against a known repo with agents:
```bash
node dist/cli.js agent import anthropics/claude-code --subdir plugins/ralph-wiggum --all --to claude-code
```
Verify agents are written to `~/.claude/agents/`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add 'agent import' CLI command with fallback in 'import'"
```

---

### Task 8: End-to-end verification and cleanup

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run the CLI build**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Test existing plugin import still works**

Run against an existing test plugin to verify no regressions:
```bash
node dist/cli.js import gemini-cli-extensions/code-review
```
Expected: Import succeeds as before

- [ ] **Step 4: Test standalone agent import**

Test against the test repos:
```bash
node dist/cli.js agent import anthropics/claude-code --subdir plugins/ralph-wiggum --all --to claude-code
```
Expected: Agents imported and written to `~/.claude/agents/`

- [ ] **Step 5: Test import fallback to agent scan**

Test against a repo that has agents but no plugin manifest:
```bash
# If such a repo exists; otherwise create a temporary test
```
Expected: Prompt appears offering to import agents

- [ ] **Step 6: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: end-to-end verification and cleanup"
```

# Agent Import & Semantic Translation — Design Spec

**Date:** 2026-04-22
**Status:** Approved
**Scope:** Claude Code + GitHub Copilot CLI (Gemini CLI deferred)

## Overview

Two complementary features for ai-plugin-bridge:

1. **Semantic agent translation** — understand each tool's agent frontmatter schema and translate fields intelligently between Claude Code and Copilot CLI, preserving untranslatable fields as YAML comments for round-trip fidelity.
2. **Standalone agent import** — a new CLI workflow to import individual agents from a git repo (not requiring a full plugin manifest), with interactive selection and direct installation to the target tool's native directory.

## Agent Scanner (`src/agent-scanner.ts`)

**Purpose:** Given a directory, find all `.md` files that look like agent definitions.

### Detection heuristic

A file is an agent if it has YAML frontmatter containing both `name` (or filename-derived name) and `description`.

### Source tool inference

After detection, infer which tool the agent was written for:

- Has any of `tools`, `model`, `permissionMode`, `hooks`, `mcpServers`, `maxTurns`, `skills`, `memory`, `effort`, `isolation`, `color` → **Claude Code**
- Has `mcp-servers` (hyphenated, per Copilot agent profile spec) → **Copilot CLI**
- Has only `name` + `description` + prompt body → **ambiguous** (no translation needed)

Files with `.agent.md` extension are treated as high-confidence agent indicators and skip the frontmatter heuristic check (the extension alone is sufficient).

### Interface

```typescript
interface ScannedAgent {
  path: string;           // relative path within repo
  filename: string;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;           // prompt content after frontmatter
  inferredSource: "claude-code" | "copilot-cli" | "ambiguous";
}

function scanForAgents(dir: string): ScannedAgent[];
```

### Behaviour

- Recursively walks the directory
- Skips `node_modules`, `.git`, `dist/`, dotfiles
- Returns results sorted by path for stable ordering

## Agent Translator (`src/agent-translator.ts`)

**Purpose:** Translate a single agent's frontmatter and body between Claude Code and Copilot CLI formats.

### Claude → Copilot translation

- `name`, `description` → kept as-is
- `tools`, `model`, `permissionMode`, `maxTurns`, `hooks`, `mcpServers`, `skills`, `memory`, `effort`, `isolation`, `color`, `disallowedTools` → preserved as YAML comments (e.g. `# claude-original-tools: Read, Grep, Glob`)
- Prompt body → kept as-is
- Filename: ensure `.md` extension

### Copilot → Claude translation

- `name`, `description` → kept as-is
- `mcp-servers` (hyphenated, per Copilot agent profile spec) → translated to `mcpServers` (key rename + structure adaptation). Note: this field is part of the Copilot agent profile specification; the existing codebase's Copilot parser does not yet handle it since it was added after the parser was written.
- Prompt body → kept as-is
- Filename: kept as-is

### Comment restoration for round-trips

When translating a file that already contains `# claude-original-*` comments, the translator restores those values back into real frontmatter fields (Copilot → Claude direction). This enables lossless round-trips.

### Interface

```typescript
/** Subset of ToolId for agent translation targets. Gemini CLI is excluded
 *  because it has no native agent concept (agents are converted to skills
 *  by the Gemini generator, which is separate logic). Not a new exported type —
 *  local type alias within agent-translator.ts. */
type AgentTargetTool = "claude-code" | "copilot-cli";

interface TranslatedAgent {
  filename: string;
  content: string;        // full file: frontmatter + body
  warnings: string[];     // e.g. "Dropped hooks — Copilot CLI has no equivalent"
}

function translateAgent(
  agent: ScannedAgent,
  target: AgentTargetTool
): TranslatedAgent;
```

### Edge cases

- If `inferredSource` matches `target`, return as-is (no translation needed)
- If `inferredSource` is `"ambiguous"`, return as-is for either target
- Complex values (objects/arrays like `hooks`, `mcpServers`) are serialised as JSON-in-comments: `# claude-original-mcpServers: {"server-name":{"type":"stdio","command":"npx"}}`. JSON is used rather than YAML-in-comments because it is unambiguous to parse from a single comment line and avoids multi-line comment alignment issues. Arrays use JSON array syntax: `# claude-original-tools: ["Read","Grep","Glob"]`. Scalar values remain plain: `# claude-original-model: sonnet`.

## CLI Surface

### `aib agent import <repo-url>`

Explicit agent import command:

1. Clone/shallow-fetch the repo to `~/.ai-plugin-bridge/sources/`
2. Run the scanner on the repo directory
3. If no agents found, report and exit
4. Display numbered list of detected agents with source tool and description
5. Interactive selection — display a numbered list, user types comma-separated numbers or ranges (e.g. `1,3,5-7`). Uses readline (consistent with existing `confirm.ts`), no additional dependencies required.
6. Ask which target tool(s) to install for: Claude Code, Copilot CLI, or both
7. Translate each selected agent for each target
8. Write to native directories:
   - Claude Code: `~/.claude/agents/{filename}` — this is the user-level agents directory, read directly by Claude Code. Standalone agents bypass the plugin marketplace entirely.
   - Copilot CLI: `{cwd}/.github/agents/{filename}` — project-scoped (Copilot agents are per-repo). If no git repo is detected at `{cwd}`, abort with an error message suggesting `--project <path>`.
9. Display summary with any translation warnings

**Note on install path asymmetry:** Claude Code agents install globally (`~/.claude/agents/`), while Copilot agents install per-project (`.github/agents/`). This reflects each tool's native convention.

**Flags:**

- `--all` — skip interactive selection, import every detected agent
- `--to <tool>` — skip target tool prompt (`claude-code`, `copilot-cli`, `all`)
- `--yes` / `-y` — inherited global flag, skips confirmation prompts
- `--subdir <path>` — only scan a subdirectory of the repo
- `--ref <ref>` — pin a git reference (branch, tag, SHA) when cloning (consistent with existing `import` command)
- `--project <path>` — override current working directory for Copilot install location

### Fallback in `aib import <repo-url>`

When the existing `import` command finds **no plugin manifest**:

1. Run the agent scanner on the repo
2. If agents found, prompt: "No plugin manifest found, but detected N agent(s). Import as standalone agents?"
3. If user confirms, hand off to the `aib agent import` flow
4. If no agents found either, fail with the current error message

The `--only` flag from `aib import` is forwarded as `--to` to the agent import flow.

## Integration with Existing Plugin Pipeline

### Changes to generators

Existing generators (`claude-code.ts`, `copilot-cli.ts`) currently copy agent files verbatim. After this feature, each generator calls `translateAgent()` on every agent in the `UniversalPlugin`. Translation warnings are added to `translation-report.json`.

### Type changes

The `Agent` type in `types.ts` gains an optional field:

```typescript
export interface Agent {
  filename: string;
  content: string;
  frontmatter: Record<string, unknown>;
  /** Inferred source tool, set by parser or scanner */
  inferredSource?: "claude-code" | "copilot-cli" | "ambiguous";
}
```

Each parser sets `inferredSource` based on the tool it belongs to. If `inferredSource === target`, `translateAgent()` returns the agent as-is — existing same-tool behaviour is preserved.

**Migration:** `inferredSource` is optional. When absent (e.g. agents in existing `dist/` directories from prior imports), `translateAgent()` treats it as `"ambiguous"` and returns the agent as-is. No migration step is needed — old imports continue to work, and re-importing will populate the field.

### Unchanged

- Gemini CLI generator still converts agents to skills (separate logic)
- Detector, translator orchestration, and sync flow are untouched
- `translation-report.json` format is preserved — agent entries get richer warnings

## Data Flow

### Standalone agent import

```
Git repo URL
  → clone to ~/.ai-plugin-bridge/sources/
  → agent-scanner.ts: recursive scan, detect frontmatter, infer source tool
  → interactive selection (or --all)
  → target tool selection (or --to)
  → agent-translator.ts: translate per target
  → write to native directory
  → display summary + warnings
```

### Plugin import (enhanced)

```
Git repo URL
  → detector.ts (existing)
  → parser (existing, now sets inferredSource on each agent)
  → UniversalPlugin IR (existing)
  → generator (existing, now calls translateAgent() instead of verbatim copy)
  → dist/{tool}/{plugin}/ (existing)
  → translation-report.json (existing, richer agent warnings)
```

## Out of Scope

- Gemini CLI agent support
- Agent registry/sync (standalone agents aren't tracked in `registry.json`)
- `aib agent list` / `aib agent remove` commands
- Updating existing installed agents (re-import overwrites, no diff/merge)

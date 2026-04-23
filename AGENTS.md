# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

## What this project does

`ai-plugin-bridge` is a CLI tool that translates AI coding CLI plugins/extensions between three ecosystems — **Claude Code**, **Gemini CLI**, and **GitHub Copilot CLI** — so a developer can import a plugin once and install it everywhere.

## Build and run

```bash
npm install       # install dependencies
npm run build     # compile TypeScript to dist/
node dist/cli.js  # run the CLI
```

Tests use `node:test` and `assert/strict`. Run `npm test` (builds first, then runs `dist-test/*.test.js`). Tests import from `../dist/`, not `../src/`.

## Architecture

The pipeline is compiler-like:

```
Source repo → Detector → Parser → UniversalPlugin (IR) → Generator (×3) → Native plugin dirs
```

- **`src/detector.ts`** — identifies the source tool by sniffing manifest files (`.claude-plugin/plugin.json`, `gemini-extension.json`, `plugin.json`, `.github/plugin`)
- **`src/parsers/`** — one parser per source tool; each reads the native format and returns a `UniversalPlugin`
- **`src/types.ts`** — defines `UniversalPlugin` (the IR) and all shared types including `Pluginfile`, `SyncResult`, etc.
- **`src/generators/`** — one generator per target tool; each takes a `UniversalPlugin` and writes native files to `dist/`
- **`src/translator.ts`** — orchestrates detect → parse → generate; called by both `import` and `sync`
- **`src/cli.ts`** — all CLI commands (Commander.js); contains helper functions for install/uninstall commands and Claude marketplace management
- **`src/pluginfile.ts`** — parses and validates `pluginfile.yaml`
- **`src/sync.ts`** — orchestrates the `aib sync` workflow: registry diff, registry-first fetch, source fallback, install
- **`src/registry-client.ts`** — clones/pulls a remote registry repo and copies pre-translated plugins to local dist
- **`src/agent-scanner.ts`** — recursively scans a directory for agent `.md` files; infers source tool (Claude/Copilot/ambiguous) from frontmatter keys
- **`src/agent-translator.ts`** — semantic translation of agent frontmatter between Claude Code ↔ Copilot CLI; preserves untranslatable fields as YAML comments for round-trip fidelity
- **`src/agent-import.ts`** — orchestrates standalone agent import: clone → scan → select → translate → install to native directories
- **`src/select.ts`** — interactive multi-select helper (numbered list, comma-separated/range input via readline)

## Key concepts

### UniversalPlugin (IR)

Every source format is parsed into this model (`types.ts`): `mcpServers`, `skills`, `agents`, `commands`, `hooks`, `contextFile`, `extraFiles`. Generators consume it to produce native output.

### Translation rules

| Component   | Approach                                                       |
| ----------- | -------------------------------------------------------------- |
| MCP servers | Config restructuring only — protocol is universal              |
| Skills      | SKILL.md format shared; minor frontmatter tweaks               |
| Agents      | Semantic translation between Claude ↔ Copilot; agents → skills for Gemini CLI |
| Commands    | Commands → agents for Copilot CLI (no slash commands)          |
| Context     | Rename: CLAUDE.md ↔ GEMINI.md ↔ .copilot-instructions.md     |
| Hooks       | Pass through for native tool only; skip with report for others |

### Standalone agent import

`aib agent import <repo>` scans a git repo for agent `.md` files (detected by `name` + `description` frontmatter or `.agent.md` extension) and installs them directly to native tool directories — bypassing the full plugin pipeline. The source tool is inferred from frontmatter keys:

- Claude-specific keys (`tools`, `model`, `hooks`, `mcpServers`, etc.) → Claude Code
- `mcp-servers` (hyphenated) → Copilot CLI
- Only `name` + `description` → ambiguous (no translation needed)

Install targets: `~/.claude/agents/` (Claude, global) and `{cwd}/.github/agents/` (Copilot, per-project). The existing `aib import` command falls back to agent scanning when no plugin manifest is found.

### Agent translation (Claude ↔ Copilot)

When translating Claude → Copilot, Claude-only frontmatter fields are moved to YAML comments (`# claude-original-tools: Read, Grep`). When translating back (Copilot → Claude), those comments are restored to real frontmatter keys. This enables lossless round-trips. Complex values use JSON-in-comments format.

### Path variable normalisation

Parsers normalise `${extensionPath}` / `${/}` (Gemini) to `{{PLUGIN_DIR}}`. Generators expand to target-specific variables.

### Claude Code marketplace

Claude Code uses a marketplace model, not direct directory installs. After every `import` or `sync`, `updateClaudeMarketplace()` (in `generators/claude-code.ts`) regenerates `dist/claude-code/.claude-plugin/marketplace.json`. On first install, `ensureClaudeMarketplace()` (in `cli.ts`) registers that directory as the `ai-plugin-bridge-local` marketplace. Plugins are installed as `<name>@ai-plugin-bridge-local` to avoid collisions with the official marketplace.

### Translation reports

Every generated plugin directory includes `translation-report.json` with per-component `translated` / `partial` / `skipped` status and warnings.

## Runtime data

`~/.ai-plugin-bridge/` (override with `AI_PLUGIN_BRIDGE_HOME`):

```
~/.ai-plugin-bridge/
├── registry.json           # imported plugin metadata
├── registry/               # clone of remote plugin registry (for sync)
├── sources/                # shallow git clones of source repos
└── dist/
    ├── claude-code/
    │   ├── .claude-plugin/marketplace.json  # auto-generated
    │   └── {name}/
    ├── gemini-cli/{name}/
    └── copilot-cli/{name}/
```

## Test plugins

Use these four for manual validation — they cover all source tools and component combinations:

| Source                                                              | Tool        | Key components                          |
| ------------------------------------------------------------------- | ----------- | --------------------------------------- |
| `gemini-cli-extensions/code-review`                                 | Gemini CLI  | commands, skills, GEMINI.md             |
| `gemini-cli-extensions/jules`                                       | Gemini CLI  | MCP server, path variable normalisation |
| `anthropics/claude-code --subdir plugins/ralph-wiggum`              | Claude Code | commands, hooks (tests skip path)       |
| `github/awesome-copilot --subdir plugins/software-engineering-team` | Copilot CLI | agents → skills translation             |

## Code style

- British English in comments and user-facing strings
- Explicit types — `unknown` with narrowing over `any`
- Early returns over deep nesting
- Console output: indented, with status icons `✓ ✗ ◐ ⚠` coloured via chalk
- No symlinks in generated output — all files must be real copies
- Pinned commit SHAs in registry — no implicit latest tracking

## Commit style

- Use Conventional Commits format

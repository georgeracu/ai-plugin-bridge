# uni-plugin

**Universal AI CLI plugin translator — import once, install everywhere.**

Translates plugins/extensions between Claude Code, Gemini CLI, and GitHub Copilot CLI. Write or discover a plugin in one ecosystem, use it in all three.

## Quick start

```bash
npm install
npm run build

# Import a Gemini CLI extension
node dist/cli.js import gemini-cli-extensions/code-review

# Import a Claude Code plugin from a monorepo subdirectory
node dist/cli.js import anthropics/claude-code --subdir plugins/ralph-wiggum

# Import a Copilot CLI plugin
node dist/cli.js import github/awesome-copilot --subdir plugins/software-engineering-team

# See what was translated (and what wasn't)
node dist/cli.js report code-review

# Install to all three tools at once
node dist/cli.js install code-review

# Install to specific tools only
node dist/cli.js install code-review --only claude-code,copilot-cli

# Remove a plugin from all tools
node dist/cli.js remove code-review

# Remove from a specific tool only
node dist/cli.js remove code-review --only gemini-cli

# List everything you've imported
node dist/cli.js list
```

## Declarative sync with pluginfile.yaml

Define your plugins in a `pluginfile.yaml` and sync them all at once:

```yaml
# Optional: pre-translated plugin registry
registry: https://github.com/george/uni-plugin-registry

targets:
  - claude-code
  - gemini-cli
  - copilot-cli

plugins:
  - name: code-review
    source: gemini-cli-extensions/code-review
    ref: main

  - name: jules
    source: gemini-cli-extensions/jules
    ref: v0.1.0

  - name: ralph-wiggum
    source: anthropics/claude-code
    subdir: plugins/ralph-wiggum
    ref: main
    targets:  # per-plugin override
      - claude-code

  - name: software-engineering-team
    source: github/awesome-copilot
    subdir: plugins/software-engineering-team
    ref: main
```

Then run:

```bash
# Sync all plugins (downloads, translates, installs)
node dist/cli.js sync

# Preview what would happen
node dist/cli.js sync --dry-run

# Force re-translate from source repos (bypass registry)
node dist/cli.js sync --from-source

# Use a specific pluginfile
node dist/cli.js sync --file path/to/pluginfile.yaml

# Generate a starter pluginfile from your existing imports
node dist/cli.js sync --init
```

### How sync works

1. **Loads** `pluginfile.yaml` (searches `./pluginfile.yaml`, then `~/.uni-plugin/pluginfile.yaml`).
2. **Resolves the registry** (if configured) — clones or pulls the registry repo.
3. **Diffs against local state** — compares each plugin's ref/source against `registry.json` and skips anything already up to date.
4. **Registry-first strategy** — if a plugin exists pre-translated in the registry, copies it directly (no clone + translate needed).
5. **Source fallback** — if not in the registry (or `--from-source` is passed), clones from the source repo and runs the full translate pipeline.
6. **Installs** to each target tool, respecting per-plugin target overrides.

## How it works

```
GitHub repo
    |
    v
 +----------+
 | Detector |  <- Identifies source format
 +----+-----+
      v
 +----------+
 |  Parser  |  <- Reads native format into universal model
 +----+-----+
      v
 +------------------+
 | Universal Plugin |  <- MCP servers, skills, agents, commands, hooks, context
 +----+-------------+
      v
 +---------------------------------------------+
 | Generator (x3)                              |
 |  -> Claude Code (.claude-plugin/plugin.json) |
 |  -> Gemini CLI  (gemini-extension.json)      |
 |  -> Copilot CLI (plugin.json)                |
 +---------------------------------------------+
      v
 ~/.uni-plugin/dist/{tool}/{plugin-name}/
```

## What translates well (v0.1)

| Component    | Portability | Notes                                          |
|-------------|-------------|------------------------------------------------|
| MCP servers | High        | Protocol-level portable, only manifest differs |
| Skills      | High        | SKILL.md format shared across all three tools  |
| Agents      | Medium      | Converted to skills for Gemini CLI             |
| Commands    | Medium      | Converted to agents for Copilot CLI            |
| Context     | High        | CLAUDE.md <> GEMINI.md <> .copilot-instructions.md |
| Hooks       | Low         | Tool-specific, only passed through for native  |

## How Claude Code installation works

Claude Code uses a marketplace model. uni-plugin manages this automatically:

1. After each `import` or `sync`, a local marketplace manifest is generated at `~/.uni-plugin/dist/claude-code/.claude-plugin/marketplace.json` listing all translated plugins.
2. On the first install, that directory is registered as the `uni-plugin-local` marketplace with `claude plugin marketplace add`.
3. Plugins are installed by name from that marketplace: `claude plugin install <name>@uni-plugin-local`.

You can verify installed plugins at any time:

```bash
claude plugin list
```

## CLI reference

| Command | Description |
|---------|-------------|
| `uni import <source>` | Import a plugin from a GitHub repo and translate for all tools |
| `uni install <name>` | Install a translated plugin into target CLI tools |
| `uni remove <name>` | Uninstall a plugin from target CLI tools and delete translated files |
| `uni list` | List all imported plugins |
| `uni report <name>` | Show translation report for a plugin |
| `uni sync` | Sync plugins from a pluginfile.yaml |

### Import options

- `--ref <ref>` — Git ref to pin (tag, branch, or SHA). Default: `main`
- `--subdir <path>` — Subdirectory within the repo containing the plugin
- `--only <tools>` — Comma-separated target tools (e.g. `claude-code,gemini-cli`)

### Install options

- `--only <tools>` — Comma-separated target tools to install to
- `--dry-run` — Print install commands without executing

### Remove options

- `--only <tools>` — Comma-separated target tools to uninstall from (omit to remove from all)
- `--dry-run` — Show what would be removed without executing

When `--only` is omitted, the plugin is uninstalled from all three tools and its entry is deleted from the registry. When `--only` targets a subset of tools, the registry entry is kept since the plugin remains partially installed.

### Sync options

- `--file <path>` — Path to pluginfile.yaml
- `--from-source` — Force clone + translate from source, bypassing registry
- `--dry-run` — Show what would be installed without executing
- `--init` — Create a starter pluginfile.yaml in the current directory

## Data directory

Everything lives under `~/.uni-plugin/` (override with `UNI_PLUGIN_HOME`):

```
~/.uni-plugin/
├── registry.json           # What you've imported
├── pluginfile.yaml         # Optional global pluginfile
├── registry/               # Clone of the remote plugin registry
├── sources/                # Git clones of source repos
│   ├── code-review/
│   └── claude-code/
└── dist/                   # Translated outputs (real files, no symlinks)
    ├── claude-code/
    │   ├── .claude-plugin/
    │   │   └── marketplace.json  # Local marketplace manifest (auto-generated)
    │   ├── code-review/
    │   └── ralph-wiggum/
    ├── gemini-cli/
    │   ├── code-review/
    │   └── ralph-wiggum/
    └── copilot-cli/
        ├── code-review/
        └── ralph-wiggum/
```

## Roadmap

- [x] Import, translate, and install plugins across all three tools
- [x] Translation reports with per-component status
- [x] Monorepo detection and `--subdir` support
- [x] Declarative sync with `pluginfile.yaml`
- [x] Registry-first strategy with source fallback
- [x] Claude Code marketplace integration (`uni-plugin-local`)
- [x] `uni remove` to uninstall and clean up dist/ and registry entries
- [ ] Hook translation (Claude Code <> Gemini CLI <> Copilot CLI)
- [ ] `uni update` to re-translate when upstream changes
- [ ] `uni publish` to push translated plugins to a registry repo
- [ ] Web directory for discovery

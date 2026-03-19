# uni-plugin

Import once, install everywhere — a universal plugin translator for AI coding CLI tools.

## The problem

You found a great plugin for Gemini CLI, but you also use Claude Code and GitHub Copilot CLI. Today you'd have to track down or write an equivalent for each tool separately — if one even exists. uni-plugin solves this by translating plugins between all three ecosystems automatically.

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

## Quick start

```bash
npm install -g uni-plugin

# Import a plugin from any supported source
uni import gemini-cli-extensions/code-review

# See what translated and what didn't
uni report code-review

# Install to all three tools at once
uni install code-review
```

## Using a pluginfile

Define your plugins declaratively in `pluginfile.yaml` and sync them all at once:

```yaml
# Optional: pre-translated plugin registry (skips clone + translate)
registry: https://github.com/your-org/uni-plugin-registry

targets:
  - claude-code
  - gemini-cli
  - copilot-cli

plugins:
  - name: code-review
    source: gemini-cli-extensions/code-review
    ref: main

  - name: ralph-wiggum
    source: anthropics/claude-code
    subdir: plugins/ralph-wiggum
    ref: main
    targets:           # per-plugin target override
      - claude-code
```

```bash
uni sync              # download, translate, and install everything
uni sync --dry-run    # preview what would change
uni sync --init       # generate a pluginfile from your existing imports
```

## Translation support

| Component    | Portability | Notes                                              |
|--------------|-------------|----------------------------------------------------|
| MCP servers  | High        | Protocol-level portable, only manifest differs     |
| Skills       | High        | SKILL.md format shared across all three tools      |
| Agents       | Medium      | Converted to skills for Gemini CLI                 |
| Commands     | Medium      | Converted to agents for Copilot CLI                |
| Context      | High        | CLAUDE.md <> GEMINI.md <> .copilot-instructions.md |
| Hooks        | Low         | Tool-specific; only passed through for native tool |

## Commands

| Command | Description |
|---------|-------------|
| `uni import <repo>` | Import a plugin from a GitHub repo and translate for all tools |
| `uni sync` | Sync plugins defined in pluginfile.yaml |
| `uni install <name>` | Install a translated plugin into target CLI tools |
| `uni remove <name>` | Uninstall a plugin and delete translated files |
| `uni list` | List imported plugins, or plugins available in the registry |
| `uni report <name>` | Show per-component translation report |
| `uni publish [name]` | Publish translated plugins to a local registry repo clone |

Common flags: `--only <tools>` (comma-separated), `--dry-run`, `--ref <ref>`, `--subdir <path>`.

## Using a registry

A registry is a git repo of pre-translated plugins. When configured in your pluginfile, uni-plugin copies from the registry instead of cloning and translating from source — faster and reproducible.

```yaml
registry: https://github.com/your-org/uni-plugin-registry
```

Registry entries are pinned to commit SHAs, so you get deterministic installs. Use `--from-source` to bypass the registry and re-translate from the original repo.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT

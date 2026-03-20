# ai-plugin-bridge

Import once, install everywhere — a universal plugin translator for AI coding CLI tools.

## The problem

You found a great plugin for Gemini CLI, but you also use Claude Code and GitHub Copilot CLI. Today you'd have to track down or write an equivalent for each tool separately — if one even exists. ai-plugin-bridge solves this by translating plugins between all three ecosystems automatically.

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
 ~/.ai-plugin-bridge/dist/{tool}/{plugin-name}/
```

## Quick start

```bash
npm install -g ai-plugin-bridge

# Import a plugin from any supported source
aib import gemini-cli-extensions/code-review

# See what translated and what didn't
aib report code-review

# Install to all three tools at once
aib install code-review
```

## Using a pluginfile

Define your plugins declaratively in `pluginfile.yaml` and sync them all at once:

```yaml
# Optional: pre-translated plugin registry (skips clone + translate)
registry: https://github.com/your-org/ai-plugin-bridge-registry

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
aib sync              # download, translate, and install everything
aib sync --dry-run    # preview what would change
aib sync --init       # generate a pluginfile from your existing imports
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
| `aib import <repo>` | Import a plugin from a GitHub repo and translate for all tools |
| `aib sync` | Sync plugins defined in pluginfile.yaml |
| `aib install <name>` | Install a translated plugin into target CLI tools |
| `aib remove <name>` | Uninstall a plugin and delete translated files |
| `aib list` | List imported plugins, or plugins available in the registry (`--registry`) |
| `aib report <name>` | Show per-component translation report |
| `aib publish [name]` | Publish translated plugins to a local registry repo clone |
| `aib validate` | Validate pluginfile.yaml and report issues |
| `aib registry list` | List configured registries and their status |
| `aib registry add <name> <url>` | Add a registry to global config |
| `aib registry remove <name>` | Remove a registry from global config |
| `aib registry update [name]` | Pull latest changes for one or all registries |
| `aib registry search <query>` | Search plugins across all configured registries |
| `aib doctor` | Check environment, tool availability, and data directory |
| `aib clean` | Remove cached source clones (`--all` or `--plugin <name>`) |
| `aib completions <shell>` | Output shell completion script (bash, zsh, fish) |

Common flags: `--only <tools>` (comma-separated), `--dry-run`, `--ref <ref>`, `--subdir <path>`, `--yes` / `-y`.

## Using registries

Registries are git repos of pre-translated plugins. When configured, ai-plugin-bridge copies from the registry instead of cloning and translating from source — faster and reproducible.

### Multiple registries with priority ordering

```yaml
registries:
  - name: company
    url: https://github.com/acme-corp/ai-plugins-registry
    priority: 1    # checked first

  - name: community
    url: https://github.com/george/ai-plugin-bridge-registry
    priority: 2    # fallback

plugins:
  - name: code-review
    source: gemini-cli-extensions/code-review
    ref: main
    # resolved from highest-priority registry that has it

  - name: acme-standards
    source: acme-corp/internal-plugins
    ref: v2.0.0
    registry: company   # pinned to a specific registry — skips the lookup chain
```

Resolution order: for each plugin, the priority chain is walked from lowest to highest `priority` value. The first registry that has the plugin wins. If no registry has it, the plugin is cloned and translated from source. Use `--from-source` to bypass all registries.

### Global registry configuration

Registries added via `aib registry add` are stored in `~/.ai-plugin-bridge/config.yaml` and apply to every pluginfile. Pluginfile registries take precedence on name collision.

```bash
aib registry add company https://github.com/acme-corp/ai-plugins-registry --priority 1
aib registry add community https://github.com/george/ai-plugin-bridge-registry --priority 2
aib registry list
aib registry search code-review
aib registry update          # pull all registries
aib registry update company  # pull one registry
```

Registry clones are stored at `~/.ai-plugin-bridge/registries/{name}/`.

## Private registries

Private registries work with any git authentication method — ai-plugin-bridge relies entirely on git's credential system.

### SSH (recommended for teams)

```yaml
registries:
  - name: company
    url: git@github.com:acme-corp/ai-plugins-registry.git
    priority: 1
```

### HTTPS with credential helper

```yaml
registries:
  - name: company
    url: https://github.com/acme-corp/ai-plugins-registry
    priority: 1
```

Ensure git credentials are configured: `gh auth login` or `git credential-manager`.

### GitHub token

```bash
export GIT_ASKPASS=echo
export GIT_USERNAME=x-access-token
export GIT_PASSWORD=ghp_your_token_here
```

Registry entries are pinned to commit SHAs, so you get deterministic installs. Use `--from-source` to bypass all registries and re-translate from the original repo.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT

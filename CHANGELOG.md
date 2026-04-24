# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-20

### Added

- `aib import` — import and translate a plugin from any supported GitHub repo
- `aib install` — install a translated plugin into Claude Code, Gemini CLI, and/or Copilot CLI
- `aib remove` — uninstall a plugin and delete translated files
- `aib list` — list imported plugins or plugins available in a registry
- `aib sync` — sync all plugins declared in `pluginfile.yaml`
- `aib report` — show per-component translation report for a plugin
- `aib publish` — publish translated plugins to a registry repo clone
- `aib validate` — validate `pluginfile.yaml`
- `aib registry` subcommands — list, add, remove, update, and search across multiple registries
- `aib doctor` — check environment and tool availability
- `aib clean` — remove cached source clones
- `aib completions` — generate shell completion scripts (bash, zsh, fish)
- Multi-registry support with priority ordering in `pluginfile.yaml` and global config
- Translation support for MCP servers, skills, agents, commands, hooks, and context files
- Path variable normalisation (`${extensionPath}` / `${/}` → `{{PLUGIN_DIR}}`)
- Per-plugin `translation-report.json` with translated/partial/skipped status
- Claude Code marketplace integration via auto-generated `marketplace.json`

# Contributing

## Dev environment

```bash
git clone https://github.com/georgeracu/ai-plugin-bridge.git
cd ai-plugin-bridge
npm install
npm run build
node dist/cli.js --help
```

TypeScript sources are in `src/`. Compiled output goes to `dist/` (not committed).

## Testing

There are no automated tests yet. Validate changes manually against the four reference plugins:

```bash
# Gemini CLI — commands, skills, GEMINI.md
node dist/cli.js import gemini-cli-extensions/code-review

# Gemini CLI — MCP server, path variable normalisation
node dist/cli.js import gemini-cli-extensions/jules

# Claude Code — commands, hooks
node dist/cli.js import anthropics/claude-code --subdir plugins/ralph-wiggum

# Copilot CLI — agents -> skills translation
node dist/cli.js import github/awesome-copilot --subdir plugins/software-engineering-team

# Check the translation report for each
node dist/cli.js report code-review
node dist/cli.js report gemini-cli-jules
node dist/cli.js report ralph-wiggum
node dist/cli.js report software-engineering-team
```

Run `node dist/cli.js doctor` to verify your environment has the required CLI tools installed.

## Adding support for a new CLI tool

1. **Detector** — add a case to `src/detector.ts` that recognises the tool's manifest file(s).
2. **Parser** — create `src/parsers/<tool-name>.ts`. It should read the native format and return a `UniversalPlugin` (see `src/types.ts`). Normalise path variables to `{{PLUGIN_DIR}}`.
3. **Generator** — create `src/generators/<tool-name>.ts`. It should accept a `UniversalPlugin`, write native files to the output directory, and return a `translation-report.json`.
4. **Wire it up** — import the new parser and generator in `src/translator.ts` and add the tool name to the `ALL_TOOLS` list in `src/types.ts`.

Follow the existing parsers and generators as reference implementations. Keep the translation rules in sync with the table in `README.md`.

## Submitting a PR

- Branch from `main`.
- Keep commits focused — one logical change per commit.
- Validate against all four reference plugins before opening the PR.
- Describe what you changed and why in the PR description.
- For new tool support, include a sample plugin from that tool in the PR description so reviewers can understand the source format.

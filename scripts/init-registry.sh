#!/usr/bin/env bash
# Scaffold a new uni-plugin registry repo.
# Usage: scripts/init-registry.sh <target-directory>

set -euo pipefail

TARGET="${1:-uni-plugin-registry}"

if [ -e "$TARGET" ]; then
  echo "Error: '$TARGET' already exists" >&2
  exit 1
fi

mkdir -p "$TARGET/plugins"
mkdir -p "$TARGET/.github/workflows"
touch "$TARGET/plugins/.gitkeep"

# registry-index.json
cat > "$TARGET/registry-index.json" << 'EOF'
{
  "version": "1",
  "updatedAt": "",
  "plugins": {}
}
EOF

# Stamp the current timestamp
node -e "
const fs = require('fs');
const idx = JSON.parse(fs.readFileSync('$TARGET/registry-index.json', 'utf-8'));
idx.updatedAt = new Date().toISOString();
fs.writeFileSync('$TARGET/registry-index.json', JSON.stringify(idx, null, 2));
"

# Copy the validation script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/validate-registry.js" "$TARGET/validate-registry.js"

# README.md
cat > "$TARGET/README.md" << 'README'
# uni-plugin registry

A registry of pre-translated AI CLI plugins compatible with
[uni-plugin](https://github.com/your-org/uni-plugin).

## Using this registry

Point your `pluginfile.yaml` at this repo:

```yaml
registry: your-org/uni-plugin-registry

targets:
  - claude-code
  - gemini-cli
  - copilot-cli

plugins:
  - name: code-review
    source: gemini-cli-extensions/code-review
    ref: main
```

Then run:

```bash
uni sync
```

`uni sync` will clone this registry, look up each plugin in `registry-index.json`,
and copy the pre-translated files to your local dist rather than cloning and
translating from source.

## Plugin structure

Each plugin lives in `plugins/<name>/`:

```
plugins/<name>/
├── metadata.json          # Plugin metadata and translation summaries
└── dist/
    ├── claude-code/       # Translated for Claude Code
    ├── gemini-cli/        # Translated for Gemini CLI
    └── copilot-cli/       # Translated for GitHub Copilot CLI
```

## Adding plugins

Use the `uni publish` command — do not edit `dist/` files manually.

```bash
uni publish code-review --registry /path/to/this/repo
# or publish everything at once:
uni publish --all --registry /path/to/this/repo
```

After publishing, commit and push:

```bash
git add -A
git commit -m "Publish code-review (abc1234)"
git push
```
README

# .github/workflows/validate.yml
cat > "$TARGET/.github/workflows/validate.yml" << 'YAML'
name: Validate registry

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Validate registry integrity
        run: node validate-registry.js
YAML

echo ""
echo "Registry scaffolded at: $TARGET"
echo ""
echo "Next steps:"
echo "  cd $TARGET"
echo "  git init && git add -A && git commit -m 'Initial registry scaffold'"
echo "  # Create a GitHub repo, then:"
echo "  git remote add origin https://github.com/your-org/uni-plugin-registry.git"
echo "  git push -u origin main"
echo ""
echo "Then publish plugins with:"
echo "  uni publish --all --registry \$(pwd)"
echo ""

#!/usr/bin/env node
// Validate the integrity of an ai-plugin-bridge registry repo.
// Runs in the registry repo root. No npm dependencies.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
let errors = 0;

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  errors++;
}

function check(condition, msg) {
  if (!condition) fail(msg);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Validate registry-index.json
// ---------------------------------------------------------------------------

console.log("\nValidating registry-index.json...");

const indexPath = path.join(ROOT, "registry-index.json");
check(fs.existsSync(indexPath), "registry-index.json not found");

const index = readJson(indexPath);
check(index !== null, "registry-index.json is not valid JSON");
check(index?.version === "1", `registry-index.json version must be "1", got ${JSON.stringify(index?.version)}`);
check(typeof index?.updatedAt === "string", "registry-index.json missing updatedAt");
check(typeof index?.plugins === "object" && !Array.isArray(index?.plugins), "registry-index.json plugins must be an object");

if (errors > 0) {
  console.error(`\n${errors} error(s) found. Aborting further checks.\n`);
  process.exit(1);
}

const pluginNames = Object.keys(index.plugins);
console.log(`  OK    ${pluginNames.length} plugin(s) in index`);

// ---------------------------------------------------------------------------
// 2. Validate each plugin directory
// ---------------------------------------------------------------------------

// Expected manifest file per target tool
const MANIFESTS = {
  "claude-code": path.join(".claude-plugin", "plugin.json"),
  "gemini-cli": "gemini-extension.json",
  "copilot-cli": "plugin.json",
};

const pluginsDir = path.join(ROOT, "plugins");

// Check for extra directories not in index
if (fs.existsSync(pluginsDir)) {
  const onDisk = fs.readdirSync(pluginsDir).filter((e) => {
    return fs.statSync(path.join(pluginsDir, e)).isDirectory();
  });
  for (const dir of onDisk) {
    if (!index.plugins[dir]) {
      console.warn(`  WARN  plugins/${dir} exists on disk but is not in registry-index.json`);
    }
  }
}

for (const name of pluginNames) {
  console.log(`\nValidating plugins/${name}...`);

  const pluginDir = path.join(pluginsDir, name);
  check(fs.existsSync(pluginDir), `plugins/${name} directory not found`);

  // metadata.json
  const metadataPath = path.join(pluginDir, "metadata.json");
  check(fs.existsSync(metadataPath), `plugins/${name}/metadata.json not found`);

  const metadata = readJson(metadataPath);
  check(metadata !== null, `plugins/${name}/metadata.json is not valid JSON`);
  check(typeof metadata?.name === "string", `plugins/${name}/metadata.json missing name`);
  check(typeof metadata?.sourceTool === "string", `plugins/${name}/metadata.json missing sourceTool`);
  check(typeof metadata?.version === "string", `plugins/${name}/metadata.json missing version`);
  check(typeof metadata?.targets === "object" && !Array.isArray(metadata?.targets), `plugins/${name}/metadata.json targets must be an object`);

  // Cross-check name
  if (metadata?.name && metadata.name !== name) {
    fail(`plugins/${name}/metadata.json name "${metadata.name}" does not match directory name`);
  }

  // Per-target validation
  const targets = index.plugins[name]?.targets ?? [];
  for (const tool of targets) {
    const toolDir = path.join(pluginDir, "dist", tool);
    check(fs.existsSync(toolDir), `plugins/${name}/dist/${tool} not found (listed in index)`);

    const manifestRel = MANIFESTS[tool];
    if (manifestRel) {
      const manifestPath = path.join(toolDir, manifestRel);
      check(
        fs.existsSync(manifestPath),
        `plugins/${name}/dist/${tool}/${manifestRel} not found`
      );
    }

    const reportPath = path.join(toolDir, "translation-report.json");
    check(
      fs.existsSync(reportPath),
      `plugins/${name}/dist/${tool}/translation-report.json not found`
    );

    const report = readJson(reportPath);
    check(report !== null, `plugins/${name}/dist/${tool}/translation-report.json is not valid JSON`);
  }

  if (errors === 0) {
    console.log(`  OK    all checks passed`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log();
if (errors > 0) {
  console.error(`Validation failed with ${errors} error(s).\n`);
  process.exit(1);
} else {
  console.log(`Validation passed. ${pluginNames.length} plugin(s) OK.\n`);
}

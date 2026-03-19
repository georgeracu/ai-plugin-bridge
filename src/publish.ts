import { join } from "node:path";
import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import type {
  PluginMetadata,
  PluginTargetSummary,
  RegistryIndex,
  RegistryPluginEntry,
  ToolId,
  TranslationReport,
} from "./types.js";
import { ALL_TOOLS } from "./types.js";
import { loadRegistry } from "./registry.js";
import { loadRegistryIndex, saveRegistryIndex } from "./registry-index.js";
import { errorMessage, readJsonFile } from "./utils.js";

export interface PublishOptions {
  names: string[];
  registryDir: string;
  uniHome: string;
}

export function publish(options: PublishOptions): void {
  const { names, registryDir, uniHome } = options;
  const distDir = join(uniHome, "dist");
  const registry = loadRegistry(uniHome);
  const index = loadRegistryIndex(registryDir);

  console.log(`\nPublishing ${names.length} plugin${names.length === 1 ? "" : "s"} to ${registryDir}...\n`);

  const published: Array<{ name: string; ref: string }> = [];

  for (const name of names) {
    try {
      const ref = publishPlugin(name, registry, index, distDir, registryDir);
      published.push({ name, ref });
    } catch (err) {
      console.log(`  ${chalk.red("✗")} ${name} — ${errorMessage(err)}`);
    }
  }

  if (published.length === 0) return;

  saveRegistryIndex(registryDir, index);

  const commitMsg =
    published.length === 1
      ? `Publish ${published[0].name} (${published[0].ref.slice(0, 8)})`
      : `Publish ${published.length} plugins`;

  console.log(`\nNext steps:`);
  console.log(`  cd ${registryDir}`);
  console.log(`  git add -A`);
  console.log(`  git commit -m "${commitMsg}"`);
  console.log(`  git push\n`);
}

function publishPlugin(
  name: string,
  registry: Record<string, unknown>,
  index: RegistryIndex,
  distDir: string,
  registryDir: string
): string {
  const entry = registry[name] as Record<string, unknown> | undefined;
  if (!entry) {
    throw new Error(`not found in local registry — run: uni import`);
  }

  const pinnedRef = (entry.pinnedRef as string) ?? (entry.ref as string);
  const source = entry.source as string;
  const subdir = entry.subdir as string | undefined;
  const sourceTool = entry.sourceTool as ToolId;

  // Build target summaries from translation reports
  const targetSummaries: Record<string, PluginTargetSummary> = {};
  const availableTargets: ToolId[] = [];

  for (const tool of ALL_TOOLS) {
    const toolPluginDir = join(distDir, tool, name);
    if (!existsSync(toolPluginDir)) {
      targetSummaries[tool] = { status: "none", components: 0 };
      continue;
    }

    availableTargets.push(tool);

    const report = readJsonFile(
      join(toolPluginDir, "translation-report.json")
    ) as TranslationReport | null;

    if (!report) {
      targetSummaries[tool] = { status: "full", components: 0 };
    } else {
      const translatedCount = report.components.filter(
        (c) => c.status !== "skipped"
      ).length;
      targetSummaries[tool] = {
        status: report.partial ? "partial" : "full",
        components: translatedCount,
        ...(report.warnings.length > 0 ? { warnings: report.warnings } : {}),
      };
    }
  }

  if (availableTargets.length === 0) {
    throw new Error(`no translated dist files found — run: uni import`);
  }

  const description = getPluginDescription(distDir, name, sourceTool);

  // Copy dist files to registry
  const pluginRegistryDir = join(registryDir, "plugins", name);
  mkdirSync(join(pluginRegistryDir, "dist"), { recursive: true });

  for (const tool of availableTargets) {
    cpSync(join(distDir, tool, name), join(pluginRegistryDir, "dist", tool), {
      recursive: true,
    });
  }

  // Write metadata.json
  const publishedAt = new Date().toISOString();
  const metadata: PluginMetadata = {
    name,
    description,
    sourceTool,
    source: { repo: source, ref: pinnedRef, ...(subdir ? { subdir } : {}) },
    version: pinnedRef,
    publishedAt,
    targets: targetSummaries,
  };
  writeFileSync(
    join(pluginRegistryDir, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  // Mutate index in place — caller saves once at the end
  index.plugins[name] = {
    description,
    sourceTool,
    source,
    ref: pinnedRef,
    publishedAt,
    targets: availableTargets,
  } satisfies RegistryPluginEntry;

  console.log(`  ${chalk.green("✓")} ${name}`);
  return pinnedRef;
}

function getPluginDescription(distDir: string, name: string, sourceTool: ToolId): string {
  const manifestPaths: Record<ToolId, string> = {
    "claude-code": join(distDir, "claude-code", name, ".claude-plugin", "plugin.json"),
    "gemini-cli": join(distDir, "gemini-cli", name, "gemini-extension.json"),
    "copilot-cli": join(distDir, "copilot-cli", name, "plugin.json"),
  };

  // Try source tool manifest first, then fall back to any other
  for (const tool of [sourceTool, ...ALL_TOOLS.filter((t) => t !== sourceTool)]) {
    const manifest = readJsonFile(manifestPaths[tool]) as Record<string, unknown> | null;
    if (manifest?.description) return manifest.description as string;
  }

  return name;
}

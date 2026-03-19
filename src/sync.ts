import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";
import type {
  Pluginfile,
  PluginfileEntry,
  ToolId,
  SyncResult,
  SyncResultEntry,
} from "./types.js";
import { translate } from "./translator.js";
import {
  updateClaudeMarketplace,
  ensureClaudeMarketplace,
} from "./generators/index.js";
import { loadRegistry, updateRegistryEntry } from "./registry.js";
import {
  normalizeGitUrl,
  cloneOrUpdate,
  pinnedCommit,
  errorMessage,
  listSubdirs,
} from "./utils.js";
import { RegistryClient } from "./registry-client.js";
import { warn, fail, ok, step, syncTable } from "./output.js";

export interface SyncOptions {
  pluginfile: Pluginfile;
  uniHome: string;
  fromSource: boolean;
  dryRun: boolean;
}

/**
 * Run the sync workflow: resolve registry, diff state, import/install plugins.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { pluginfile, uniHome, fromSource, dryRun } = options;
  const distDir = join(uniHome, "dist");
  const registry = loadRegistry(uniHome);
  const entries: SyncResultEntry[] = [];

  // Resolve remote registry if configured
  let registryClient: RegistryClient | null = null;
  if (pluginfile.registry && !fromSource) {
    console.log(`\nResolving registry: ${pluginfile.registry}`);
    try {
      registryClient = new RegistryClient(pluginfile.registry, uniHome);
      if (!dryRun) {
        registryClient.sync();
      }
      ok("Registry synced");
    } catch (err) {
      warn(`Registry unavailable, falling back to source — ${errorMessage(err)}`);
      registryClient = null;
    }
  }

  console.log(
    `\n${dryRun ? chalk.dim("[dry-run] ") : ""}Syncing ${pluginfile.plugins.length} plugin${pluginfile.plugins.length !== 1 ? "s" : ""}...\n`
  );

  for (const entry of pluginfile.plugins) {
    const targets = entry.targets ?? pluginfile.targets;
    const result = syncPlugin(entry, {
      targets,
      distDir,
      uniHome,
      registry,
      registryClient,
      fromSource,
      dryRun,
    });
    entries.push(result);
  }

  // Summary table
  console.log();
  syncTable(entries);
  console.log();

  const installed = entries.filter((e) => e.status === "installed").length;
  const upToDate = entries.filter((e) => e.status === "up-to-date").length;
  const failed = entries.filter((e) => e.status === "failed").length;

  const parts: string[] = [];
  if (installed > 0) parts.push(chalk.green(`${installed} installed`));
  if (upToDate > 0) parts.push(chalk.dim(`${upToDate} up to date`));
  if (failed > 0) parts.push(chalk.red(`${failed} failed`));
  if (parts.length > 0) console.log(`  ${parts.join(chalk.dim(", "))}`);
  console.log();

  return { entries };
}

interface SyncPluginContext {
  targets: ToolId[];
  distDir: string;
  uniHome: string;
  registry: Record<string, unknown>;
  registryClient: RegistryClient | null;
  fromSource: boolean;
  dryRun: boolean;
}

function syncPlugin(
  entry: PluginfileEntry,
  ctx: SyncPluginContext
): SyncResultEntry {
  const { targets, distDir, uniHome, registry, registryClient, fromSource, dryRun } =
    ctx;

  // Check if already up to date (skip when --from-source forces re-import)
  const existing = registry[entry.name] as Record<string, unknown> | undefined;
  if (!fromSource && existing && existing.ref === entry.ref) {
    const sameSource = existing.source === entry.source;
    const sameSubdir = (existing.subdir ?? undefined) === entry.subdir;
    if (sameSource && sameSubdir) {
      console.log(`  ${chalk.dim("○")} ${chalk.bold(entry.name)} — already up to date`);
      return { name: entry.name, status: "up-to-date", targetResults: [] };
    }
  }

  // Try registry first
  if (registryClient && !fromSource && registryClient.hasPlugin(entry.name)) {
    return syncFromRegistry(entry, targets, distDir, uniHome, registryClient, dryRun);
  }

  // Fall back to source
  return syncFromSource(entry, targets, distDir, uniHome, dryRun);
}

function syncFromRegistry(
  entry: PluginfileEntry,
  targets: ToolId[],
  distDir: string,
  uniHome: string,
  client: RegistryClient,
  dryRun: boolean
): SyncResultEntry {
  const targetResults: SyncResultEntry["targetResults"] = [];

  try {
    if (dryRun) {
      console.log(
        `  ${chalk.blue("●")} ${chalk.bold(entry.name)} ${chalk.dim("[registry]")} — would install`
      );
      for (const tool of targets) {
        const has = client.hasTarget(entry.name, tool);
        targetResults.push({
          tool,
          status: has ? "installed" : "skipped",
          reason: has ? undefined : "not available in registry",
        });
      }
      return { name: entry.name, status: "installed", fetchedFrom: "registry", targetResults };
    }

    console.log(
      `  ${chalk.blue("●")} ${chalk.bold(entry.name)} ${chalk.dim("[registry]")}`
    );

    for (const tool of targets) {
      if (client.hasTarget(entry.name, tool)) {
        client.copyToLocal(entry.name, tool, distDir);
        targetResults.push({ tool, status: "installed" });
        console.log(`    ${tool}: ${chalk.green("✓")} copied from registry`);
      } else {
        targetResults.push({ tool, status: "skipped", reason: "not available in registry" });
        console.log(`    ${tool}: ${chalk.dim("—")} not in registry`);
      }
    }

    const metadata = client.getMetadata(entry.name) ?? {};
    updateRegistryEntry(uniHome, entry.name, {
      source: entry.source,
      subdir: entry.subdir,
      ref: entry.ref,
      pinnedRef: (metadata.pinnedRef as string) ?? entry.ref,
      sourceTool: metadata.sourceTool ?? "unknown",
      translatedAt: (metadata.translatedAt as string) ?? new Date().toISOString(),
      targets,
      fetchedFrom: "registry",
    });

    return { name: entry.name, status: "installed", fetchedFrom: "registry", targetResults };
  } catch (err) {
    fail(`${chalk.bold(entry.name)} ${chalk.dim("[registry]")} — ${errorMessage(err)}`);
    return {
      name: entry.name,
      status: "failed",
      fetchedFrom: "registry",
      targetResults,
      error: errorMessage(err),
    };
  }
}

function syncFromSource(
  entry: PluginfileEntry,
  targets: ToolId[],
  distDir: string,
  uniHome: string,
  dryRun: boolean
): SyncResultEntry {
  const targetResults: SyncResultEntry["targetResults"] = [];

  if (dryRun) {
    console.log(
      `  ${chalk.blue("●")} ${chalk.bold(entry.name)} ${chalk.dim("[source]")} — would import from ${entry.source}${entry.subdir ? ` (${entry.subdir})` : ""}`
    );
    for (const tool of targets) {
      targetResults.push({ tool, status: "installed" });
    }
    return { name: entry.name, status: "installed", fetchedFrom: "source", targetResults };
  }

  try {
    console.log(
      `  ${chalk.blue("●")} ${chalk.bold(entry.name)} ${chalk.dim("[source]")}`
    );

    // Clone/update source
    const gitUrl = normalizeGitUrl(entry.source);
    const repoName = entry.source.split("/").pop()!.replace(/\.git$/, "");
    const sourcesDir = join(uniHome, "sources", repoName);

    step(`Cloning ${entry.source} (ref: ${entry.ref})...`);
    cloneOrUpdate(sourcesDir, gitUrl, entry.ref);

    const pluginDir = entry.subdir
      ? join(sourcesDir, entry.subdir)
      : sourcesDir;

    if (!existsSync(pluginDir)) {
      const available = listSubdirs(sourcesDir);
      throw new Error(
        `Subdirectory "${entry.subdir}" not found in ${entry.source}.` +
          (available ? `\nAvailable directories: ${available}` : "")
      );
    }

    const pinnedRef = pinnedCommit(sourcesDir);
    step(`Translating...`);

    // Translate (silent — sync has its own per-target output)
    const result = translate({
      pluginDir,
      outputDir: distDir,
      source: { repo: entry.source, subdir: entry.subdir, ref: pinnedRef },
      targets,
    });

    // Regenerate Claude Code marketplace manifest
    updateClaudeMarketplace(join(distDir, "claude-code"));

    // Install to target tools
    for (const tool of targets) {
      const toolPluginDir = join(distDir, tool, result.plugin.name);
      if (!existsSync(toolPluginDir)) {
        targetResults.push({ tool, status: "skipped", reason: "not translated" });
        continue;
      }

      try {
        installToTool(tool, result.plugin.name, distDir);
        targetResults.push({ tool, status: "installed" });
        console.log(`    ${tool}: ${chalk.green("✓")} installed`);
      } catch (err) {
        targetResults.push({ tool, status: "failed", reason: errorMessage(err) });
        console.log(`    ${tool}: ${chalk.red("✗")} failed — ${errorMessage(err)}`);
      }
    }

    // Update registry
    updateRegistryEntry(uniHome, result.plugin.name, {
      source: entry.source,
      subdir: entry.subdir,
      ref: entry.ref,
      pinnedRef,
      sourceTool: result.plugin.sourceTool,
      translatedAt: new Date().toISOString(),
      targets,
      fetchedFrom: "source",
    });

    return { name: entry.name, status: "installed", fetchedFrom: "source", targetResults };
  } catch (err) {
    fail(`${chalk.bold(entry.name)} — ${errorMessage(err)}`);
    return {
      name: entry.name,
      status: "failed",
      fetchedFrom: "source",
      targetResults,
      error: errorMessage(err),
    };
  }
}

function installToTool(tool: ToolId, name: string, distDir: string): void {
  if (tool === "claude-code") {
    ensureClaudeMarketplace(join(distDir, "claude-code"));
    execSync(`claude plugin install "${name}@uni-plugin-local"`, { stdio: "pipe" });
  } else {
    const absDir = resolve(join(distDir, tool, name));
    const cmd =
      tool === "gemini-cli"
        ? `gemini extensions link "${absDir}"`
        : `copilot plugin install "${absDir}"`;
    execSync(cmd, { stdio: "pipe" });
  }
}

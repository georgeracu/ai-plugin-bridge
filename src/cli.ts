#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import { resolve, join, basename } from "node:path";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { translate } from "./translator.js";
import { loadPluginfile } from "./pluginfile.js";
import { sync } from "./sync.js";
import { publish } from "./publish.js";
import { loadRegistryIndex } from "./registry-index.js";
import {
  updateClaudeMarketplace,
  ensureClaudeMarketplace,
} from "./generators/index.js";
import { loadRegistry, updateRegistryEntry, deleteRegistryEntry } from "./registry.js";
import {
  normalizeGitUrl,
  cloneOrUpdate,
  pinnedCommit,
  errorMessage,
} from "./utils.js";
import { ALL_TOOLS, type ToolId } from "./types.js";

const UNI_HOME =
  process.env.UNI_PLUGIN_HOME ?? join(process.env.HOME ?? "~", ".uni-plugin");

program
  .name("uni")
  .description(
    "Universal AI CLI plugin translator — import once, install everywhere"
  )
  .version("0.1.0");

// -------------------------------------------------------------------------
// uni import <source> [--ref <ref>] [--subdir <path>] [--only <tools>]
// -------------------------------------------------------------------------
program
  .command("import")
  .description("Import a plugin from a GitHub repo and translate for all tools")
  .argument(
    "<source>",
    "GitHub repo (owner/repo) or full URL, optionally with subdir"
  )
  .option("--ref <ref>", "Git ref to pin (tag, branch, or SHA)", "main")
  .option(
    "--subdir <path>",
    "Subdirectory within the repo containing the plugin"
  )
  .option(
    "--only <tools>",
    "Comma-separated list of target tools (claude-code,gemini-cli,copilot-cli)"
  )
  .action((source: string, opts) => {
    const ref: string = opts.ref;
    const subdir: string | undefined = opts.subdir;
    const targets: ToolId[] | undefined = opts.only
      ?.split(",")
      .map((t: string) => t.trim() as ToolId);

    const gitUrl = normalizeGitUrl(source);
    const repoName = basename(source).replace(/\.git$/, "");

    console.log(`\nImporting plugin from ${gitUrl} (ref: ${ref})`);

    const sourcesDir = join(UNI_HOME, "sources", repoName);
    console.log(existsSync(sourcesDir) ? `  Updating existing clone...` : `  Cloning...`);
    cloneOrUpdate(sourcesDir, gitUrl, ref);

    const pluginDir = subdir ? join(sourcesDir, subdir) : sourcesDir;
    if (!existsSync(pluginDir)) {
      console.error(`  Error: directory ${pluginDir} does not exist`);
      process.exit(1);
    }

    // Detect monorepo: if no --subdir was given, check for a plugins/ directory
    // with multiple subdirectories — this likely means the user needs --subdir
    if (!subdir) {
      const pluginsDir = join(pluginDir, "plugins");
      if (existsSync(pluginsDir)) {
        const entries = readdirSync(pluginsDir).filter((e) =>
          statSync(join(pluginsDir, e)).isDirectory()
        );
        if (entries.length > 1) {
          console.error(
            `\n  This looks like a monorepo with ${entries.length} plugins under plugins/.`
          );
          console.error(`  Use --subdir to select one. Available plugins:\n`);
          for (const entry of entries.sort()) {
            console.error(`    ${source} --subdir plugins/${entry}`);
          }
          console.error();
          process.exit(1);
        }
      }
    }

    const pinnedRef = pinnedCommit(sourcesDir);

    const distDir = join(UNI_HOME, "dist");
    const result = translate({
      pluginDir,
      outputDir: distDir,
      source: { repo: source, subdir, ref: pinnedRef },
      targets,
    });

    updateClaudeMarketplace(join(distDir, "claude-code"));

    updateRegistryEntry(UNI_HOME, result.plugin.name, {
      source,
      subdir,
      ref,
      pinnedRef,
      sourceTool: result.plugin.sourceTool,
      translatedAt: new Date().toISOString(),
      targets: targets ?? ALL_TOOLS,
    });

    console.log(`\n${chalk.green("✓")} ${result.plugin.name} imported and translated`);
    console.log(`  Dist: ${distDir}`);
    console.log(`  Install with: uni install ${result.plugin.name}\n`);
  });

// -------------------------------------------------------------------------
// uni install <name> [--only <tools>]
// -------------------------------------------------------------------------
program
  .command("install")
  .description("Install a translated plugin into target CLI tools")
  .argument("<name>", "Plugin name (as shown in registry)")
  .option(
    "--only <tools>",
    "Comma-separated list of target tools to install to"
  )
  .option("--dry-run", "Print install commands without executing them")
  .action((name: string, opts) => {
    const distDir = join(UNI_HOME, "dist");
    const dryRun: boolean = opts.dryRun ?? false;
    const targets: ToolId[] = opts.only
      ? opts.only.split(",").map((t: string) => t.trim() as ToolId)
      : ALL_TOOLS;

    console.log(`\n${dryRun ? "[dry-run] " : ""}Installing ${name}...`);

    for (const tool of targets) {
      const pluginDir = join(distDir, tool, name);
      if (!existsSync(pluginDir)) {
        console.log(`  ${tool}: not translated (skipping)`);
        continue;
      }

      if (dryRun) {
        console.log(`  ${tool}: ${installCommand(tool, name, distDir)}`);
        continue;
      }

      try {
        installToTool(tool, name);
        console.log(`  ${tool}: ${chalk.green("✓")} installed`);
      } catch (err) {
        console.log(`  ${tool}: ${chalk.red("✗")} failed — ${errorMessage(err)}`);
      }
    }

    console.log();
  });

// -------------------------------------------------------------------------
// uni list
// -------------------------------------------------------------------------
program
  .command("list")
  .description("List imported plugins, or plugins available in the registry")
  .option("--registry", "List plugins available in the remote registry")
  .option(
    "--registry-dir <path>",
    "Path to local registry clone",
    join(UNI_HOME, "registry")
  )
  .action((opts) => {
    if (opts.registry) {
      const registryDir: string = opts.registryDir;
      const index = loadRegistryIndex(registryDir);
      const entries = Object.entries(index.plugins);
      if (entries.length === 0) {
        console.log("No plugins in registry. Run: uni publish <name>");
        return;
      }
      console.log("\nAvailable in registry:\n");
      for (const [name, entry] of entries) {
        console.log(
          `  ${name} (${entry.sourceTool}) — targets: ${entry.targets.join(", ")}`
        );
      }
      console.log();
      return;
    }

    const registry = loadRegistry(UNI_HOME);
    if (Object.keys(registry).length === 0) {
      console.log("No plugins imported yet. Run: uni import <source>");
      return;
    }

    console.log("\nImported plugins:\n");
    for (const [name, entry] of Object.entries(registry)) {
      const e = entry as Record<string, unknown>;
      console.log(
        `  ${name} (from ${e.sourceTool}) — source: ${e.source}@${(e.pinnedRef as string).slice(0, 8)}`
      );
      console.log(`    Targets: ${(e.targets as string[]).join(", ")}`);
      console.log(`    Translated: ${e.translatedAt}`);
    }
    console.log();
  });

// -------------------------------------------------------------------------
// uni report <name>
// -------------------------------------------------------------------------
program
  .command("report")
  .description("Show translation report for a plugin")
  .argument("<name>", "Plugin name")
  .action((name: string) => {
    const distDir = join(UNI_HOME, "dist");

    console.log(`\nTranslation report for ${name}:\n`);

    for (const tool of ALL_TOOLS) {
      const reportPath = join(distDir, tool, name, "translation-report.json");
      if (!existsSync(reportPath)) {
        console.log(`  ${tool}: no translation found`);
        continue;
      }

      const report = JSON.parse(readFileSync(reportPath, "utf-8"));
      console.log(`  ${tool} (${report.partial ? "partial" : "full"}):`);

      for (const comp of report.components) {
        const icon =
          comp.status === "translated"
            ? chalk.green("✓")
            : comp.status === "partial"
              ? chalk.yellow("◐")
              : chalk.red("✗");
        const reason = comp.reason ? ` — ${comp.reason}` : "";
        console.log(`    ${icon} ${comp.type}: ${comp.name}${reason}`);
      }

      for (const w of report.warnings) {
        console.log(`    ${chalk.yellow("⚠")} ${w}`);
      }
    }
    console.log();
  });

// -------------------------------------------------------------------------
// uni remove <name> [--only <tools>] [--dry-run]
// -------------------------------------------------------------------------
program
  .command("remove")
  .description("Uninstall a plugin from target CLI tools and remove translated files")
  .argument("<name>", "Plugin name (as shown in registry)")
  .option(
    "--only <tools>",
    "Comma-separated list of target tools to uninstall from"
  )
  .option("--dry-run", "Show what would be removed without executing")
  .action((name: string, opts) => {
    const distDir = join(UNI_HOME, "dist");
    const dryRun: boolean = opts.dryRun ?? false;
    const targets: ToolId[] = opts.only
      ? opts.only.split(",").map((t: string) => t.trim() as ToolId)
      : ALL_TOOLS;

    const registry = loadRegistry(UNI_HOME);
    if (!registry[name]) {
      console.log(`\n  Plugin "${name}" not found in registry.\n`);
      process.exit(1);
    }

    console.log(`\n${dryRun ? "[dry-run] " : ""}Removing ${name}...`);

    for (const tool of targets) {
      const pluginDir = join(distDir, tool, name);
      if (!existsSync(pluginDir)) {
        console.log(`  ${tool}: not installed (skipping)`);
        continue;
      }

      if (dryRun) {
        console.log(`  ${tool}: ${uninstallCommand(tool, name)}`);
        console.log(`    rm -rf ${pluginDir}`);
        continue;
      }

      try {
        execSync(uninstallCommand(tool, name), { stdio: "pipe" });
      } catch {
        // Tool may not have it installed — continue to clean up dist files
      }

      try {
        rmSync(pluginDir, { recursive: true, force: true });
        console.log(`  ${tool}: ${chalk.green("✓")} removed`);
      } catch (err) {
        console.log(`  ${tool}: ${chalk.red("✗")} failed — ${errorMessage(err)}`);
      }
    }

    if (!dryRun) {
      const claudeDistDir = join(distDir, "claude-code");
      if (existsSync(claudeDistDir)) {
        updateClaudeMarketplace(claudeDistDir);
      }

      if (ALL_TOOLS.every((t) => targets.includes(t))) {
        deleteRegistryEntry(UNI_HOME, name);
        console.log(`  registry: ${chalk.green("✓")} entry removed`);
      }
    }

    console.log();
  });

// -------------------------------------------------------------------------
// uni sync [--file <path>] [--from-source] [--dry-run] [--init]
// -------------------------------------------------------------------------
program
  .command("sync")
  .description(
    "Sync plugins from a pluginfile.yaml — download, translate, and install"
  )
  .option("--file <path>", "Path to pluginfile.yaml")
  .option(
    "--from-source",
    "Force clone + translate from source repos, bypassing registry"
  )
  .option("--dry-run", "Show what would be installed without executing")
  .option("--init", "Create a starter pluginfile.yaml in the current directory")
  .action((opts) => {
    if (opts.init) {
      generatePluginfile();
      return;
    }

    const { pluginfile, resolvedPath } = loadPluginfile(opts.file);
    console.log(`Using pluginfile: ${resolvedPath}`);

    sync({
      pluginfile,
      uniHome: UNI_HOME,
      fromSource: opts.fromSource ?? false,
      dryRun: opts.dryRun ?? false,
    });
  });

// -------------------------------------------------------------------------
// uni publish <name> [--registry <path>] [--all]
// -------------------------------------------------------------------------
program
  .command("publish")
  .description("Publish translated plugins to a local registry repo clone")
  .argument("[name]", "Plugin name to publish")
  .option("--all", "Publish all imported plugins")
  .option(
    "--registry <path>",
    "Path to local registry repo clone",
    join(UNI_HOME, "registry")
  )
  .action((name: string | undefined, opts) => {
    const registryDir: string = opts.registry;

    let names: string[];
    if (opts.all) {
      const registry = loadRegistry(UNI_HOME);
      names = Object.keys(registry);
      if (names.length === 0) {
        console.log("No plugins imported yet. Run: uni import <source>");
        process.exit(1);
      }
    } else if (name) {
      names = [name];
    } else {
      console.error("Error: specify a plugin name or --all");
      process.exit(1);
    }

    publish({ names, registryDir, uniHome: UNI_HOME });
  });

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function uninstallCommand(tool: ToolId, name: string): string {
  switch (tool) {
    case "claude-code":
      return `claude plugin uninstall "${name}@uni-plugin-local"`;
    case "gemini-cli":
      return `gemini extensions uninstall "${name}"`;
    case "copilot-cli":
      return `copilot plugin uninstall "${name}"`;
  }
}

function installCommand(tool: ToolId, name: string, distDir: string): string {
  switch (tool) {
    case "claude-code":
      return `claude plugin install "${name}@uni-plugin-local"`;
    case "gemini-cli":
      return `gemini extensions link "${resolve(join(distDir, "gemini-cli", name))}"`;
    case "copilot-cli":
      return `copilot plugin install "${resolve(join(distDir, "copilot-cli", name))}"`;
  }
}

function installToTool(tool: ToolId, name: string): void {
  const distDir = join(UNI_HOME, "dist");
  if (tool === "claude-code") {
    ensureClaudeMarketplace(join(distDir, "claude-code"));
  }
  execSync(installCommand(tool, name, distDir), { stdio: "pipe" });
}

function generatePluginfile(): void {
  const outPath = join(process.cwd(), "pluginfile.yaml");
  if (existsSync(outPath)) {
    console.log(
      `${chalk.yellow("⚠")} pluginfile.yaml already exists in current directory`
    );
    return;
  }

  const registry = loadRegistry(UNI_HOME);
  const entries = Object.entries(registry);

  let yaml = `# uni-plugin pluginfile — run "uni sync" to install all plugins\n\n`;
  yaml += `# registry: owner/repo  # optional: pre-translated plugin registry\n\n`;
  yaml += `targets:\n  - claude-code\n  - gemini-cli\n  - copilot-cli\n\nplugins:\n`;

  if (entries.length === 0) {
    yaml += `  # - name: example-plugin\n`;
    yaml += `  #   source: owner/repo\n`;
    yaml += `  #   ref: main\n`;
  } else {
    for (const [name, raw] of entries) {
      const e = raw as Record<string, unknown>;
      yaml += `  - name: ${name}\n`;
      yaml += `    source: ${e.source}\n`;
      yaml += `    ref: ${e.ref ?? "main"}\n`;
      if (e.subdir) {
        yaml += `    subdir: ${e.subdir}\n`;
      }
      const pluginTargets = e.targets as string[] | undefined;
      if (pluginTargets && pluginTargets.length < ALL_TOOLS.length) {
        yaml += `    targets:\n`;
        for (const t of pluginTargets) {
          yaml += `      - ${t}\n`;
        }
      }
      yaml += `\n`;
    }
  }

  writeFileSync(outPath, yaml);
  console.log(`${chalk.green("✓")} Created pluginfile.yaml`);
  console.log(`  Edit it to configure your plugins, then run: uni sync\n`);
}

program.parse();

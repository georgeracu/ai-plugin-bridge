#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { translate } from "./translator.js";
import { loadPluginfile, validatePluginfile } from "./pluginfile.js";
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
import { RegistryManager } from "./registry-manager.js";
import { loadGlobalConfig, saveGlobalConfig } from "./config.js";
import { mergeRegistries } from "./resolver.js";
import { ALL_TOOLS, type ToolId } from "./types.js";
import {
  setVerbose,
  setYes,
  isYes,
  header,
  blank,
  log,
  step,
  downloading,
  ok,
  warn,
  fail,
  fatal,
  separator,
} from "./output.js";
import { confirm } from "./confirm.js";
import { checkForUpdate } from "./update-check.js";
import type { TranslationReport } from "./types.js";
import { readJsonFile, listSubdirs } from "./utils.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PKG = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
) as { version: string; name: string };

const UNI_HOME =
  process.env.AI_PLUGIN_BRIDGE_HOME ?? join(process.env.HOME ?? "~", ".ai-plugin-bridge");

// ---------------------------------------------------------------------------
// Error-handling wrapper for command actions
// ---------------------------------------------------------------------------

function action<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      fatal(errorMessage(err), err);
    }
  };
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

program
  .name("uni")
  .description("Universal AI CLI plugin translator — import once, install everywhere")
  .version(PKG.version, "-v, --version", "Print version number")
  .option("--verbose", "Show full error stack traces and debug output")
  .option("-y, --yes", "Skip confirmation prompts");

program.addHelpText(
  "after",
  `
Examples:
  uni import gemini-cli-extensions/code-review
  uni import anthropics/claude-code --subdir plugins/ralph-wiggum
  uni sync                        Install all plugins from pluginfile.yaml
  uni sync --dry-run              Preview what would be installed
  uni list                        Show imported plugins
  uni report code-review          Show translation details
  uni publish code-review         Publish to your registry
  uni doctor                      Check environment and tool availability
`
);

program.hook("preAction", () => {
  const opts = program.opts<{ verbose?: boolean; yes?: boolean }>();
  setVerbose(opts.verbose ?? false);
  setYes(opts.yes ?? false);
});

program.hook("postAction", async () => {
  const update = await checkForUpdate(UNI_HOME, PKG.name);
  if (update) {
    console.log(
      chalk.dim(
        `\nuni · Update available: ${update.current} → ${update.latest}. Run 'npm update -g ${PKG.name}' to update.`
      )
    );
  }
});

// ---------------------------------------------------------------------------
// uni import <source> [--ref <ref>] [--subdir <path>] [--only <tools>]
// ---------------------------------------------------------------------------

program
  .command("import")
  .description("Import a plugin from a GitHub repo and translate for all tools")
  .argument("<source>", "GitHub repo (owner/repo) or full URL")
  .option("--ref <ref>", "Git ref to pin (tag, branch, or SHA)", "main")
  .option("--subdir <path>", "Subdirectory within the repo containing the plugin")
  .option(
    "--only <tools>",
    "Comma-separated list of target tools (claude-code,gemini-cli,copilot-cli)"
  )
  .addHelpText(
    "after",
    `
Examples:
  uni import gemini-cli-extensions/code-review
  uni import gemini-cli-extensions/jules --ref v1.2.0
  uni import anthropics/claude-code --subdir plugins/ralph-wiggum
  uni import github/awesome-copilot --subdir plugins/software-engineering-team --only claude-code,gemini-cli
`
  )
  .action(
    action(async (source: string, opts) => {
      const ref: string = opts.ref;
      const subdir: string | undefined = opts.subdir;
      const targets: ToolId[] | undefined = opts.only
        ?.split(",")
        .map((t: string) => t.trim() as ToolId);

      const gitUrl = normalizeGitUrl(source);
      const repoName = basename(source).replace(/\.git$/, "");

      header(`Importing ${chalk.bold(repoName)} from ${source}`);

      const sourcesDir = join(UNI_HOME, "sources", repoName);
      downloading(
        existsSync(sourcesDir) ? `Updating (ref: ${ref})` : `Cloning (ref: ${ref})`
      );

      cloneOrUpdate(sourcesDir, gitUrl, ref);
      const pinnedRef = pinnedCommit(sourcesDir);
      console.log(` ${chalk.green("done")} ${chalk.dim(`(pinned: ${pinnedRef.slice(0, 8)})`)}`);

      const pluginDir = subdir ? join(sourcesDir, subdir) : sourcesDir;
      if (!existsSync(pluginDir)) {
        const available = listSubdirs(sourcesDir);
        fatal(
          `Subdirectory "${subdir}" not found in ${source}.` +
            (available ? `\nAvailable directories: ${available}` : "")
        );
      }

      // Detect monorepo — if no --subdir and plugins/ contains multiple dirs
      if (!subdir) {
        const pluginsDir = join(pluginDir, "plugins");
        if (existsSync(pluginsDir)) {
          const entries = readdirSync(pluginsDir).filter((e) =>
            statSync(join(pluginsDir, e)).isDirectory()
          );
          if (entries.length > 1) {
            fail(
              `This looks like a monorepo with ${entries.length} plugins under plugins/.\n` +
                `  Use --subdir to select one. Available plugins:\n` +
                entries.sort().map((e) => `    ${source} --subdir plugins/${e}`).join("\n")
            );
            process.exit(1);
          }
        }
      }

      const distDir = join(UNI_HOME, "dist");
      const result = translate({
        pluginDir,
        outputDir: distDir,
        source: { repo: source, subdir, ref: pinnedRef },
        targets,
        onProgress: (msg, type) => {
          if (type === "ok") ok(msg);
          else if (type === "warn") warn(msg);
          else step(msg);
        },
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

      blank();
      ok(`Imported ${chalk.bold(result.plugin.name)}`);
      log(chalk.dim(`Run 'uni install ${result.plugin.name}' to install, or 'uni sync' if using a pluginfile.`));
    })
  );

// ---------------------------------------------------------------------------
// uni install <name> [--only <tools>] [--dry-run] [--yes]
// ---------------------------------------------------------------------------

program
  .command("install")
  .description("Install a translated plugin into target CLI tools")
  .argument("<name>", "Plugin name (as shown in registry)")
  .option("--only <tools>", "Comma-separated list of target tools to install to")
  .option("--dry-run", "Print install commands without executing them")
  .addHelpText(
    "after",
    `
Examples:
  uni install code-review
  uni install code-review --only claude-code
  uni install code-review --dry-run
`
  )
  .action(
    action(async (name: string, opts) => {
      const distDir = join(UNI_HOME, "dist");
      const dryRun: boolean = opts.dryRun ?? false;
      const targets: ToolId[] = opts.only
        ? opts.only.split(",").map((t: string) => t.trim() as ToolId)
        : ALL_TOOLS;

      header(`${dryRun ? "[dry-run] " : ""}Installing ${chalk.bold(name)}`);

      // Warn about partial translations before proceeding
      if (!dryRun) {
        const partialTargets: Array<{ tool: ToolId; warnings: string[] }> = [];
        for (const tool of targets) {
          const reportPath = join(distDir, tool, name, "translation-report.json");
          const report = readJsonFile(reportPath) as TranslationReport | null;
          if (report?.partial && report.warnings.length > 0) {
            partialTargets.push({ tool, warnings: report.warnings });
          }
        }
        if (partialTargets.length > 0) {
          for (const { tool, warnings: ws } of partialTargets) {
            warn(`${chalk.bold(name)} has partial support on ${tool}:`);
            for (const w of ws) log(chalk.dim(`  ${w}`));
          }
          const proceed = await confirm("Install anyway?", false);
          if (!proceed) {
            log("Aborted.");
            return;
          }
          blank();
        }
      }

      for (const tool of targets) {
        const pluginDir = join(distDir, tool, name);
        if (!existsSync(pluginDir)) {
          log(chalk.dim(`${tool}: not translated — run 'uni import' first`));
          continue;
        }

        if (dryRun) {
          log(`${tool}: ${chalk.dim(installCommand(tool, name, distDir))}`);
          continue;
        }

        if (!isToolAvailable(tool)) {
          warn(`${tool}: skipped — '${toolBinary(tool)}' not found in PATH`);
          continue;
        }

        try {
          installToTool(tool, name);
          ok(`${tool}: installed`);
        } catch (err) {
          fail(`${tool}: failed — ${errorMessage(err)}`);
        }
      }

      blank();
    })
  );

// ---------------------------------------------------------------------------
// uni list [--registry] [--registry-dir <path>]
// ---------------------------------------------------------------------------

program
  .command("list")
  .description("List imported plugins, or plugins available in the registry")
  .option("--registry", "List plugins available in the remote registry")
  .option(
    "--registry-dir <path>",
    "Path to local registry clone",
    join(UNI_HOME, "registries", "default")
  )
  .addHelpText(
    "after",
    `
Examples:
  uni list
  uni list --registry
`
  )
  .action(
    action((_opts) => {
      const opts = _opts as { registry?: boolean; registryDir: string };
      if (opts.registry) {
        const index = loadRegistryIndex(opts.registryDir);
        const entries = Object.entries(index.plugins);
        if (entries.length === 0) {
          log("No plugins in registry. Run: uni publish <name>");
          return;
        }
        header("Available in registry");
        blank();
        for (const [name, entry] of entries) {
          log(
            `${chalk.bold(name)} ${chalk.dim(`(${entry.sourceTool})`)} — targets: ${entry.targets.join(", ")}`
          );
        }
        blank();
        return;
      }

      const registry = loadRegistry(UNI_HOME);
      if (Object.keys(registry).length === 0) {
        log("No plugins imported yet. Run: uni import <source>");
        return;
      }

      header("Imported plugins");
      blank();
      for (const [name, entry] of Object.entries(registry)) {
        const e = entry as Record<string, unknown>;
        log(
          `${chalk.bold(name)} ${chalk.dim(`(from ${e.sourceTool})`)} — ${e.source}@${(e.pinnedRef as string).slice(0, 8)}`
        );
        log(chalk.dim(`  Targets: ${(e.targets as string[]).join(", ")}`));
        log(chalk.dim(`  Translated: ${e.translatedAt}`));
      }
      blank();
    })
  );

// ---------------------------------------------------------------------------
// uni report <name>
// ---------------------------------------------------------------------------

program
  .command("report")
  .description("Show translation report for a plugin")
  .argument("<name>", "Plugin name")
  .addHelpText(
    "after",
    `
Examples:
  uni report code-review
  uni report jules
`
  )
  .action(
    action((name: string) => {
      const distDir = join(UNI_HOME, "dist");
      header(`Translation report: ${chalk.bold(name)}`);
      blank();

      let found = false;
      for (const tool of ALL_TOOLS) {
        const reportPath = join(distDir, tool, name, "translation-report.json");
        if (!existsSync(reportPath)) {
          log(chalk.dim(`${tool}: no translation found`));
          continue;
        }

        found = true;
        const report = JSON.parse(readFileSync(reportPath, "utf-8")) as TranslationReport;
        log(
          `${chalk.bold(tool)} ${chalk.dim(`(${report.partial ? "partial" : "full"})`)}`
        );

        for (const comp of report.components) {
          const icon =
            comp.status === "translated"
              ? chalk.green("✓")
              : comp.status === "partial"
                ? chalk.yellow("◐")
                : chalk.red("✗");
          const reason = comp.reason ? chalk.dim(` — ${comp.reason}`) : "";
          log(`  ${icon} ${comp.type}: ${comp.name}${reason}`);
        }

        for (const w of report.warnings) {
          warn(w);
        }
        blank();
      }

      if (!found) {
        log(`No translations found for "${name}". Run: uni import`);
      }
    })
  );

// ---------------------------------------------------------------------------
// uni remove <name> [--only <tools>] [--dry-run]
// ---------------------------------------------------------------------------

program
  .command("remove")
  .description("Uninstall a plugin from target CLI tools and remove translated files")
  .argument("<name>", "Plugin name (as shown in registry)")
  .option("--only <tools>", "Comma-separated list of target tools to uninstall from")
  .option("--dry-run", "Show what would be removed without executing")
  .addHelpText(
    "after",
    `
Examples:
  uni remove code-review
  uni remove code-review --only gemini-cli
  uni remove code-review --dry-run
`
  )
  .action(
    action(async (name: string, opts) => {
      const distDir = join(UNI_HOME, "dist");
      const dryRun: boolean = opts.dryRun ?? false;
      const targets: ToolId[] = opts.only
        ? opts.only.split(",").map((t: string) => t.trim() as ToolId)
        : ALL_TOOLS;

      const registry = loadRegistry(UNI_HOME);
      if (!registry[name]) {
        fatal(`Plugin "${name}" not found in registry. Run 'uni list' to see imported plugins.`);
      }

      header(`${dryRun ? "[dry-run] " : ""}Removing ${chalk.bold(name)}`);

      for (const tool of targets) {
        const pluginDir = join(distDir, tool, name);
        if (!existsSync(pluginDir)) {
          log(chalk.dim(`${tool}: not installed`));
          continue;
        }

        if (dryRun) {
          log(`${tool}: ${chalk.dim(uninstallCommand(tool, name))}`);
          log(chalk.dim(`  rm -rf ${pluginDir}`));
          continue;
        }

        try {
          execSync(uninstallCommand(tool, name), { stdio: "pipe" });
        } catch {
          // Tool may not have it installed — continue to clean up dist files
        }

        try {
          rmSync(pluginDir, { recursive: true, force: true });
          ok(`${tool}: removed`);
        } catch (err) {
          fail(`${tool}: failed — ${errorMessage(err)}`);
        }
      }

      if (!dryRun) {
        const claudeDistDir = join(distDir, "claude-code");
        if (existsSync(claudeDistDir)) {
          updateClaudeMarketplace(claudeDistDir);
        }

        if (ALL_TOOLS.every((t) => targets.includes(t))) {
          deleteRegistryEntry(UNI_HOME, name);
          ok("registry: entry removed");
        }
      }

      blank();
    })
  );

// ---------------------------------------------------------------------------
// uni sync [--file <path>] [--from-source] [--dry-run] [--init]
// ---------------------------------------------------------------------------

program
  .command("sync")
  .description("Sync plugins from a pluginfile.yaml — download, translate, and install")
  .option("--file <path>", "Path to pluginfile.yaml")
  .option("--from-source", "Force clone + translate from source repos, bypassing registry")
  .option("--dry-run", "Show what would be installed without executing")
  .option("--init", "Create a starter pluginfile.yaml in the current directory")
  .addHelpText(
    "after",
    `
Examples:
  uni sync
  uni sync --dry-run
  uni sync --from-source
  uni sync --init
  uni sync --file /path/to/pluginfile.yaml
`
  )
  .action(
    action(async (opts) => {
      if (opts.init) {
        generatePluginfile();
        return;
      }

      const { pluginfile, resolvedPath } = loadPluginfile(opts.file);
      log(chalk.dim(`Using pluginfile: ${resolvedPath}`));

      // Confirm if installing many plugins at once
      if (!opts.dryRun && pluginfile.plugins.length > 5) {
        warn(`About to sync ${pluginfile.plugins.length} plugins.`);
        const proceed = await confirm("Continue?", true);
        if (!proceed) {
          log("Aborted.");
          return;
        }
      }

      await sync({
        pluginfile,
        uniHome: UNI_HOME,
        fromSource: opts.fromSource ?? false,
        dryRun: opts.dryRun ?? false,
      });
    })
  );

// ---------------------------------------------------------------------------
// uni validate [--file <path>]
// ---------------------------------------------------------------------------

program
  .command("validate")
  .description("Validate pluginfile.yaml and report any issues")
  .option("--file <path>", "Path to pluginfile.yaml")
  .addHelpText(
    "after",
    `
Examples:
  uni validate
  uni validate --file ./myproject/pluginfile.yaml
`
  )
  .action(
    action((opts) => {
      const filePath = opts.file ?? join(process.cwd(), "pluginfile.yaml");
      if (!existsSync(filePath)) {
        fatal(`${filePath} not found. Run 'uni sync --init' to create one.`);
      }

      header(`Validating ${chalk.bold(filePath)}`);
      blank();

      const { pluginfile, warnings } = validatePluginfile(filePath);

      ok(`Parsed ${pluginfile.plugins.length} plugin${pluginfile.plugins.length !== 1 ? "s" : ""}`);
      if (pluginfile.registries && pluginfile.registries.length > 0) {
        ok(
          `Registries: ${pluginfile.registries.map((r) => `${r.name} (priority ${r.priority})`).join(", ")}`
        );
      }
      ok(`Default targets: ${pluginfile.targets.join(", ")}`);

      if (warnings.length === 0) {
        blank();
        ok("No issues found.");
      } else {
        blank();
        for (const w of warnings) {
          warn(w);
        }
      }
      blank();
    })
  );

// ---------------------------------------------------------------------------
// uni publish <name> [--registry <path>] [--all]
// ---------------------------------------------------------------------------

program
  .command("publish")
  .description("Publish translated plugins to a local registry repo clone")
  .argument("[name]", "Plugin name to publish")
  .option("--all", "Publish all imported plugins")
  .option(
    "--registry <path>",
    "Path to local registry repo clone",
    join(UNI_HOME, "registries", "default")
  )
  .addHelpText(
    "after",
    `
Examples:
  uni publish code-review
  uni publish --all
  uni publish code-review --registry /path/to/registry-repo
`
  )
  .action(
    action(async (name: string | undefined, opts) => {
      const registryDir: string = opts.registry;

      let names: string[];
      if (opts.all) {
        const registry = loadRegistry(UNI_HOME);
        names = Object.keys(registry);
        if (names.length === 0) {
          fatal("No plugins imported yet. Run: uni import <source>");
        }

        // Show list and confirm
        header(`Publishing ${names.length} plugin${names.length !== 1 ? "s" : ""} to registry`);
        blank();
        for (const n of names) log(`  ${chalk.bold(n)}`);
        blank();

        const proceed = await confirm(`Publish to ${registryDir}?`, true);
        if (!proceed) {
          log("Aborted.");
          return;
        }
      } else if (name) {
        names = [name];
      } else {
        fatal("Specify a plugin name or --all");
      }

      publish({ names, registryDir, uniHome: UNI_HOME });
    })
  );

// ---------------------------------------------------------------------------
// uni doctor
// ---------------------------------------------------------------------------

program
  .command("doctor")
  .description("Check environment and tool availability")
  .action(
    action(() => {
      header("Environment check");
      blank();

      // Tools
      log(chalk.bold("Tools:"));
      checkTool("claude (Claude Code CLI)", "claude", "https://claude.ai/code");
      checkTool("gemini (Gemini CLI)", "gemini", "https://github.com/google-gemini/gemini-cli");
      checkTool("copilot (Copilot CLI)", "copilot", "https://docs.github.com/copilot/cli");
      checkTool("git", "git", "https://git-scm.com");
      blank();

      // Data directory
      log(chalk.bold("Data directory:"));
      const dataDir = UNI_HOME;
      if (existsSync(dataDir)) {
        ok(`${chalk.dim(dataDir)}`);

        const sourcesDir = join(dataDir, "sources");
        const sourceCount = existsSync(sourcesDir)
          ? readdirSync(sourcesDir).filter((e) =>
              statSync(join(sourcesDir, e)).isDirectory()
            ).length
          : 0;
        log(chalk.dim(`  sources/      ${sourceCount} repo${sourceCount !== 1 ? "s" : ""} cloned`));

        const distDir = join(dataDir, "dist");
        let distCount = 0;
        if (existsSync(distDir)) {
          for (const tool of ALL_TOOLS) {
            const toolDir = join(distDir, tool);
            if (existsSync(toolDir)) {
              distCount = Math.max(
                distCount,
                readdirSync(toolDir).filter((e) =>
                  statSync(join(toolDir, e)).isDirectory()
                ).length
              );
            }
          }
        }
        log(chalk.dim(`  dist/         ${distCount} plugin${distCount !== 1 ? "s" : ""} translated`));

        const registry = loadRegistry(dataDir);
        const regCount = Object.keys(registry).length;
        log(chalk.dim(`  registry.json ${regCount} plugin${regCount !== 1 ? "s" : ""} registered`));
      } else {
        warn(`Data directory not found: ${chalk.dim(dataDir)}`);
        log(chalk.dim(`  It will be created on first 'uni import' or 'uni sync'.`));
      }
      blank();

      // Registries
      const globalConfig = loadGlobalConfig(UNI_HOME);
      let pfRegistries: typeof globalConfig.registries = [];
      const pfPath2 = join(process.cwd(), "pluginfile.yaml");
      if (existsSync(pfPath2)) {
        try {
          const { pluginfile: pf } = validatePluginfile(pfPath2);
          pfRegistries = pf.registries ?? [];
        } catch {
          // Ignore — reported in the Pluginfile section below
        }
      }
      const allRegistries = mergeRegistries(globalConfig.registries, pfRegistries);
      if (allRegistries.length > 0) {
        blank();
        log(chalk.bold("Registries:"));
        const manager = new RegistryManager(UNI_HOME);
        for (const reg of allRegistries) {
          const regDir = manager.registryDir(reg.name);
          if (existsSync(join(regDir, ".git"))) {
            try {
              const count = manager.pluginCount(reg.name);
              const updated = manager.lastUpdated(reg.name);
              const ago = updated ? relativeTime(updated) : "unknown";
              ok(
                `${chalk.bold(reg.name)} — ${count} plugin${count !== 1 ? "s" : ""} (last updated: ${ago})`
              );
            } catch {
              ok(`${chalk.bold(reg.name)} — cloned`);
            }
          } else {
            fail(
              `${chalk.bold(reg.name)} — not yet cloned (run 'uni sync' or 'uni registry update ${reg.name}')`
            );
          }
        }
      }

      // Pluginfile
      log(chalk.bold("Pluginfile:"));
      const pfPath = join(process.cwd(), "pluginfile.yaml");
      if (existsSync(pfPath)) {
        try {
          const { pluginfile } = validatePluginfile(pfPath);
          ok(
            `${chalk.dim("./pluginfile.yaml")} — ${pluginfile.plugins.length} plugin${pluginfile.plugins.length !== 1 ? "s" : ""}`
          );
        } catch (err) {
          fail(`./pluginfile.yaml — ${errorMessage(err)}`);
        }
      } else {
        log(chalk.dim("No pluginfile.yaml in current directory."));
        log(chalk.dim("Run 'uni sync --init' to create one."));
      }
      blank();

      // Issues summary
      const issues = collectIssues();
      if (issues.length > 0) {
        log(chalk.bold("Issues:"));
        for (const issue of issues) warn(issue);
        blank();
      }
    })
  );

// ---------------------------------------------------------------------------
// uni clean [--all] [--plugin <name>]
// ---------------------------------------------------------------------------

program
  .command("clean")
  .description("Remove cached source clones and free disk space")
  .option("--all", "Remove everything under the data directory and start fresh")
  .option("--plugin <name>", "Remove a specific plugin from sources, dist, and registry")
  .addHelpText(
    "after",
    `
Examples:
  uni clean                      Remove sources/ (keeps dist/ and registry)
  uni clean --all                Remove everything under ~/.ai-plugin-bridge/
  uni clean --plugin code-review Remove a specific plugin completely
`
  )
  .action(
    action(async (opts) => {
      if (opts.all) {
        header("Clean everything");
        warn(`This will remove all data under ${chalk.dim(UNI_HOME)}.`);
        warn(`You will need to re-run 'uni import' or 'uni sync' afterwards.`);
        const proceed = await confirm("Remove everything?", false);
        if (!proceed) {
          log("Aborted.");
          return;
        }
        if (existsSync(UNI_HOME)) {
          rmSync(UNI_HOME, { recursive: true, force: true });
          ok(`Removed ${UNI_HOME}`);
        } else {
          log("Nothing to remove.");
        }
        blank();
        return;
      }

      if (opts.plugin) {
        const name: string = opts.plugin;
        header(`Removing plugin: ${chalk.bold(name)}`);

        const registry = loadRegistry(UNI_HOME);
        if (!registry[name]) {
          fatal(`Plugin "${name}" not found in registry. Run 'uni list' to see imported plugins.`);
        }

        // Uninstall from tools and remove dist
        const distDir = join(UNI_HOME, "dist");
        for (const tool of ALL_TOOLS) {
          const pluginDir = join(distDir, tool, name);
          if (!existsSync(pluginDir)) continue;
          try {
            execSync(uninstallCommand(tool, name), { stdio: "pipe" });
          } catch {
            // Not installed in tool — skip
          }
          rmSync(pluginDir, { recursive: true, force: true });
          ok(`${tool}: removed`);
        }

        // Remove source clone if it exists
        const sourceKey = (registry[name] as Record<string, unknown>).source as string;
        const repoName = basename(sourceKey).replace(/\.git$/, "");
        const sourcesDir = join(UNI_HOME, "sources", repoName);
        if (existsSync(sourcesDir)) {
          rmSync(sourcesDir, { recursive: true, force: true });
          ok(`sources/${repoName}: removed`);
        }

        deleteRegistryEntry(UNI_HOME, name);
        ok("registry: entry removed");

        const claudeDistDir = join(distDir, "claude-code");
        if (existsSync(claudeDistDir)) {
          updateClaudeMarketplace(claudeDistDir);
        }

        blank();
        return;
      }

      // Default: remove sources/ only
      header("Clean sources");
      const sourcesDir = join(UNI_HOME, "sources");
      if (!existsSync(sourcesDir)) {
        log("sources/ does not exist — nothing to remove.");
        blank();
        return;
      }

      const size = dirSize(sourcesDir);
      const proceed = await confirm(
        `Remove sources/ (${formatSize(size)})? Dist and registry will be preserved.`,
        true
      );
      if (!proceed) {
        log("Aborted.");
        return;
      }

      rmSync(sourcesDir, { recursive: true, force: true });
      ok(`Removed sources/ (freed ~${formatSize(size)})`);
      log(chalk.dim("Re-run 'uni sync --from-source' to re-clone when needed."));
      blank();
    })
  );

// ---------------------------------------------------------------------------
// uni completions <shell>
// ---------------------------------------------------------------------------

program
  .command("completions")
  .description("Output shell completion script")
  .argument("<shell>", "Shell type: bash, zsh, or fish")
  .addHelpText(
    "after",
    `
Examples:
  uni completions bash >> ~/.bashrc
  uni completions zsh >> ~/.zshrc
  uni completions fish > ~/.config/fish/completions/uni.fish
`
  )
  .action(
    action((shell: string) => {
      const commands = [
        "import",
        "install",
        "list",
        "report",
        "remove",
        "sync",
        "validate",
        "publish",
        "registry",
        "doctor",
        "clean",
        "completions",
      ];

      switch (shell) {
        case "bash":
          console.log(bashCompletion(commands));
          break;
        case "zsh":
          console.log(zshCompletion(commands));
          break;
        case "fish":
          console.log(fishCompletion(commands));
          break;
        default:
          fatal(`Unknown shell "${shell}". Supported: bash, zsh, fish`);
      }
    })
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolBinary(tool: ToolId): string {
  const map: Record<ToolId, string> = {
    "claude-code": "claude",
    "gemini-cli": "gemini",
    "copilot-cli": "copilot",
  };
  return map[tool];
}

function isToolAvailable(tool: ToolId): boolean {
  try {
    execSync(`which ${toolBinary(tool)}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function uninstallCommand(tool: ToolId, name: string): string {
  switch (tool) {
    case "claude-code":
      return `claude plugin uninstall "${name}@ai-plugin-bridge-local"`;
    case "gemini-cli":
      return `gemini extensions uninstall "${name}"`;
    case "copilot-cli":
      return `copilot plugin uninstall "${name}"`;
  }
}

function installCommand(tool: ToolId, name: string, distDir: string): string {
  switch (tool) {
    case "claude-code":
      return `claude plugin install "${name}@ai-plugin-bridge-local"`;
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

function checkTool(label: string, binary: string, installUrl: string): void {
  try {
    const ver = execSync(`${binary} --version 2>&1`, {
      encoding: "utf-8",
      stdio: "pipe",
    })
      .trim()
      .split("\n")[0];
    ok(`${chalk.bold(label)} — ${chalk.dim(ver)}`);
  } catch {
    fail(`${chalk.bold(label)} — not found`);
    log(chalk.dim(`  Install from: ${installUrl}`));
  }
}

function collectIssues(): string[] {
  const issues: string[] = [];
  for (const tool of ALL_TOOLS) {
    if (!isToolAvailable(tool)) {
      issues.push(
        `${toolBinary(tool)} not found in PATH — plugins targeting ${tool} will fail to install`
      );
    }
  }
  return issues;
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  };
  try {
    walk(dir);
  } catch {
    /* ignore */
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function generatePluginfile(): void {
  const outPath = join(process.cwd(), "pluginfile.yaml");
  if (existsSync(outPath)) {
    warn("pluginfile.yaml already exists in current directory");
    return;
  }

  const registry = loadRegistry(UNI_HOME);
  const entries = Object.entries(registry);

  let yaml = `# ai-plugin-bridge pluginfile — run "uni sync" to install all plugins\n\n`;
  yaml += `# registries:\n#   - name: community\n#     url: https://github.com/owner/ai-plugin-bridge-registry\n#     priority: 1\n\n`;
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
      if (e.subdir) yaml += `    subdir: ${e.subdir}\n`;
      const pluginTargets = e.targets as string[] | undefined;
      if (pluginTargets && pluginTargets.length < ALL_TOOLS.length) {
        yaml += `    targets:\n`;
        for (const t of pluginTargets) yaml += `      - ${t}\n`;
      }
      yaml += `\n`;
    }
  }

  writeFileSync(outPath, yaml);
  ok("Created pluginfile.yaml");
  log(chalk.dim("Edit it to configure your plugins, then run: uni sync"));
  blank();
}

// ---------------------------------------------------------------------------
// uni registry list | add | remove | update | search
// ---------------------------------------------------------------------------

const registryCmd = program
  .command("registry")
  .description("Manage plugin registries");

registryCmd
  .command("list")
  .description("List configured registries and their status")
  .action(
    action(() => {
      const globalConfig = loadGlobalConfig(UNI_HOME);
      let pfRegistries: typeof globalConfig.registries = [];
      const pfPath = join(process.cwd(), "pluginfile.yaml");
      if (existsSync(pfPath)) {
        try {
          const { pluginfile: pf } = validatePluginfile(pfPath);
          pfRegistries = pf.registries ?? [];
        } catch {
          /* ignore */
        }
      }
      const registries = mergeRegistries(globalConfig.registries, pfRegistries);

      if (registries.length === 0) {
        header("Configured registries");
        blank();
        log("No registries configured.");
        log(chalk.dim("Use 'uni registry add <name> <url>' or add a 'registries' section to pluginfile.yaml."));
        blank();
        return;
      }

      header("Configured registries");
      blank();
      const manager = new RegistryManager(UNI_HOME);
      for (const reg of registries) {
        const regDir = manager.registryDir(reg.name);
        const cloned = existsSync(join(regDir, ".git"));
        const source = globalConfig.registries.some((r) => r.name === reg.name)
          ? "global"
          : "pluginfile";
        if (cloned) {
          try {
            const count = manager.pluginCount(reg.name);
            const updated = manager.lastUpdated(reg.name);
            const ago = updated ? relativeTime(updated) : "unknown";
            ok(
              `${chalk.bold(reg.name)} ${chalk.dim(`(priority ${reg.priority}, ${source})`)} — ${count} plugin${count !== 1 ? "s" : ""}, updated ${ago}`
            );
            log(chalk.dim(`  ${reg.url}`));
          } catch {
            ok(`${chalk.bold(reg.name)} ${chalk.dim(`(priority ${reg.priority}, ${source})`)} — cloned`);
            log(chalk.dim(`  ${reg.url}`));
          }
        } else {
          fail(
            `${chalk.bold(reg.name)} ${chalk.dim(`(priority ${reg.priority}, ${source})`)} — not yet cloned`
          );
          log(chalk.dim(`  ${reg.url}`));
        }
      }
      blank();
    })
  );

registryCmd
  .command("add")
  .description("Add a registry to global config (~/.ai-plugin-bridge/config.yaml)")
  .argument("<name>", "Registry name (used in per-plugin registry pinning)")
  .argument("<url>", "Git-cloneable URL (HTTPS or SSH)")
  .option("--priority <n>", "Lookup priority — lower number checked first", "999")
  .addHelpText(
    "after",
    `
Examples:
  uni registry add company https://github.com/acme/plugins --priority 1
  uni registry add community git@github.com:george/ai-plugin-bridge-registry.git
`
  )
  .action(
    action((name: string, url: string, opts) => {
      const priority = parseInt(opts.priority, 10);
      const globalConfig = loadGlobalConfig(UNI_HOME);

      const existing = globalConfig.registries.findIndex((r) => r.name === name);
      if (existing !== -1) {
        globalConfig.registries[existing] = { name, url, priority };
        saveGlobalConfig(UNI_HOME, globalConfig);
        ok(`Updated registry "${name}" in global config`);
      } else {
        globalConfig.registries.push({ name, url, priority });
        saveGlobalConfig(UNI_HOME, globalConfig);
        ok(`Added registry "${name}" to global config`);
      }
      log(chalk.dim("Run 'uni registry update' to clone it, or 'uni sync' to use it."));
      blank();
    })
  );

registryCmd
  .command("remove")
  .description("Remove a registry from global config")
  .argument("<name>", "Registry name")
  .action(
    action(async (name: string) => {
      const globalConfig = loadGlobalConfig(UNI_HOME);
      const idx = globalConfig.registries.findIndex((r) => r.name === name);
      if (idx === -1) {
        fatal(`Registry "${name}" not found in global config. Run 'uni registry list' to see configured registries.`);
      }

      const proceed = await confirm(
        `Remove registry "${name}" from global config?`,
        false
      );
      if (!proceed) {
        log("Aborted.");
        return;
      }

      globalConfig.registries.splice(idx, 1);
      saveGlobalConfig(UNI_HOME, globalConfig);
      ok(`Removed registry "${name}" from global config`);
      log(chalk.dim("The local clone under ~/.ai-plugin-bridge/registries/ is preserved. Run 'uni clean' to remove it."));
      blank();
    })
  );

registryCmd
  .command("update")
  .description("Pull latest changes for one or all registries")
  .argument("[name]", "Registry name (omit to update all configured registries)")
  .action(
    action((name: string | undefined) => {
      const globalConfig = loadGlobalConfig(UNI_HOME);
      let pfRegistries: typeof globalConfig.registries = [];
      const pfPath = join(process.cwd(), "pluginfile.yaml");
      if (existsSync(pfPath)) {
        try {
          const { pluginfile: pf } = validatePluginfile(pfPath);
          pfRegistries = pf.registries ?? [];
        } catch {
          /* ignore */
        }
      }
      const registries = mergeRegistries(globalConfig.registries, pfRegistries);

      const targets = name
        ? registries.filter((r) => r.name === name)
        : registries;

      if (targets.length === 0) {
        fatal(
          name
            ? `Registry "${name}" not found. Run 'uni registry list' to see configured registries.`
            : "No registries configured. Run 'uni registry add <name> <url>'."
        );
      }

      const manager = new RegistryManager(UNI_HOME);
      for (const reg of targets) {
        step(`Updating ${chalk.bold(reg.name)}...`);
        try {
          manager.sync(reg);
          const count = manager.pluginCount(reg.name);
          ok(`${chalk.bold(reg.name)} — ${count} plugin${count !== 1 ? "s" : ""}`);
        } catch (err) {
          fail(`${chalk.bold(reg.name)} — ${errorMessage(err)}`);
        }
      }
      blank();
    })
  );

registryCmd
  .command("search")
  .description("Search plugins across all configured registries")
  .argument("<query>", "Search query (matches plugin names and descriptions)")
  .addHelpText(
    "after",
    `
Examples:
  uni registry search code-review
  uni registry search mcp
`
  )
  .action(
    action((query: string) => {
      const globalConfig = loadGlobalConfig(UNI_HOME);
      let pfRegistries: typeof globalConfig.registries = [];
      const pfPath = join(process.cwd(), "pluginfile.yaml");
      if (existsSync(pfPath)) {
        try {
          const { pluginfile: pf } = validatePluginfile(pfPath);
          pfRegistries = pf.registries ?? [];
        } catch {
          /* ignore */
        }
      }
      const registries = mergeRegistries(globalConfig.registries, pfRegistries);

      if (registries.length === 0) {
        log("No registries configured. Run 'uni registry add <name> <url>'.");
        return;
      }

      header(`Search results for "${query}"`);
      blank();

      const manager = new RegistryManager(UNI_HOME);
      const names = registries.map((r) => r.name);
      const results = manager.search(names, query);

      if (results.length === 0) {
        log(`No plugins found matching "${query}".`);
      } else {
        for (const { registryName, name, entry } of results) {
          log(
            `${chalk.bold(name)} ${chalk.dim(`(${registryName})`)}`
          );
          if (entry.description) {
            log(chalk.dim(`  ${entry.description}`));
          }
          log(chalk.dim(`  targets: ${entry.targets.join(", ")}`));
        }
      }
      blank();
    })
  );

// ---------------------------------------------------------------------------
// Shell completion scripts
// ---------------------------------------------------------------------------

const COMPLETION_DEFS: Record<string, string> = {
  import: "Import a plugin from a GitHub repo",
  install: "Install a translated plugin into target tools",
  list: "List imported plugins",
  report: "Show translation report for a plugin",
  remove: "Remove a plugin",
  sync: "Sync plugins from pluginfile.yaml",
  validate: "Validate pluginfile.yaml",
  publish: "Publish translated plugins to a registry",
  registry: "Manage plugin registries",
  doctor: "Check environment and tool availability",
  clean: "Remove cached source clones",
  completions: "Output shell completion script",
};

function bashCompletion(commands: string[]): string {
  return `# uni bash completion
# Add to ~/.bashrc: eval "$(uni completions bash)"

_uni_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commands.join(" ")}"
  COMPREPLY=($(compgen -W "$commands" -- "$cur"))
}
complete -F _uni_completion uni`;
}

function zshCompletion(commands: string[]): string {
  const lines = commands
    .map((c) => `    '${c}:${COMPLETION_DEFS[c] ?? c}'`)
    .join("\n");

  return `#compdef uni
# uni zsh completion
# Add to ~/.zshrc: eval "$(uni completions zsh)"

_uni() {
  local -a commands
  commands=(
${lines}
  )
  _describe 'uni commands' commands
}
_uni "$@"`;
}

function fishCompletion(commands: string[]): string {
  const lines = commands
    .map(
      (c) =>
        `complete -c uni -n '__fish_use_subcommand' -a ${c} -d '${COMPLETION_DEFS[c] ?? c}'`
    )
    .join("\n");

  return `# uni fish completion
# Install: uni completions fish > ~/.config/fish/completions/uni.fish

complete -c uni -f
${lines}`;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse();

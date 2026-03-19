import { join } from "node:path";
import { mkdirSync } from "node:fs";
import chalk from "chalk";
import type {
  ToolId,
  UniversalPlugin,
  PluginSource,
  TranslationReport,
} from "./types.js";
import { detectSourceTool } from "./detector.js";
import {
  parseClaudeCodePlugin,
  parseGeminiCliExtension,
  parseCopilotCliPlugin,
} from "./parsers/index.js";
import {
  generateClaudeCodePlugin,
  generateGeminiCliExtension,
  generateCopilotCliPlugin,
} from "./generators/index.js";

export interface TranslateOptions {
  /** Path to the locally cloned plugin directory */
  pluginDir: string;
  /** Where to write the translated outputs */
  outputDir: string;
  /** Source metadata */
  source: PluginSource;
  /** Which tools to generate for (defaults to all three) */
  targets?: ToolId[];
}

export interface TranslateResult {
  plugin: UniversalPlugin;
  reports: Map<ToolId, TranslationReport>;
}

/**
 * Translate a plugin from its native format to all target formats.
 */
export function translate(options: TranslateOptions): TranslateResult {
  const { pluginDir, outputDir, source } = options;
  const targets: ToolId[] = options.targets ?? [
    "claude-code",
    "gemini-cli",
    "copilot-cli",
  ];

  // Step 1: Detect source tool
  const detection = detectSourceTool(pluginDir);
  if (!detection) {
    throw new Error(
      `Could not detect plugin format in ${pluginDir}. ` +
        `Expected one of: .claude-plugin/plugin.json, gemini-extension.json, plugin.json`
    );
  }

  console.log(
    `  Detected: ${detection.tool} (${detection.confidence}) via ${detection.manifestPath}`
  );

  // Step 2: Parse into universal model
  const plugin = parse(detection.tool, pluginDir, source);

  console.log(`  Parsed: ${plugin.name} v${plugin.version}`);
  console.log(
    `  Components: ${plugin.mcpServers.length} MCP servers, ` +
      `${plugin.skills.length} skills, ${plugin.agents.length} agents, ` +
      `${plugin.commands.length} commands, ${plugin.hooks.length} hooks` +
      `${plugin.contextFile ? ", context file" : ""}`
  );

  // Step 3: Generate for each target
  const reports = new Map<ToolId, TranslationReport>();

  for (const target of targets) {
    const targetDir = join(outputDir, target, plugin.name);
    mkdirSync(targetDir, { recursive: true });

    console.log(`  Generating: ${target} → ${targetDir}`);

    const report = generate(target, plugin, targetDir);
    reports.set(target, report);

    const translated = report.components.filter(
      (c) => c.status === "translated"
    ).length;
    const skipped = report.components.filter(
      (c) => c.status === "skipped"
    ).length;
    const partial = report.components.filter(
      (c) => c.status === "partial"
    ).length;

    const parts: string[] = [];
    if (translated > 0) parts.push(chalk.green(`${translated} translated`));
    if (partial > 0) parts.push(chalk.yellow(`${partial} partial`));
    if (skipped > 0) parts.push(chalk.red(`${skipped} skipped`));
    console.log(`    Result: ${parts.join(", ")}`);

    if (report.warnings.length > 0) {
      for (const w of report.warnings) {
        console.log(`    ${chalk.yellow("⚠")} ${w}`);
      }
    }
  }

  return { plugin, reports };
}

function parse(
  tool: ToolId,
  pluginDir: string,
  source: PluginSource
): UniversalPlugin {
  switch (tool) {
    case "claude-code":
      return parseClaudeCodePlugin(pluginDir, source);
    case "gemini-cli":
      return parseGeminiCliExtension(pluginDir, source);
    case "copilot-cli":
      return parseCopilotCliPlugin(pluginDir, source);
  }
}

function generate(
  target: ToolId,
  plugin: UniversalPlugin,
  outputDir: string
): TranslationReport {
  switch (target) {
    case "claude-code":
      return generateClaudeCodePlugin(plugin, outputDir);
    case "gemini-cli":
      return generateGeminiCliExtension(plugin, outputDir);
    case "copilot-cli":
      return generateCopilotCliPlugin(plugin, outputDir);
  }
}

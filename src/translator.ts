import { join } from "node:path";
import { mkdirSync } from "node:fs";
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

export type ProgressFn = (msg: string, type: "step" | "ok" | "warn") => void;

export interface TranslateOptions {
  /** Path to the locally cloned plugin directory */
  pluginDir: string;
  /** Where to write the translated outputs */
  outputDir: string;
  /** Source metadata */
  source: PluginSource;
  /** Which tools to generate for (defaults to all three) */
  targets?: ToolId[];
  /**
   * Optional progress callback. When omitted, translate() runs silently.
   * The caller decides how to render progress messages.
   */
  onProgress?: ProgressFn;
}

export interface TranslateResult {
  plugin: UniversalPlugin;
  reports: Map<ToolId, TranslationReport>;
}

/**
 * Translate a plugin from its native format to all target formats.
 */
export function translate(options: TranslateOptions): TranslateResult {
  const { pluginDir, outputDir, source, onProgress } = options;
  const targets: ToolId[] = options.targets ?? [
    "claude-code",
    "gemini-cli",
    "copilot-cli",
  ];

  const emit = onProgress ?? (() => {});

  // Step 1: Detect source tool
  const detection = detectSourceTool(pluginDir);
  if (!detection) {
    throw new Error(
      `No plugin manifest detected in ${pluginDir}.\n` +
        `Expected one of: .claude-plugin/plugin.json, gemini-extension.json, plugin.json`
    );
  }

  emit(`Detected: ${detection.tool} extension`, "step");

  // Step 2: Parse into universal model
  const plugin = parse(detection.tool, pluginDir, source);

  emit(`Parsed: ${componentSummary(plugin)}`, "step");

  // Step 3: Generate for each target
  const reports = new Map<ToolId, TranslationReport>();

  for (const target of targets) {
    const targetDir = join(outputDir, target, plugin.name);
    mkdirSync(targetDir, { recursive: true });

    emit(`Generating ${target}...`, "step");

    const report = generate(target, plugin, targetDir);
    reports.set(target, report);

    const summary = reportSummary(report);
    emit(`${target}: ${summary}`, report.partial ? "warn" : "ok");

    for (const w of report.warnings) {
      emit(w, "warn");
    }
  }

  return { plugin, reports };
}

function componentSummary(plugin: UniversalPlugin): string {
  const parts: string[] = [];
  if (plugin.mcpServers.length > 0)
    parts.push(`${plugin.mcpServers.length} MCP server${plugin.mcpServers.length > 1 ? "s" : ""}`);
  if (plugin.skills.length > 0)
    parts.push(`${plugin.skills.length} skill${plugin.skills.length > 1 ? "s" : ""}`);
  if (plugin.agents.length > 0)
    parts.push(`${plugin.agents.length} agent${plugin.agents.length > 1 ? "s" : ""}`);
  if (plugin.commands.length > 0)
    parts.push(`${plugin.commands.length} command${plugin.commands.length > 1 ? "s" : ""}`);
  if (plugin.hooks.length > 0)
    parts.push(`${plugin.hooks.length} hook${plugin.hooks.length > 1 ? "s" : ""}`);
  if (plugin.contextFile) parts.push("context file");
  return parts.join(", ") || "no components";
}

function reportSummary(report: TranslationReport): string {
  const translated = report.components.filter(
    (c) => c.status === "translated"
  ).length;
  const partialCount = report.components.filter(
    (c) => c.status === "partial"
  ).length;
  const skipped = report.components.filter(
    (c) => c.status === "skipped"
  ).length;

  const parts: string[] = [];
  parts.push(`${translated + partialCount} component${translated + partialCount !== 1 ? "s" : ""}`);
  if (partialCount > 0) parts.push(`${partialCount} partial`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(", ");
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

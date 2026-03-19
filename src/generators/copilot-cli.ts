import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeExtraFiles, writeTranslationReport } from "./shared.js";
import type {
  UniversalPlugin,
  TranslationReport,
  ComponentReport,
} from "../types.js";

export function generateCopilotCliPlugin(
  plugin: UniversalPlugin,
  outputDir: string
): TranslationReport {
  const components: ComponentReport[] = [];
  const warnings: string[] = [];

  mkdirSync(outputDir, { recursive: true });

  // Build plugin.json manifest
  const manifest: Record<string, unknown> = {
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    _translatedFrom: plugin.sourceTool,
    _sourceRepo: plugin.source.repo,
    _sourceRef: plugin.source.ref,
  };

  // 1. MCP servers → .mcp.json
  if (plugin.mcpServers.length > 0) {
    const mcpConfig: Record<string, unknown> = {};
    for (const server of plugin.mcpServers) {
      mcpConfig[server.name] = {
        command: server.command,
        args: server.args.map((a) =>
          a.replace(/\{\{PLUGIN_DIR\}\}/g, "${PLUGIN_DIR}")
        ),
        ...(server.cwd && {
          cwd: server.cwd.replace(/\{\{PLUGIN_DIR\}\}/g, "${PLUGIN_DIR}"),
        }),
        ...(server.env && { env: server.env }),
      };
      components.push({
        type: "mcp-server",
        name: server.name,
        status: "translated",
      });
    }
    writeFileSync(
      join(outputDir, ".mcp.json"),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2)
    );
    manifest.mcpServers = ".mcp.json";
  }

  // 2. Skills → skills/
  if (plugin.skills.length > 0) {
    for (const skill of plugin.skills) {
      const skillDir = join(outputDir, skill.path);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), skill.content);
      components.push({ type: "skill", name: skill.path, status: "translated" });
    }
    manifest.skills = "skills/";
  }

  // 3. Agents → agents/
  if (plugin.agents.length > 0) {
    const agentsDir = join(outputDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const agent of plugin.agents) {
      // Ensure filename ends with .agent.md for Copilot CLI
      const filename = agent.filename.endsWith(".agent.md")
        ? agent.filename
        : agent.filename.replace(/\.md$/, ".agent.md");

      writeFileSync(join(agentsDir, filename), agent.content);
      components.push({
        type: "agent",
        name: filename,
        status: "translated",
      });
    }
    manifest.agents = "agents/";
  }

  // 4. Commands → Copilot CLI doesn't have native slash commands.
  //    Convert to agents as best approximation.
  if (plugin.commands.length > 0) {
    const agentsDir = join(outputDir, "agents");
    mkdirSync(agentsDir, { recursive: true });

    for (const cmd of plugin.commands) {
      // Create a minimal agent from the command
      const agentContent = [
        "---",
        `name: cmd-${cmd.name}`,
        `description: Translated from ${plugin.sourceTool} command /${cmd.name}`,
        `tools: ["bash", "edit", "view"]`,
        "---",
        "",
        `# Command: /${cmd.name}`,
        "",
        "This agent was auto-translated from a slash command.",
        "Original command content below:",
        "",
        "```",
        cmd.content,
        "```",
      ].join("\n");

      writeFileSync(
        join(agentsDir, `cmd-${cmd.name}.agent.md`),
        agentContent
      );
      components.push({
        type: "command",
        name: cmd.name,
        status: "partial",
        reason:
          "Converted to agent — Copilot CLI has no native slash commands",
      });
    }

    if (!manifest.agents) manifest.agents = "agents/";
  }

  // 5. Context file → .copilot-instructions.md
  if (plugin.contextFile) {
    writeFileSync(
      join(outputDir, ".copilot-instructions.md"),
      plugin.contextFile.content
    );
    components.push({
      type: "context-file",
      name: ".copilot-instructions.md",
      status: "translated",
    });
  }

  // 6. Hooks
  for (const hook of plugin.hooks) {
    if (hook.sourceTool === "copilot-cli") {
      writeFileSync(
        join(outputDir, "hooks.json"),
        JSON.stringify(hook.raw, null, 2)
      );
      manifest.hooks = "hooks.json";
      components.push({ type: "hook", name: "hooks", status: "translated" });
    } else {
      components.push({
        type: "hook",
        name: "hooks",
        status: "skipped",
        reason: `${hook.sourceTool} hooks have no Copilot CLI equivalent yet`,
      });
      warnings.push(
        `Hooks from ${hook.sourceTool} were skipped — no translation available`
      );
    }
  }

  // Write manifest
  writeFileSync(
    join(outputDir, "plugin.json"),
    JSON.stringify(manifest, null, 2)
  );

  // 7. Extra files
  writeExtraFiles(plugin.extraFiles, outputDir);

  const report: TranslationReport = {
    sourceTool: plugin.sourceTool,
    targetTool: "copilot-cli",
    version: plugin.version,
    partial: components.some((c) => c.status !== "translated"),
    components,
    warnings,
  };
  writeTranslationReport(report, outputDir);
  return report;
}

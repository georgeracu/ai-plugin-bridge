import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeExtraFiles, writeTranslationReport } from "./shared.js";
import type {
  UniversalPlugin,
  TranslationReport,
  ComponentReport,
} from "../types.js";

export function generateGeminiCliExtension(
  plugin: UniversalPlugin,
  outputDir: string
): TranslationReport {
  const components: ComponentReport[] = [];
  const warnings: string[] = [...(plugin.parseWarnings ?? [])];

  mkdirSync(outputDir, { recursive: true });

  // Build the gemini-extension.json manifest
  const manifest: Record<string, unknown> = {
    name: plugin.name,
    version: plugin.version,
    _translatedFrom: plugin.sourceTool,
    _sourceRepo: plugin.source.repo,
    _sourceRef: plugin.source.ref,
  };

  // 1. MCP servers — inline in manifest
  if (plugin.mcpServers.length > 0) {
    const mcpServers: Record<string, unknown> = {};
    for (const server of plugin.mcpServers) {
      mcpServers[server.name] = {
        ...(server.command && { command: server.command }),
        args: server.args.map((a) =>
          a.replace(/\{\{PLUGIN_DIR\}\}/g, "${extensionPath}")
        ),
        ...(server.cwd && {
          cwd: server.cwd.replace(
            /\{\{PLUGIN_DIR\}\}/g,
            "${extensionPath}"
          ),
        }),
        ...(server.env && { env: server.env }),
      };
      if (!server.command) {
        components.push({
          type: "mcp-server",
          name: server.name,
          status: "partial",
          reason: "No command field — MCP server cannot be started",
        });
      } else {
        components.push({
          type: "mcp-server",
          name: server.name,
          status: "translated",
        });
      }
    }
    manifest.mcpServers = mcpServers;
  }

  // 2. Skills → skills/
  for (const skill of plugin.skills) {
    const skillDir = join(outputDir, skill.path);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), skill.content);
    components.push({
      type: "skill",
      name: skill.path,
      status: "translated",
    });
  }

  // 3. Agents → mapped as skills in Gemini CLI (no native agent concept)
  if (plugin.agents.length > 0) {
    for (const agent of plugin.agents) {
      const agentName =
        (agent.frontmatter.name as string) ??
        agent.filename.replace(/\.agent\.md$|\.md$/, "");

      // Convert agent to a skill (best approximation)
      const skillDir = join(outputDir, "skills", `agent-${agentName}`);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), agent.content);

      components.push({
        type: "agent",
        name: agent.filename,
        status: "partial",
        reason:
          "Converted to skill — Gemini CLI has no native agent concept",
      });
    }
  }

  // 4. Commands → commands/
  if (plugin.commands.length > 0) {
    for (const cmd of plugin.commands) {
      const cmdPath = join(outputDir, cmd.path);
      mkdirSync(join(cmdPath, ".."), { recursive: true });
      writeFileSync(cmdPath, cmd.content);
      components.push({
        type: "command",
        name: cmd.name,
        status: plugin.sourceTool === "gemini-cli" ? "translated" : "partial",
        reason:
          plugin.sourceTool !== "gemini-cli"
            ? "Command syntax may differ — review manually"
            : undefined,
      });
    }
  }

  // 5. Context file → GEMINI.md
  if (plugin.contextFile) {
    writeFileSync(join(outputDir, "GEMINI.md"), plugin.contextFile.content);
    manifest.contextFileName = "GEMINI.md";
    components.push({
      type: "context-file",
      name: "GEMINI.md",
      status: "translated",
    });
  }

  // 6. Hooks — skip for v1 (cross-tool hook translation is future work)
  for (const hook of plugin.hooks) {
    if (hook.sourceTool === "gemini-cli") {
      manifest.hooks = hook.raw;
      components.push({ type: "hook", name: "hooks", status: "translated" });
    } else {
      components.push({
        type: "hook",
        name: "hooks",
        status: "skipped",
        reason: `${hook.sourceTool} hooks have no Gemini CLI equivalent yet`,
      });
      warnings.push(
        `Hooks from ${hook.sourceTool} were skipped — no translation available`
      );
    }
  }

  // Write manifest
  writeFileSync(
    join(outputDir, "gemini-extension.json"),
    JSON.stringify(manifest, null, 2)
  );

  // 7. Extra files
  writeExtraFiles(plugin.extraFiles, outputDir);

  const report: TranslationReport = {
    sourceTool: plugin.sourceTool,
    targetTool: "gemini-cli",
    version: plugin.version,
    partial: components.some((c) => c.status !== "translated"),
    components,
    warnings,
  };
  writeTranslationReport(report, outputDir);
  return report;
}

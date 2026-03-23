import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { readJsonFile } from "../utils.js";
import { writeExtraFiles, writeTranslationReport } from "./shared.js";
import type {
  UniversalPlugin,
  TranslationReport,
  ComponentReport,
} from "../types.js";

export function generateClaudeCodePlugin(
  plugin: UniversalPlugin,
  outputDir: string
): TranslationReport {
  const components: ComponentReport[] = [];
  const warnings: string[] = [...(plugin.parseWarnings ?? [])];

  mkdirSync(outputDir, { recursive: true });

  // 1. Manifest: .claude-plugin/plugin.json
  const manifestDir = join(outputDir, ".claude-plugin");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, "plugin.json"),
    JSON.stringify(
      { name: plugin.name, version: plugin.version, description: plugin.description },
      null,
      2
    )
  );

  // 2. MCP servers → .mcp.json
  if (plugin.mcpServers.length > 0) {
    const mcpConfig: Record<string, unknown> = {};
    for (const server of plugin.mcpServers) {
      if (server.httpUrl) {
        // Remote HTTP/streamable-HTTP MCP server — Claude Code uses "url"
        mcpConfig[server.name] = {
          url: server.httpUrl,
          ...(server.headers && { headers: server.headers }),
          ...(server.timeout != null && { timeout: server.timeout }),
          ...(server.env && { env: server.env }),
        };
        components.push({ type: "mcp-server", name: server.name, status: "translated" });
      } else {
        // Local stdio MCP server
        mcpConfig[server.name] = {
          ...(server.command && { command: server.command }),
          args: server.args.map((a) =>
            a.replace(/\{\{PLUGIN_DIR\}\}/g, "${PLUGIN_DIR}")
          ),
          ...(server.cwd && {
            cwd: server.cwd.replace(/\{\{PLUGIN_DIR\}\}/g, "${PLUGIN_DIR}"),
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
          components.push({ type: "mcp-server", name: server.name, status: "translated" });
        }
      }
    }
    writeFileSync(
      join(outputDir, ".mcp.json"),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2)
    );
  }

  // 3. Skills → skills/
  for (const skill of plugin.skills) {
    const skillDir = join(outputDir, skill.path);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), skill.content);
    components.push({ type: "skill", name: skill.path, status: "translated" });
  }

  // 4. Agents → agents/
  if (plugin.agents.length > 0) {
    const agentsDir = join(outputDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const agent of plugin.agents) {
      writeFileSync(join(agentsDir, agent.filename), agent.content);
      components.push({ type: "agent", name: agent.filename, status: "translated" });
    }
  }

  // 5. Commands → commands/
  for (const cmd of plugin.commands) {
    const cmdPath = join(outputDir, cmd.path);
    mkdirSync(join(cmdPath, ".."), { recursive: true });
    writeFileSync(cmdPath, cmd.content);
    components.push({
      type: "command",
      name: cmd.name,
      status: plugin.sourceTool === "claude-code" ? "translated" : "partial",
      reason:
        plugin.sourceTool !== "claude-code"
          ? "Command syntax may differ — review manually"
          : undefined,
    });
  }

  // 6. Context file → CLAUDE.md
  if (plugin.contextFile) {
    writeFileSync(join(outputDir, "CLAUDE.md"), plugin.contextFile.content);
    components.push({ type: "context-file", name: "CLAUDE.md", status: "translated" });
  }

  // 7. Hooks — only pass through if source is also Claude Code
  for (const hook of plugin.hooks) {
    if (hook.sourceTool === "claude-code") {
      if (
        typeof hook.raw === "object" &&
        hook.raw !== null &&
        (hook.raw as Record<string, unknown>).type === "directory"
      ) {
        const hooksDir = join(outputDir, "hooks");
        mkdirSync(hooksDir, { recursive: true });
        const files = (hook.raw as { files: Record<string, string> }).files;
        for (const [filename, content] of Object.entries(files)) {
          writeFileSync(join(hooksDir, filename), content);
        }
      } else {
        writeFileSync(join(outputDir, "hooks.json"), JSON.stringify(hook.raw, null, 2));
      }
      components.push({ type: "hook", name: "hooks", status: "translated" });
    } else {
      components.push({
        type: "hook",
        name: "hooks",
        status: "skipped",
        reason: `${hook.sourceTool} hooks have no Claude Code equivalent yet`,
      });
      warnings.push(
        `Hooks from ${hook.sourceTool} were skipped — no translation available`
      );
    }
  }

  // 8. Extra files
  writeExtraFiles(plugin.extraFiles, outputDir);

  const report: TranslationReport = {
    sourceTool: plugin.sourceTool,
    targetTool: "claude-code",
    version: plugin.version,
    partial: components.some((c) => c.status !== "translated"),
    components,
    warnings,
  };
  writeTranslationReport(report, outputDir);
  return report;
}

/**
 * Regenerate the marketplace manifest at dist/claude-code/.claude-plugin/marketplace.json
 * by scanning all plugin subdirectories. Call this after any import or sync.
 */
export function updateClaudeMarketplace(claudeDistDir: string): void {
  const manifestDir = join(claudeDistDir, ".claude-plugin");
  mkdirSync(manifestDir, { recursive: true });

  const plugins: unknown[] = [];
  for (const entry of readdirSync(claudeDistDir)) {
    if (entry === ".claude-plugin") continue;
    const pluginJsonPath = join(claudeDistDir, entry, ".claude-plugin", "plugin.json");
    if (!existsSync(pluginJsonPath)) continue;
    const manifest = readJsonFile(pluginJsonPath) as Record<string, unknown> | null;
    if (!manifest) continue;
    plugins.push({
      name: manifest.name,
      description: manifest.description ?? "",
      version: manifest.version ?? "0.1.0",
      source: `./${entry}`,
    });
  }

  writeFileSync(
    join(manifestDir, "marketplace.json"),
    JSON.stringify(
      {
        $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
        name: "ai-plugin-bridge-local",
        description: "Locally translated plugins managed by ai-plugin-bridge",
        owner: { name: "ai-plugin-bridge" },
        plugins,
      },
      null,
      2
    )
  );
}

/**
 * Ensure the ai-plugin-bridge-local marketplace is registered with the Claude CLI.
 * Idempotent — safe to call on every install.
 */
export function ensureClaudeMarketplace(claudeDistDir: string): void {
  const marketplacePath = join(claudeDistDir, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) return;

  const absDir = resolve(claudeDistDir);
  try {
    const listed = execSync(
      "claude plugin marketplace list --json 2>/dev/null || echo '[]'",
      { encoding: "utf-8" }
    );
    const marketplaces = JSON.parse(listed || "[]") as { source?: string }[];
    const alreadyAdded = marketplaces.some(
      (m) => m.source === claudeDistDir || m.source === absDir
    );
    if (!alreadyAdded) {
      execSync(`claude plugin marketplace add "${absDir}"`, { stdio: "pipe" });
    }
  } catch {
    try {
      execSync(`claude plugin marketplace add "${absDir}"`, { stdio: "pipe" });
    } catch {
      // Already registered or unavailable
    }
  }
}

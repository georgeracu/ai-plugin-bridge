import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type {
  UniversalPlugin,
  PluginSource,
  McpServerConfig,
  Skill,
  Command,
  ContextFile,
  ExtraFile,
} from "../types.js";
import {
  readTextFile,
  readJsonFile,
  parseFrontmatter,
  collectCommandFiles,
  collectExtraDir,
} from "../utils.js";

export function parseGeminiCliExtension(
  pluginDir: string,
  source: PluginSource
): UniversalPlugin {
  const manifest = readJsonFile(
    join(pluginDir, "gemini-extension.json")
  ) as Record<string, unknown> | null;

  const name = (manifest?.name as string) ?? "unknown";
  const version = (manifest?.version as string) ?? source.ref;
  const description = (manifest?.description as string) ?? "";

  // MCP servers — defined inline in the manifest
  const { servers: mcpServers, warnings: parseWarnings } = parseMcpServers(manifest);

  // Skills
  const skills = parseSkills(pluginDir);

  // Commands
  const commands = parseCommands(pluginDir);

  // Context file — specified by contextFileName or defaults to GEMINI.md
  const contextFileName =
    (manifest?.contextFileName as string) ?? "GEMINI.md";
  const contextFile = parseContextFile(pluginDir, contextFileName);

  // Hooks (Gemini CLI defines them differently, capture raw for now)
  const hooks =
    manifest?.hooks != null
      ? [{ raw: manifest.hooks, sourceTool: "gemini-cli" as const }]
      : [];

  // Extra files (mcp-server source code, etc.)
  const extraFiles = parseExtraFiles(pluginDir, contextFileName);

  return {
    name,
    version,
    description,
    sourceTool: "gemini-cli",
    source,
    mcpServers,
    skills,
    agents: [], // Gemini CLI doesn't have a separate agents concept
    commands,
    hooks,
    contextFile,
    extraFiles,
    parseWarnings: parseWarnings.length > 0 ? parseWarnings : undefined,
  };
}

function parseMcpServers(
  manifest: Record<string, unknown> | null
): { servers: McpServerConfig[]; warnings: string[] } {
  if (!manifest?.mcpServers) return { servers: [], warnings: [] };

  const raw = manifest.mcpServers as Record<
    string,
    { command?: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  >;

  const servers: McpServerConfig[] = [];
  const warnings: string[] = [];

  for (const [name, config] of Object.entries(raw)) {
    if (!config.command) {
      warnings.push(
        `MCP server "${name}" has no command field — it cannot be started by any target tool`
      );
    }
    servers.push({
      name,
      command: config.command,
      args: (config.args ?? []).map((a) =>
        // Normalise Gemini's ${extensionPath} variable for later re-mapping
        a.replace(/\$\{extensionPath\}/g, "{{PLUGIN_DIR}}")
          .replace(/\$\{\/\}/g, "/")
      ),
      cwd: config.cwd?.replace(/\$\{extensionPath\}/g, "{{PLUGIN_DIR}}"),
      env: config.env,
    });
  }

  return { servers, warnings };
}

function parseSkills(pluginDir: string): Skill[] {
  const skillsDir = join(pluginDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillMd = readTextFile(join(skillDir, "SKILL.md"));
    if (!skillMd) continue;

    const { frontmatter } = parseFrontmatter(skillMd);
    skills.push({ path: `skills/${entry}`, content: skillMd, frontmatter });
  }
  return skills;
}

function parseCommands(pluginDir: string): Command[] {
  const commandsDir = join(pluginDir, "commands");
  if (!existsSync(commandsDir)) return [];

  const commands: Command[] = [];
  collectCommandFiles(commandsDir, commandsDir, commands);
  return commands;
}

function parseContextFile(
  pluginDir: string,
  filename: string
): ContextFile | undefined {
  const content = readTextFile(join(pluginDir, filename));
  if (!content) return undefined;
  return { content, originalFilename: filename };
}

function parseExtraFiles(
  pluginDir: string,
  contextFileName: string
): ExtraFile[] {
  const extras: ExtraFile[] = [];
  const knownDirs = new Set(["commands", "skills", "node_modules"]);
  const knownFiles = new Set([
    "gemini-extension.json",
    contextFileName,
    "README.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "package.json",
    "package-lock.json",
  ]);

  for (const entry of readdirSync(pluginDir)) {
    if (knownDirs.has(entry) || knownFiles.has(entry)) continue;
    if (entry.startsWith(".") && entry !== ".github") continue;

    const full = join(pluginDir, entry);
    if (statSync(full).isDirectory()) {
      collectExtraDir(full, pluginDir, extras);
    } else {
      const content = readTextFile(full);
      extras.push({ relativePath: entry, content, binary: content === null });
    }
  }
  return extras;
}


import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type {
  UniversalPlugin,
  PluginSource,
  McpServerConfig,
  Skill,
  Agent,
  Command,
  HookConfig,
  ContextFile,
  ExtraFile,
} from "../types.js";
import { readTextFile, readJsonFile, parseFrontmatter } from "../utils.js";

export function parseClaudeCodePlugin(
  pluginDir: string,
  source: PluginSource
): UniversalPlugin {
  // Read manifest
  const manifest = readJsonFile(
    join(pluginDir, ".claude-plugin", "plugin.json")
  ) as Record<string, unknown> | null;

  const name = (manifest?.name as string) ?? "unknown";
  const version = (manifest?.version as string) ?? source.ref;
  const description = (manifest?.description as string) ?? "";

  // MCP servers from .mcp.json
  const mcpServers = parseMcpJson(pluginDir);

  // Skills
  const skills = parseSkills(pluginDir);

  // Agents
  const agents = parseAgents(pluginDir);

  // Commands
  const commands = parseCommands(pluginDir);

  // Hooks
  const hooks = parseHooks(pluginDir);

  // Context file (CLAUDE.md)
  const contextFile = parseContextFile(pluginDir);

  // Extra files (scripts/, etc.)
  const extraFiles = parseExtraFiles(pluginDir);

  return {
    name,
    version,
    description,
    sourceTool: "claude-code",
    source,
    mcpServers,
    skills,
    agents,
    commands,
    hooks,
    contextFile,
    extraFiles,
  };
}

function parseMcpJson(pluginDir: string): McpServerConfig[] {
  const raw = readJsonFile(join(pluginDir, ".mcp.json")) as Record<
    string,
    unknown
  > | null;
  if (!raw?.mcpServers) return [];

  const servers = raw.mcpServers as Record<
    string,
    { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  >;

  return Object.entries(servers).map(([name, config]) => ({
    name,
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: config.env,
  }));
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
    skills.push({
      path: `skills/${entry}`,
      content: skillMd,
      frontmatter,
    });
  }
  return skills;
}

function parseAgents(pluginDir: string): Agent[] {
  const agentsDir = join(pluginDir, "agents");
  if (!existsSync(agentsDir)) return [];

  const agents: Agent[] = [];
  for (const entry of readdirSync(agentsDir)) {
    if (!entry.endsWith(".md")) continue;
    const content = readTextFile(join(agentsDir, entry));
    if (!content) continue;

    const { frontmatter } = parseFrontmatter(content);
    agents.push({ filename: entry, content, frontmatter });
  }
  return agents;
}

function parseCommands(pluginDir: string): Command[] {
  const commandsDir = join(pluginDir, "commands");
  if (!existsSync(commandsDir)) return [];

  const commands: Command[] = [];
  collectCommands(commandsDir, commandsDir, commands);
  return commands;
}

function collectCommands(
  dir: string,
  baseDir: string,
  commands: Command[]
): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectCommands(full, baseDir, commands);
      continue;
    }
    if (entry.endsWith(".toml") || entry.endsWith(".md")) {
      const content = readTextFile(full);
      if (!content) continue;
      const name = entry.replace(/\.(toml|md)$/, "");
      const relPath = full.substring(baseDir.length + 1);
      commands.push({ name, path: `commands/${relPath}`, content });
    }
  }
}

function parseHooks(pluginDir: string): HookConfig[] {
  // Check for hooks.json or hooks/ directory
  const hooksJson = readJsonFile(join(pluginDir, "hooks.json"));
  if (hooksJson) {
    return [{ raw: hooksJson, sourceTool: "claude-code" }];
  }

  const hooksDir = join(pluginDir, "hooks");
  if (existsSync(hooksDir)) {
    // Hooks directory with shell scripts — treat as opaque
    const files: Record<string, string> = {};
    for (const entry of readdirSync(hooksDir)) {
      const content = readTextFile(join(hooksDir, entry));
      if (content) files[entry] = content;
    }
    return [{ raw: { type: "directory", files }, sourceTool: "claude-code" }];
  }

  return [];
}

function parseContextFile(pluginDir: string): ContextFile | undefined {
  const content = readTextFile(join(pluginDir, "CLAUDE.md"));
  if (!content) return undefined;
  return { content, originalFilename: "CLAUDE.md" };
}

function parseExtraFiles(pluginDir: string): ExtraFile[] {
  const extras: ExtraFile[] = [];
  const knownDirs = new Set([
    ".claude-plugin",
    "commands",
    "agents",
    "skills",
    "hooks",
  ]);
  const knownFiles = new Set([
    ".mcp.json",
    "CLAUDE.md",
    "hooks.json",
    "README.md",
    "LICENSE",
    "package.json",
    "package-lock.json",
    "node_modules",
  ]);

  for (const entry of readdirSync(pluginDir)) {
    if (knownDirs.has(entry) || knownFiles.has(entry)) continue;
    if (entry.startsWith(".")) continue;

    const full = join(pluginDir, entry);
    if (statSync(full).isDirectory()) {
      // Collect all files in the directory
      collectExtraDir(full, pluginDir, extras);
    } else {
      const content = readTextFile(full);
      extras.push({
        relativePath: entry,
        content,
        binary: content === null,
      });
    }
  }
  return extras;
}

function collectExtraDir(
  dir: string,
  baseDir: string,
  extras: ExtraFile[]
): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.substring(baseDir.length + 1);
    if (statSync(full).isDirectory()) {
      collectExtraDir(full, baseDir, extras);
    } else {
      const content = readTextFile(full);
      extras.push({ relativePath: rel, content, binary: content === null });
    }
  }
}

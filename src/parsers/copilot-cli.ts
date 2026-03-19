import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type {
  UniversalPlugin,
  PluginSource,
  McpServerConfig,
  Skill,
  Agent,
  HookConfig,
  ExtraFile,
} from "../types.js";
import { readTextFile, readJsonFile, parseFrontmatter } from "../utils.js";

export function parseCopilotCliPlugin(
  pluginDir: string,
  source: PluginSource
): UniversalPlugin {
  // Copilot CLI can have plugin.json at root or .github/plugin/plugin.json
  let manifest = readJsonFile(join(pluginDir, "plugin.json")) as Record<
    string,
    unknown
  > | null;

  if (!manifest) {
    manifest = readJsonFile(
      join(pluginDir, ".github", "plugin", "plugin.json")
    ) as Record<string, unknown> | null;
  }

  const name = (manifest?.name as string) ?? "unknown";
  const version = (manifest?.version as string) ?? source.ref;
  const description = (manifest?.description as string) ?? "";

  // MCP servers from .mcp.json
  const mcpServers = parseMcpJson(pluginDir);

  // Skills — manifest can point to one or more directories
  const skills = parseSkills(pluginDir, manifest);

  // Agents — manifest points to agent directory
  const agents = parseAgents(pluginDir, manifest);

  // Hooks
  const hooks = parseHooks(pluginDir, manifest);

  // Context file (.copilot-instructions.md)
  const contextContent = readTextFile(
    join(pluginDir, ".copilot-instructions.md")
  );
  const contextFile = contextContent
    ? {
        content: contextContent,
        originalFilename: ".copilot-instructions.md",
      }
    : undefined;

  const extraFiles = parseExtraFiles(pluginDir);

  return {
    name,
    version,
    description,
    sourceTool: "copilot-cli",
    source,
    mcpServers,
    skills,
    agents,
    commands: [], // Copilot CLI uses agents instead of slash commands
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

function parseSkills(
  pluginDir: string,
  manifest: Record<string, unknown> | null
): Skill[] {
  // Manifest can specify skills as a string or array of strings
  const skillPaths = normalizeStringOrArray(manifest?.skills);
  if (skillPaths.length === 0) skillPaths.push("skills/");

  const skills: Skill[] = [];
  for (const sp of skillPaths) {
    const skillsDir = join(pluginDir, sp);
    if (!existsSync(skillsDir)) continue;

    for (const entry of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, entry);
      if (!statSync(skillDir).isDirectory()) continue;

      const skillMd = readTextFile(join(skillDir, "SKILL.md"));
      if (!skillMd) continue;

      const { frontmatter } = parseFrontmatter(skillMd);
      skills.push({
        path: `${sp}${entry}`,
        content: skillMd,
        frontmatter,
      });
    }
  }
  return skills;
}

function parseAgents(
  pluginDir: string,
  manifest: Record<string, unknown> | null
): Agent[] {
  const agentPaths = normalizeStringOrArray(manifest?.agents);
  if (agentPaths.length === 0) agentPaths.push("agents/");

  const agents: Agent[] = [];
  for (const ap of agentPaths) {
    const agentsDir = join(pluginDir, ap);
    if (!existsSync(agentsDir)) continue;

    for (const entry of readdirSync(agentsDir)) {
      if (!entry.endsWith(".md") && !entry.endsWith(".agent.md")) continue;
      const content = readTextFile(join(agentsDir, entry));
      if (!content) continue;

      const { frontmatter } = parseFrontmatter(content);
      agents.push({ filename: entry, content, frontmatter });
    }
  }
  return agents;
}

function parseHooks(
  pluginDir: string,
  manifest: Record<string, unknown> | null
): HookConfig[] {
  // hooks can be specified as a path in manifest or as hooks.json
  const hooksPath = (manifest?.hooks as string) ?? "hooks.json";
  const hooksJson = readJsonFile(join(pluginDir, hooksPath));
  if (hooksJson) {
    return [{ raw: hooksJson, sourceTool: "copilot-cli" }];
  }
  return [];
}

function parseExtraFiles(pluginDir: string): ExtraFile[] {
  const extras: ExtraFile[] = [];
  const knownDirs = new Set([
    "agents",
    "skills",
    ".github",
    "node_modules",
  ]);
  const knownFiles = new Set([
    "plugin.json",
    ".mcp.json",
    "hooks.json",
    ".copilot-instructions.md",
    "README.md",
    "LICENSE",
    "package.json",
    "package-lock.json",
  ]);

  for (const entry of readdirSync(pluginDir)) {
    if (knownDirs.has(entry) || knownFiles.has(entry)) continue;
    if (entry.startsWith(".")) continue;

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

function normalizeStringOrArray(
  value: unknown
): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value as string[];
  return [];
}

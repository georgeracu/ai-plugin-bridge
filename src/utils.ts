import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import type { ExtraFile, McpServerConfig, Command } from "./types.js";

/**
 * Read a text file, returning null if it doesn't exist or isn't readable.
 */
export function readTextFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read and parse a JSON file, returning null if it doesn't exist or is invalid.
 */
export function readJsonFile(path: string): unknown {
  const text = readTextFile(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter as a record and the body content.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = match[1];
  const body = match[2];

  // Simple YAML parser for flat key-value frontmatter
  const frontmatter: Record<string, unknown> = {};
  for (const line of rawYaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    // Handle quoted strings
    if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = (value as string).slice(1, -1);
    }

    // Handle arrays (simple inline YAML arrays)
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      try {
        value = JSON.parse(value);
      } catch {
        // Leave as string if it doesn't parse
      }
    }

    // Handle booleans
    if (value === "true") value = true;
    if (value === "false") value = false;

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Normalise a GitHub shorthand (owner/repo) or full URL to a git clone URL.
 */
export function normalizeGitUrl(source: string): string {
  return source.startsWith("https://")
    ? source
    : `https://github.com/${source}.git`;
}

/**
 * Clone a repo if it doesn't exist locally, or fetch + checkout + pull if it does.
 * Throws descriptive errors instead of raw execSync stderr.
 */
export function cloneOrUpdate(
  sourcesDir: string,
  gitUrl: string,
  ref: string
): void {
  if (existsSync(sourcesDir)) {
    try {
      execSync(`git -C "${sourcesDir}" fetch origin`, { stdio: "pipe" });
    } catch {
      throw new Error(
        `Could not fetch updates from ${gitUrl}.\n` +
          `Check your network connection and that the repository is accessible.`
      );
    }

    try {
      execSync(`git -C "${sourcesDir}" checkout ${ref}`, { stdio: "pipe" });
    } catch {
      const available = availableRefs(sourcesDir);
      throw new Error(
        `Ref "${ref}" not found in ${gitUrl}.` +
          (available ? `\nAvailable refs: ${available}` : "")
      );
    }

    try {
      execSync(`git -C "${sourcesDir}" pull origin ${ref}`, { stdio: "pipe" });
    } catch {
      // ref might be a commit SHA — pull will fail, that's fine
    }
  } else {
    mkdirSync(dirname(sourcesDir), { recursive: true });
    try {
      execSync(
        `git clone --depth 1 --branch ${ref} "${gitUrl}" "${sourcesDir}"`,
        { stdio: "pipe" }
      );
    } catch {
      throw new Error(
        `Could not clone ${gitUrl} (ref: ${ref}).\n` +
          `Check the repository exists, is public, and the ref is valid.`
      );
    }
  }
}

function availableRefs(repoDir: string): string | null {
  try {
    const tags = execSync(`git -C "${repoDir}" tag`, { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 10);
    const branches = execSync(`git -C "${repoDir}" branch -r`, {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .map((b) => b.trim().replace(/^origin\//, ""))
      .filter((b) => b && !b.startsWith("HEAD"))
      .slice(0, 5);
    const all = [...new Set([...tags, ...branches])];
    return all.length > 0 ? all.join(", ") : null;
  } catch {
    return null;
  }
}

/**
 * Return the current HEAD commit SHA of a local git repo.
 */
export function pinnedCommit(repoDir: string): string {
  return execSync(`git -C "${repoDir}" rev-parse HEAD`, {
    encoding: "utf-8",
  }).trim();
}

/**
 * Extract a readable message from an unknown thrown value.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * List immediate subdirectory names in a directory (up to 10), or null on error.
 * Used to provide helpful error messages when a subdir or ref is not found.
 */
export function listSubdirs(dir: string): string | null {
  try {
    const entries = readdirSync(dir)
      .filter((e) => statSync(join(dir, e)).isDirectory())
      .slice(0, 10);
    return entries.length > 0 ? entries.join(", ") : null;
  } catch {
    return null;
  }
}

/**
 * Recursively collect all files under `dir` as ExtraFile entries,
 * with paths relative to `baseDir`.
 */
export function collectExtraDir(
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

/**
 * Parse `.mcp.json` in `pluginDir` into a list of MCP server configs.
 * Returns an empty array if the file is absent or has no mcpServers key.
 */
export function parseMcpJsonFile(pluginDir: string): McpServerConfig[] {
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

/**
 * Recursively collect command files (.toml, .md) from `dir` into `commands`,
 * with paths relative to `baseDir`.
 */
export function collectCommandFiles(
  dir: string,
  baseDir: string,
  commands: Command[]
): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectCommandFiles(full, baseDir, commands);
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

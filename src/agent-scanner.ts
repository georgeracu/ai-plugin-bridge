import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { readTextFile, parseFrontmatter } from "./utils.js";

/** Frontmatter keys that indicate a Claude Code agent. */
const CLAUDE_KEYS = new Set([
  "tools", "model", "permissionMode", "hooks", "mcpServers",
  "maxTurns", "skills", "memory", "effort", "isolation",
  "color", "disallowedTools",
]);

/** Directories to skip when scanning. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

export interface ScannedAgent {
  /** Relative path within the scanned directory */
  path: string;
  /** Basename of the file */
  filename: string;
  /** Raw file content */
  content: string;
  /** Parsed YAML frontmatter */
  frontmatter: Record<string, unknown>;
  /** Prompt content after frontmatter */
  body: string;
  /** Which tool this agent was likely written for */
  inferredSource: "claude-code" | "copilot-cli" | "ambiguous";
}

/**
 * Recursively scan a directory for markdown files that look like agent definitions.
 * Returns results sorted by relative path.
 */
export function scanForAgents(dir: string): ScannedAgent[] {
  const agents: ScannedAgent[] = [];
  walk(dir, dir, agents);
  return agents.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(current: string, root: string, results: ScannedAgent[]): void {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;

    const full = join(current, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(full, root, results);
      continue;
    }

    if (!entry.endsWith(".md")) continue;

    const content = readTextFile(full);
    if (!content) continue;

    const { frontmatter, body } = parseFrontmatter(content);
    const isAgentExt = entry.endsWith(".agent.md");

    // Detection: .agent.md files are always agents; others need name + description
    const hasName = Boolean(frontmatter["name"]);
    const hasDesc = Boolean(frontmatter["description"]);

    if (!isAgentExt && !(hasName && hasDesc)) continue;

    const relPath = relative(root, full);
    const inferredSource = inferSource(frontmatter);

    results.push({
      path: relPath,
      filename: basename(full),
      content,
      frontmatter,
      body,
      inferredSource,
    });
  }
}

function inferSource(
  fm: Record<string, unknown>
): "claude-code" | "copilot-cli" | "ambiguous" {
  for (const key of Object.keys(fm)) {
    if (CLAUDE_KEYS.has(key)) return "claude-code";
  }
  if ("mcp-servers" in fm) return "copilot-cli";
  return "ambiguous";
}

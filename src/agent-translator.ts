import type { ScannedAgent } from "./agent-scanner.js";

type AgentTargetTool = "claude-code" | "copilot-cli";

export interface TranslatedAgent {
  filename: string;
  /** Full file content: frontmatter + body */
  content: string;
  /** Translation warnings */
  warnings: string[];
}

/** Frontmatter keys exclusive to Claude Code agents. */
const CLAUDE_ONLY_KEYS = new Set([
  "tools", "model", "permissionMode", "hooks", "mcpServers",
  "maxTurns", "skills", "memory", "effort", "isolation",
  "color", "disallowedTools",
]);

/**
 * Translate an agent between Claude Code and Copilot CLI formats.
 * Returns the agent as-is when no translation is needed.
 */
export function translateAgent(
  agent: ScannedAgent,
  target: AgentTargetTool
): TranslatedAgent {
  const source = agent.inferredSource ?? "ambiguous";

  // No translation needed
  if (source === target || source === "ambiguous") {
    return { filename: agent.filename, content: agent.content, warnings: [] };
  }

  if (source === "claude-code" && target === "copilot-cli") {
    return translateClaudeToCopilot(agent);
  }

  if (source === "copilot-cli" && target === "claude-code") {
    return translateCopilotToClaude(agent);
  }

  // Fallback — should not be reached
  return { filename: agent.filename, content: agent.content, warnings: [] };
}

function translateClaudeToCopilot(agent: ScannedAgent): TranslatedAgent {
  const warnings: string[] = [];
  const kept: Record<string, unknown> = {};
  const comments: string[] = [];

  for (const [key, value] of Object.entries(agent.frontmatter)) {
    if (CLAUDE_ONLY_KEYS.has(key)) {
      const serialised = typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
      comments.push(`# claude-original-${key}: ${serialised}`);
      warnings.push(`${key} preserved as comment — Copilot CLI has no equivalent`);
    } else {
      kept[key] = value;
    }
  }

  const content = buildMarkdown(kept, comments, agent.body);
  return { filename: agent.filename, content, warnings };
}

function translateCopilotToClaude(agent: ScannedAgent): TranslatedAgent {
  const warnings: string[] = [];

  // Parse claude-original comments from the raw content
  const restoredFromComments = extractOriginalComments(agent.content);

  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(agent.frontmatter)) {
    if (key === "mcp-servers") {
      kept["mcpServers"] = value;
      warnings.push("mcp-servers renamed to mcpServers");
    } else {
      kept[key] = value;
    }
  }

  // Merge restored values (they take precedence for keys they define)
  const merged = { ...kept, ...restoredFromComments };

  const content = buildMarkdown(merged, [], agent.body);
  return { filename: agent.filename, content, warnings };
}

/**
 * Extract `# claude-original-<key>: <value>` comments from raw file content.
 * Returns a record of restored key-value pairs.
 */
function extractOriginalComments(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pattern = /^# claude-original-(\S+?):\s*(.+)$/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const key = match[1];
    const raw = match[2].trim();
    // Try JSON parse for complex values, fall back to string
    try {
      result[key] = JSON.parse(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

/**
 * Build a markdown file from frontmatter, optional comment lines, and body.
 */
function buildMarkdown(
  frontmatter: Record<string, unknown>,
  comments: string[],
  body: string
): string {
  const lines: string[] = ["---"];

  // Comments go at the top of the frontmatter block
  for (const c of comments) {
    lines.push(c);
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "object" && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");

  return lines.join("\n") + body;
}

/**
 * Universal plugin model.
 *
 * Every source format (Claude Code, Gemini CLI, Copilot CLI) is parsed into
 * this intermediate representation, and every target format is generated from it.
 */

// ---------------------------------------------------------------------------
// Source tool identifiers
// ---------------------------------------------------------------------------

export type ToolId = "claude-code" | "gemini-cli" | "copilot-cli";

export const ALL_TOOLS: ToolId[] = ["claude-code", "gemini-cli", "copilot-cli"];

// ---------------------------------------------------------------------------
// Component types that a plugin can contain
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  /** Undefined when the source extension did not declare a launch command. */
  command?: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** HTTP/streamable-HTTP URL for remote MCP servers (no local process). */
  httpUrl?: string;
  /** HTTP headers (e.g. auth) — only relevant when httpUrl is set. */
  headers?: Record<string, string>;
  /** Timeout in milliseconds — only relevant when httpUrl is set. */
  timeout?: number;
}

export interface Skill {
  /** Relative path to the skill directory (contains SKILL.md) */
  path: string;
  /** Raw SKILL.md content */
  content: string;
  /** Parsed frontmatter fields */
  frontmatter: Record<string, unknown>;
}

export interface Agent {
  /** Filename (e.g. "reviewer.agent.md") */
  filename: string;
  /** Raw file content */
  content: string;
  /** Parsed frontmatter */
  frontmatter: Record<string, unknown>;
}

export interface Command {
  /** Command name (e.g. "code-review", "jules") */
  name: string;
  /** Relative path to the command file/directory */
  path: string;
  /** Raw content */
  content: string;
}

export interface HookConfig {
  /** Raw hook configuration (tool-specific, opaque for now) */
  raw: unknown;
  /** Source tool this hook was written for */
  sourceTool: ToolId;
}

export interface ContextFile {
  /** Raw markdown content */
  content: string;
  /** Original filename (CLAUDE.md, GEMINI.md, etc.) */
  originalFilename: string;
}

// ---------------------------------------------------------------------------
// Universal plugin representation
// ---------------------------------------------------------------------------

export interface UniversalPlugin {
  /** Plugin name */
  name: string;
  /** Plugin version (semver or commit hash) */
  version: string;
  /** Human-readable description */
  description: string;
  /** Which tool this was originally written for */
  sourceTool: ToolId;
  /** Source reference (git URL + optional path) */
  source: PluginSource;

  // Components — all optional
  mcpServers: McpServerConfig[];
  skills: Skill[];
  agents: Agent[];
  commands: Command[];
  hooks: HookConfig[];
  contextFile?: ContextFile;

  /** Extra files that should be copied as-is (scripts, assets) */
  extraFiles: ExtraFile[];

  /** Warnings raised during parsing (e.g. missing MCP command). Generators merge these into the translation report. */
  parseWarnings?: string[];
}

export interface ExtraFile {
  /** Relative path within the plugin */
  relativePath: string;
  /** Raw content (text) or null if binary */
  content: string | null;
  /** Whether this is a binary file */
  binary: boolean;
}

export interface PluginSource {
  /** Git repository URL or owner/repo shorthand */
  repo: string;
  /** Optional subdirectory within the repo */
  subdir?: string;
  /** Pinned ref (tag, branch, or commit SHA) */
  ref: string;
}

// ---------------------------------------------------------------------------
// Translation report
// ---------------------------------------------------------------------------

export type TranslationStatus = "translated" | "skipped" | "partial";

export interface ComponentReport {
  type: "mcp-server" | "skill" | "agent" | "command" | "hook" | "context-file";
  name: string;
  status: TranslationStatus;
  reason?: string;
}

export interface TranslationReport {
  sourceTool: ToolId;
  targetTool: ToolId;
  version: string;
  partial: boolean;
  components: ComponentReport[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Registry configuration
// ---------------------------------------------------------------------------

export interface RegistryConfig {
  /** Local identifier used in per-plugin `registry` pinning — must be unique */
  name: string;
  /** Git-cloneable URL (HTTPS or SSH) */
  url: string;
  /** Lookup priority — lower number checked first */
  priority: number;
}

// ---------------------------------------------------------------------------
// Pluginfile (declarative sync)
// ---------------------------------------------------------------------------

export interface PluginfileEntry {
  name: string;
  source: string;
  ref: string;
  subdir?: string;
  /** Per-plugin target override */
  targets?: ToolId[];
  /** Pin this plugin to a specific registry by name — skips the priority chain */
  registry?: string;
}

export interface Pluginfile {
  /** Ordered list of registries to resolve plugins from */
  registries?: RegistryConfig[];
  /** Default targets for all plugins */
  targets: ToolId[];
  /** Plugin entries */
  plugins: PluginfileEntry[];
}

export type SyncStatus = "installed" | "up-to-date" | "failed";

export interface SyncResultEntry {
  name: string;
  status: SyncStatus;
  /** Where the plugin was fetched from: "source" or a registry name */
  fetchedFrom?: string;
  /** Per-target install status */
  targetResults: { tool: ToolId; status: "installed" | "skipped" | "failed"; reason?: string }[];
  error?: string;
}

export interface SyncResult {
  entries: SyncResultEntry[];
}

// ---------------------------------------------------------------------------
// Registry index and plugin metadata (for aib publish / registry-client)
// ---------------------------------------------------------------------------

export interface PluginTargetSummary {
  status: "full" | "partial" | "none";
  components: number;
  warnings?: string[];
}

export interface PluginMetadata {
  name: string;
  description: string;
  sourceTool: ToolId;
  source: {
    repo: string;
    ref: string;
    subdir?: string;
  };
  version: string;
  publishedAt: string;
  targets: Record<string, PluginTargetSummary>;
}

export interface RegistryPluginEntry {
  description: string;
  sourceTool: ToolId;
  source: string;
  ref: string;
  publishedAt: string;
  targets: ToolId[];
}

export interface RegistryIndex {
  version: "1";
  updatedAt: string;
  plugins: Record<string, RegistryPluginEntry>;
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { scanForAgents, type ScannedAgent } from "./agent-scanner.js";
import { translateAgent } from "./agent-translator.js";
import { normalizeGitUrl, cloneOrUpdate } from "./utils.js";
import { header, step, ok, warn, fail } from "./output.js";
import { confirm } from "./confirm.js";
import { promptSelection } from "./select.js";

export interface AgentImportOptions {
  source: string;
  subdir?: string;
  ref?: string;
  to?: string;
  all?: boolean;
  project?: string;
}

const UNI_HOME = process.env["AI_PLUGIN_BRIDGE_HOME"] ?? join(homedir(), ".ai-plugin-bridge");

/**
 * Standalone agent import: clone repo, scan for agents, select, translate, install.
 */
export async function importAgents(opts: AgentImportOptions): Promise<void> {
  header("Agent Import");

  // 1. Clone
  const url = normalizeGitUrl(opts.source);
  const repoName = basename(opts.source).replace(/\.git$/, "");
  const sourcesDir = join(UNI_HOME, "sources", repoName);
  step(`Cloning ${url}`);
  cloneOrUpdate(sourcesDir, url, opts.ref ?? "main");
  ok("Repository ready");

  // 2. Scan
  const scanDir = opts.subdir ? join(sourcesDir, opts.subdir) : sourcesDir;
  step("Scanning for agent definitions");
  const agents = scanForAgents(scanDir);

  if (agents.length === 0) {
    fail("No agent definitions found");
    return;
  }
  ok(`Found ${agents.length} agent(s)`);

  // 3. Select
  let selected: ScannedAgent[];
  if (opts.all) {
    selected = agents;
  } else {
    const items = agents.map((a) => ({
      label: `${a.frontmatter["name"] ?? a.filename}  (${a.inferredSource})  ${a.frontmatter["description"] ?? ""}`,
    }));
    console.log();
    const indices = await promptSelection(items, "Select agents (e.g. 1,3,5-7):");
    if (indices.length === 0) {
      fail("No agents selected");
      return;
    }
    selected = indices.map((i) => agents[i]);
  }
  ok(`${selected.length} agent(s) selected`);

  // 4. Determine targets
  const targets = resolveTargets(opts.to);
  if (targets.length === 0) return;

  // 5. Translate and install
  for (const target of targets) {
    const targetDir = getInstallDir(target, opts.project);
    if (!targetDir) continue;

    step(`Installing to ${target}`);
    mkdirSync(targetDir, { recursive: true });

    for (const agent of selected) {
      const result = translateAgent(agent, target);
      writeFileSync(join(targetDir, result.filename), result.content);
      ok(`  ${result.filename}`);
      for (const w of result.warnings) {
        warn(`  ${w}`);
      }
    }
  }

  ok("Agent import complete");
}

const VALID_AGENT_TARGETS = new Set(["claude-code", "copilot-cli"]);

function resolveTargets(to?: string): Array<"claude-code" | "copilot-cli"> {
  if (!to) return ["claude-code", "copilot-cli"];
  if (to === "all") return ["claude-code", "copilot-cli"];

  // Support comma-separated values (e.g. from --only forwarding)
  const parts = to.split(",").map((s) => s.trim());
  const valid = parts.filter((p) => VALID_AGENT_TARGETS.has(p)) as Array<"claude-code" | "copilot-cli">;
  const invalid = parts.filter((p) => !VALID_AGENT_TARGETS.has(p) && p !== "all");

  for (const t of invalid) {
    warn(`Skipping unsupported agent target: ${t}`);
  }

  return valid.length > 0 ? valid : ["claude-code", "copilot-cli"];
}

function getInstallDir(
  target: "claude-code" | "copilot-cli",
  project?: string
): string | null {
  if (target === "claude-code") {
    return join(homedir(), ".claude", "agents");
  }

  // Copilot: project-scoped
  const base = project ?? process.cwd();
  if (!existsSync(join(base, ".git"))) {
    fail(`No git repository at ${base} — use --project to specify a repo path`);
    return null;
  }
  return join(base, ".github", "agents");
}

/**
 * Consistent output formatting for the uni CLI.
 * All user-facing messages go through these helpers.
 */
import chalk from "chalk";
import { ALL_TOOLS } from "./types.js";
import type { SyncResultEntry, ToolId } from "./types.js";

// ---------------------------------------------------------------------------
// Global state (set by CLI flags before any command runs)
// ---------------------------------------------------------------------------

let _verbose = false;
let _yes = false;

export function setVerbose(v: boolean): void {
  _verbose = v;
}
export function setYes(v: boolean): void {
  _yes = v;
}
export function isYes(): boolean {
  return _yes;
}
export function isVerbose(): boolean {
  return _verbose;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** `\nuni · msg` — bold section header */
export function header(msg: string): void {
  console.log(`\n${chalk.bold("uni")} · ${msg}`);
}

/** Blank line */
export function blank(): void {
  console.log();
}

/** Plain indented message */
export function log(msg: string): void {
  console.log(`  ${msg}`);
}

/** `  → msg` — step/progress */
export function step(msg: string): void {
  console.log(`  ${chalk.dim("→")} ${msg}`);
}

/** `  ↓ msg` — downloading/cloning */
export function downloading(msg: string): void {
  console.log(`  ${chalk.dim("↓")} ${msg}`);
}

/** `  ✓ msg` — success (green) */
export function ok(msg: string): void {
  console.log(`  ${chalk.green("✓")} ${msg}`);
}

/** `  ◐ msg` — partial (yellow) */
export function partial(msg: string): void {
  console.log(`  ${chalk.yellow("◐")} ${msg}`);
}

/** `  ⚠ msg` — warning (yellow) */
export function warn(msg: string): void {
  console.log(`  ${chalk.yellow("⚠")} ${msg}`);
}

/** `  ✗ msg` — error line (red, non-fatal) */
export function fail(msg: string): void {
  console.log(`  ${chalk.red("✗")} ${msg}`);
}

/** Print a clean error and exit. Shows stack trace only with --verbose. */
export function fatal(msg: string, err?: unknown): never {
  console.error(`\n${chalk.bold.red("Error:")} ${msg}`);
  if (_verbose && err != null) {
    if (err instanceof Error && err.stack) {
      const stackLines = err.stack.split("\n").slice(1).join("\n");
      console.error(chalk.dim(stackLines));
    } else {
      console.error(chalk.dim(String(err)));
    }
  }
  process.exit(1);
}

/** Thin horizontal separator */
export function separator(): void {
  console.log(chalk.dim("─".repeat(60)));
}

// ---------------------------------------------------------------------------
// Sync summary table
// ---------------------------------------------------------------------------

const COL_WIDTH = 15;
const SOURCE_COL_WIDTH = 12;

function statusCell(entry: SyncResultEntry, tool: ToolId): string {
  if (entry.status === "up-to-date") {
    return chalk.dim("— up to date");
  }
  if (entry.status === "failed" && entry.targetResults.length === 0) {
    return chalk.red("✗ failed");
  }
  const tr = entry.targetResults.find((r) => r.tool === tool);
  if (!tr) return chalk.dim("— skipped");
  switch (tr.status) {
    case "installed":
      return chalk.green("✓ installed");
    case "skipped":
      return chalk.dim(`— ${tr.reason ?? "skipped"}`);
    case "failed":
      return chalk.red(`✗ ${tr.reason ?? "failed"}`);
  }
}

function sourceCell(entry: SyncResultEntry): string {
  if (!entry.fetchedFrom) return chalk.dim("—");
  if (entry.fetchedFrom === "source") return chalk.dim("source");
  return chalk.cyan(entry.fetchedFrom);
}

function pad(s: string, width: number): string {
  // Pad accounting for ANSI escape codes (chalk adds them)
  const visLen = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  return s + " ".repeat(Math.max(0, width - visLen));
}

export function syncTable(entries: SyncResultEntry[]): void {
  if (entries.length === 0) return;

  const nameWidth =
    Math.max(10, ...entries.map((e) => e.name.length)) + 2;
  const srcWidth =
    Math.max(
      SOURCE_COL_WIDTH,
      ...entries.map((e) => (e.fetchedFrom ?? "—").length)
    ) + 2;

  // Header row
  console.log(
    "  " +
      pad(chalk.bold("Plugin"), nameWidth) +
      pad(chalk.bold("Source"), srcWidth) +
      ALL_TOOLS.map((t) => pad(chalk.bold(t), COL_WIDTH)).join("  ")
  );
  console.log(
    chalk.dim(
      "  " + "─".repeat(nameWidth + srcWidth + ALL_TOOLS.length * (COL_WIDTH + 2))
    )
  );

  for (const entry of entries) {
    console.log(
      "  " +
        pad(entry.name, nameWidth) +
        pad(sourceCell(entry), srcWidth) +
        ALL_TOOLS.map((t) => pad(statusCell(entry, t), COL_WIDTH)).join("  ")
    );
  }
}

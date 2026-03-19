import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

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
 */
export function cloneOrUpdate(
  sourcesDir: string,
  gitUrl: string,
  ref: string
): void {
  if (existsSync(sourcesDir)) {
    execSync(`git -C "${sourcesDir}" fetch origin`, { stdio: "pipe" });
    execSync(`git -C "${sourcesDir}" checkout ${ref}`, { stdio: "pipe" });
    try {
      execSync(`git -C "${sourcesDir}" pull origin ${ref}`, { stdio: "pipe" });
    } catch {
      // ref might be a commit SHA — pull will fail, that's fine
    }
  } else {
    mkdirSync(dirname(sourcesDir), { recursive: true });
    execSync(
      `git clone --depth 1 --branch ${ref} "${gitUrl}" "${sourcesDir}"`,
      { stdio: "pipe" }
    );
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

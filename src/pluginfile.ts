import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Pluginfile, PluginfileEntry, RegistryConfig, ToolId } from "./types.js";

const DEFAULT_TARGETS: ToolId[] = ["claude-code", "gemini-cli", "copilot-cli"];

/**
 * Locate and load a pluginfile.yaml.
 * Search order: explicit path > ./pluginfile.yaml > ~/.ai-plugin-bridge/pluginfile.yaml
 */
export function loadPluginfile(explicitPath?: string): {
  pluginfile: Pluginfile;
  resolvedPath: string;
} {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        join(process.cwd(), "pluginfile.yaml"),
        join(
          process.env.AI_PLUGIN_BRIDGE_HOME ??
            join(process.env.HOME ?? "~", ".ai-plugin-bridge"),
          "pluginfile.yaml"
        ),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf-8");
      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch (err) {
        if (err instanceof YAMLParseError) {
          throw new Error(
            `Invalid YAML in ${candidate} at line ${err.linePos?.[0]?.line ?? "?"}:\n  ${err.message}`
          );
        }
        throw new Error(`Could not parse ${candidate}: ${String(err)}`);
      }
      const pluginfile = validate(parsed, candidate);
      return { pluginfile, resolvedPath: candidate };
    }
  }

  throw new Error(
    `No pluginfile.yaml found. Run 'aib sync --init' to create one, or specify a path with --file.`
  );
}

/** Parse and validate a pluginfile — also used by `aib validate`. */
export function validatePluginfile(
  filePath: string
): { pluginfile: Pluginfile; warnings: string[] } {
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new Error(
        `Invalid YAML at line ${err.linePos?.[0]?.line ?? "?"}:\n  ${err.message}`
      );
    }
    throw new Error(`Could not parse ${filePath}: ${String(err)}`);
  }

  const pluginfile = validate(parsed, filePath);
  const warnings = lintPluginfile(pluginfile);

  return { pluginfile, warnings };
}

/** Lint rules that don't block loading but are worth surfacing. */
function lintPluginfile(pf: Pluginfile): string[] {
  const warnings: string[] = [];

  // Duplicate plugin names
  const names = pf.plugins.map((p) => p.name);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      warnings.push(`Duplicate plugin name: "${name}"`);
    }
    seen.add(name);
  }

  // Duplicate registry names
  if (pf.registries) {
    const regSeen = new Set<string>();
    for (const r of pf.registries) {
      if (regSeen.has(r.name)) {
        warnings.push(`Duplicate registry name: "${r.name}"`);
      }
      regSeen.add(r.name);
    }
  }

  const registryNames = new Set((pf.registries ?? []).map((r) => r.name));

  for (const entry of pf.plugins) {
    // Source should look like owner/repo or https://...
    if (
      !entry.source.includes("/") &&
      !entry.source.startsWith("https://")
    ) {
      warnings.push(
        `Plugin "${entry.name}": source "${entry.source}" doesn't look like a valid GitHub repo (expected owner/repo or https://...)`
      );
    }

    // Mutable ref warning
    if (isMutableRef(entry.ref)) {
      warnings.push(
        `Plugin "${entry.name}": ref "${entry.ref}" looks like a branch name — consider pinning to a tag or commit SHA for reproducibility`
      );
    }

    // Per-plugin registry pin must reference a known registry
    if (entry.registry && !registryNames.has(entry.registry)) {
      warnings.push(
        `Plugin "${entry.name}": registry "${entry.registry}" is not defined in the registries list`
      );
    }
  }

  return warnings;
}

/** Returns true if the ref looks like a mutable branch name rather than a pinned tag/SHA. */
function isMutableRef(ref: string): boolean {
  if (/^v?\d+\.\d+/.test(ref)) return false; // semver tag
  if (/^[0-9a-f]{7,40}$/.test(ref)) return false; // commit SHA
  return true; // likely a branch
}

function validate(raw: unknown, filePath: string): Pluginfile {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${filePath}: expected a YAML object`);
  }

  const obj = raw as Record<string, unknown>;
  const targets = validateTargets(obj.targets) ?? DEFAULT_TARGETS;

  if (!Array.isArray(obj.plugins) || obj.plugins.length === 0) {
    throw new Error(`${filePath}: "plugins" must be a non-empty array`);
  }

  const plugins: PluginfileEntry[] = obj.plugins.map(
    (entry: unknown, i: number) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`${filePath}: plugin entry at index ${i} is not an object`);
      }
      const e = entry as Record<string, unknown>;

      if (typeof e.name !== "string" || !e.name) {
        throw new Error(`${filePath}: plugin at index ${i} is missing "name"`);
      }
      if (typeof e.source !== "string" || !e.source) {
        throw new Error(`${filePath}: plugin "${e.name}" is missing "source"`);
      }

      return {
        name: e.name,
        source: e.source,
        ref: typeof e.ref === "string" ? e.ref : "main",
        subdir: typeof e.subdir === "string" ? e.subdir : undefined,
        targets: validateTargets(e.targets),
        registry: typeof e.registry === "string" ? e.registry : undefined,
      };
    }
  );

  // Support both `registries` (new) and the legacy `registry` string field.
  // If `registry` is a string, promote it to a single-entry registries list.
  let registries = validateRegistries(obj.registries);
  if (!registries && typeof obj.registry === "string" && obj.registry) {
    registries = [{ name: "default", url: obj.registry, priority: 1 }];
  }

  return {
    registries: registries ?? undefined,
    targets,
    plugins,
  };
}

function validateRegistries(raw: unknown): RegistryConfig[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const result: RegistryConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    if (typeof r.url !== "string" || !r.url) continue;
    result.push({
      name: r.name,
      url: r.url,
      priority: typeof r.priority === "number" ? r.priority : result.length + 1,
    });
  }
  return result.length > 0 ? result : undefined;
}

function validateTargets(raw: unknown): ToolId[] | undefined {
  if (!raw) return undefined;
  if (!Array.isArray(raw)) return undefined;

  const valid: ToolId[] = ["claude-code", "gemini-cli", "copilot-cli"];
  const result: ToolId[] = [];

  for (const item of raw) {
    const s = String(item).trim() as ToolId;
    if (valid.includes(s)) result.push(s);
  }

  return result.length > 0 ? result : undefined;
}

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Pluginfile, PluginfileEntry, ToolId } from "./types.js";

const DEFAULT_TARGETS: ToolId[] = ["claude-code", "gemini-cli", "copilot-cli"];

/**
 * Locate and load a pluginfile.yaml.
 * Search order: explicit path > ./pluginfile.yaml > ~/.uni-plugin/pluginfile.yaml
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
          process.env.UNI_PLUGIN_HOME ??
            join(process.env.HOME ?? "~", ".uni-plugin"),
          "pluginfile.yaml"
        ),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = parseYaml(raw);
      const pluginfile = validate(parsed, candidate);
      return { pluginfile, resolvedPath: candidate };
    }
  }

  throw new Error(
    `No pluginfile.yaml found. Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n\nRun "uni sync --init" to create one.`
  );
}

function validate(raw: unknown, filePath: string): Pluginfile {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid pluginfile at ${filePath}: expected a YAML object`);
  }

  const obj = raw as Record<string, unknown>;

  const targets = validateTargets(obj.targets) ?? DEFAULT_TARGETS;

  if (!Array.isArray(obj.plugins) || obj.plugins.length === 0) {
    throw new Error(
      `Invalid pluginfile at ${filePath}: "plugins" must be a non-empty array`
    );
  }

  const plugins: PluginfileEntry[] = obj.plugins.map(
    (entry: unknown, i: number) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`Invalid plugin entry at index ${i} in ${filePath}`);
      }
      const e = entry as Record<string, unknown>;

      if (typeof e.name !== "string" || !e.name) {
        throw new Error(`Plugin entry ${i} missing "name" in ${filePath}`);
      }
      if (typeof e.source !== "string" || !e.source) {
        throw new Error(`Plugin entry ${i} missing "source" in ${filePath}`);
      }

      return {
        name: e.name,
        source: e.source,
        ref: typeof e.ref === "string" ? e.ref : "main",
        subdir: typeof e.subdir === "string" ? e.subdir : undefined,
        targets: validateTargets(e.targets),
      };
    }
  );

  return {
    registry: typeof obj.registry === "string" ? obj.registry : undefined,
    targets,
    plugins,
  };
}

function validateTargets(raw: unknown): ToolId[] | undefined {
  if (!raw) return undefined;
  if (!Array.isArray(raw)) return undefined;

  const valid: ToolId[] = ["claude-code", "gemini-cli", "copilot-cli"];
  const result: ToolId[] = [];

  for (const item of raw) {
    const s = String(item).trim() as ToolId;
    if (valid.includes(s)) {
      result.push(s);
    }
  }

  return result.length > 0 ? result : undefined;
}

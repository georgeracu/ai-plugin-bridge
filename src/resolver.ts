import type { PluginfileEntry, RegistryConfig } from "./types.js";
import type { RegistryManager } from "./registry-manager.js";

export type ResolutionSource =
  | { type: "registry"; name: string }
  | { type: "source" };

/**
 * Merge global and pluginfile registry configs.
 * Pluginfile registries override global ones with the same name.
 * Result is sorted by priority (ascending), then by declaration order.
 */
export function mergeRegistries(
  global: RegistryConfig[],
  pluginfile: RegistryConfig[]
): RegistryConfig[] {
  const merged = new Map<string, RegistryConfig>();
  for (const r of global) merged.set(r.name, r);
  for (const r of pluginfile) merged.set(r.name, r); // pluginfile wins on name collision
  return [...merged.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Resolve where to get a plugin from.
 *
 * - If the plugin has `registry: <name>` → check only that registry.
 *   Throws if not found there (explicit pin, no silent fallback).
 * - Otherwise → walk the sorted priority chain; fall back to source.
 */
export function resolvePlugin(
  entry: PluginfileEntry,
  registries: RegistryConfig[],
  manager: RegistryManager
): ResolutionSource {
  if (entry.registry) {
    if (manager.hasPlugin(entry.registry, entry.name)) {
      return { type: "registry", name: entry.registry };
    }
    throw new Error(
      `Plugin "${entry.name}" not found in registry "${entry.registry}". ` +
        `Run 'uni import' to translate from source, or remove the registry pin.`
    );
  }

  for (const reg of registries) {
    if (manager.hasPlugin(reg.name, entry.name)) {
      return { type: "registry", name: reg.name };
    }
  }

  return { type: "source" };
}

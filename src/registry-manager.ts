import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  cpSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { execSync } from "node:child_process";
import type { RegistryConfig, RegistryIndex, RegistryPluginEntry, ToolId } from "./types.js";
import { loadRegistryIndex } from "./registry-index.js";
import { normalizeGitUrl } from "./utils.js";

/**
 * Manages interactions with multiple remote plugin registry repos.
 * Each registry is cloned to ~/.uni-plugin/registries/{name}/.
 *
 * Indexes are cached in memory for the lifetime of the instance — don't
 * re-read from disk for every plugin lookup.
 */
export class RegistryManager {
  private readonly registriesDir: string;
  private readonly indexes = new Map<string, RegistryIndex>();

  constructor(private readonly uniHome: string) {
    this.registriesDir = join(uniHome, "registries");
  }

  /** Absolute path to a named registry clone. */
  registryDir(name: string): string {
    return join(this.registriesDir, name);
  }

  /**
   * Clone or pull a registry and cache its index.
   * Migrates the legacy ~/.uni-plugin/registry/ clone on first access.
   */
  sync(config: RegistryConfig): void {
    this.migrateLegacyRegistry(config.name);
    const dir = this.registryDir(config.name);
    const url = normalizeGitUrl(config.url);
    if (existsSync(join(dir, ".git"))) {
      execSync(`git -C "${dir}" pull --ff-only`, { stdio: "pipe" });
    } else {
      mkdirSync(dir, { recursive: true });
      execSync(`git clone --depth 1 "${url}" "${dir}"`, { stdio: "pipe" });
    }
    this.indexes.set(config.name, loadRegistryIndex(dir));
  }

  /** Check whether a named registry has a plugin. */
  hasPlugin(registryName: string, pluginName: string): boolean {
    return pluginName in this.getIndex(registryName).plugins;
  }

  /** Check whether a named registry has a specific tool target for a plugin. */
  hasTarget(registryName: string, pluginName: string, tool: ToolId): boolean {
    return (
      this.getIndex(registryName).plugins[pluginName]?.targets.includes(tool) ??
      false
    );
  }

  /** Read plugin metadata JSON from a registry. */
  getMetadata(
    registryName: string,
    pluginName: string
  ): Record<string, unknown> | null {
    const path = join(
      this.registryDir(registryName),
      "plugins",
      pluginName,
      "metadata.json"
    );
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Copy pre-translated plugin files from a registry to local dist. */
  copyToLocal(
    registryName: string,
    pluginName: string,
    tool: ToolId,
    localDistDir: string
  ): void {
    const src = join(
      this.registryDir(registryName),
      "plugins",
      pluginName,
      "dist",
      tool
    );
    const dest = join(localDistDir, tool, pluginName);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }

  /** Number of plugins in a registry (for doctor / list output). */
  pluginCount(registryName: string): number {
    return Object.keys(this.getIndex(registryName).plugins).length;
  }

  /** All plugins in a registry. */
  listPlugins(registryName: string): Record<string, RegistryPluginEntry> {
    return this.getIndex(registryName).plugins;
  }

  /** Search plugin names and descriptions across the given registries. */
  search(
    registryNames: string[],
    query: string
  ): Array<{ registryName: string; name: string; entry: RegistryPluginEntry }> {
    const lower = query.toLowerCase();
    const results: Array<{
      registryName: string;
      name: string;
      entry: RegistryPluginEntry;
    }> = [];
    for (const rName of registryNames) {
      for (const [pluginName, entry] of Object.entries(
        this.getIndex(rName).plugins
      )) {
        if (
          pluginName.toLowerCase().includes(lower) ||
          entry.description?.toLowerCase().includes(lower)
        ) {
          results.push({ registryName: rName, name: pluginName, entry });
        }
      }
    }
    return results;
  }

  /** ISO timestamp from registry-index.json (null if the index has no updatedAt). */
  lastUpdated(registryName: string): string | null {
    return this.getIndex(registryName).updatedAt ?? null;
  }

  private getIndex(name: string): RegistryIndex {
    if (!this.indexes.has(name)) {
      this.indexes.set(name, loadRegistryIndex(this.registryDir(name)));
    }
    return this.indexes.get(name)!;
  }

  /**
   * Move the old single-registry clone at ~/.uni-plugin/registry/ to
   * ~/.uni-plugin/registries/{name}/ if the new path doesn't exist yet.
   */
  private migrateLegacyRegistry(name: string): void {
    const oldDir = join(this.uniHome, "registry");
    const newDir = this.registryDir(name);
    if (existsSync(join(oldDir, ".git")) && !existsSync(newDir)) {
      mkdirSync(this.registriesDir, { recursive: true });
      renameSync(oldDir, newDir);
    }
  }
}

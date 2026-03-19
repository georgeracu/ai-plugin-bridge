import { join } from "node:path";
import { existsSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { RegistryIndex, ToolId } from "./types.js";
import { loadRegistryIndex } from "./registry-index.js";

/**
 * Manages interaction with a remote plugin registry repo.
 */
export class RegistryClient {
  private readonly registryDir: string;
  private readonly registryUrl: string;
  private index: RegistryIndex | null = null;

  constructor(registryUrl: string, uniHome: string) {
    // Normalise to git URL
    this.registryUrl = registryUrl.startsWith("https://")
      ? registryUrl
      : `https://github.com/${registryUrl}.git`;
    this.registryDir = join(uniHome, "registry");
  }

  /**
   * Ensure the registry repo is cloned and up to date.
   */
  sync(): void {
    if (existsSync(join(this.registryDir, ".git"))) {
      execSync(`git -C "${this.registryDir}" pull --ff-only`, {
        stdio: "pipe",
      });
    } else {
      mkdirSync(this.registryDir, { recursive: true });
      execSync(
        `git clone --depth 1 "${this.registryUrl}" "${this.registryDir}"`,
        { stdio: "pipe" }
      );
    }
    // Reload index after sync
    this.index = loadRegistryIndex(this.registryDir);
  }

  /**
   * Check if a plugin exists pre-translated in the registry.
   */
  hasPlugin(name: string): boolean {
    return name in this.getIndex().plugins;
  }

  /**
   * Check if a specific tool target exists for a plugin.
   */
  hasTarget(name: string, tool: ToolId): boolean {
    return this.getIndex().plugins[name]?.targets.includes(tool) ?? false;
  }

  /**
   * Return the pinned ref for a plugin from the registry index, or null if not found.
   */
  getRef(name: string): string | null {
    return this.getIndex().plugins[name]?.ref ?? null;
  }

  /**
   * Read plugin metadata from the registry.
   */
  getMetadata(name: string): Record<string, unknown> | null {
    const metadataPath = join(this.registryDir, "plugins", name, "metadata.json");
    if (!existsSync(metadataPath)) return null;
    try {
      return JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Copy pre-translated plugin files from registry to local dist.
   */
  copyToLocal(name: string, tool: ToolId, localDistDir: string): void {
    const src = join(this.registryDir, "plugins", name, "dist", tool);
    const dest = join(localDistDir, tool, name);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }

  private getIndex(): RegistryIndex {
    if (!this.index) {
      this.index = loadRegistryIndex(this.registryDir);
    }
    return this.index;
  }
}

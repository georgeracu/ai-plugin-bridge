import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { RegistryIndex } from "./types.js";

function indexPath(registryDir: string): string {
  return join(registryDir, "registry-index.json");
}

export function loadRegistryIndex(registryDir: string): RegistryIndex {
  const path = indexPath(registryDir);
  if (!existsSync(path)) {
    return { version: "1", updatedAt: new Date().toISOString(), plugins: {} };
  }
  return JSON.parse(readFileSync(path, "utf-8")) as RegistryIndex;
}

export function saveRegistryIndex(registryDir: string, index: RegistryIndex): void {
  mkdirSync(registryDir, { recursive: true });
  index.updatedAt = new Date().toISOString();
  writeFileSync(indexPath(registryDir), JSON.stringify(index, null, 2));
}


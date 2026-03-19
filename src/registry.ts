import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

function registryPath(uniHome: string): string {
  return join(uniHome, "registry.json");
}

export function loadRegistry(uniHome: string): Record<string, unknown> {
  const path = registryPath(uniHome);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveRegistry(
  uniHome: string,
  registry: Record<string, unknown>
): void {
  mkdirSync(uniHome, { recursive: true });
  writeFileSync(registryPath(uniHome), JSON.stringify(registry, null, 2));
}

export function updateRegistryEntry(
  uniHome: string,
  name: string,
  entry: Record<string, unknown>
): void {
  const registry = loadRegistry(uniHome);
  registry[name] = entry;
  saveRegistry(uniHome, registry);
}

export function deleteRegistryEntry(uniHome: string, name: string): void {
  const registry = loadRegistry(uniHome);
  delete registry[name];
  saveRegistry(uniHome, registry);
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RegistryConfig } from "./types.js";

export interface GlobalConfig {
  registries: RegistryConfig[];
}

function configPath(uniHome: string): string {
  return join(uniHome, "config.yaml");
}

export function loadGlobalConfig(uniHome: string): GlobalConfig {
  const path = configPath(uniHome);
  if (!existsSync(path)) return { registries: [] };
  try {
    const raw = parseYaml(readFileSync(path, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return { registries: [] };
    const obj = raw as Record<string, unknown>;
    return { registries: parseRegistries(obj.registries) };
  } catch {
    return { registries: [] };
  }
}

export function saveGlobalConfig(uniHome: string, config: GlobalConfig): void {
  mkdirSync(uniHome, { recursive: true });
  writeFileSync(configPath(uniHome), stringifyYaml(config));
}

function parseRegistries(raw: unknown): RegistryConfig[] {
  if (!Array.isArray(raw)) return [];
  const result: RegistryConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.url !== "string") continue;
    result.push({
      name: r.name,
      url: r.url,
      priority: typeof r.priority === "number" ? r.priority : 999,
    });
  }
  return result;
}

import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  checkedAt: string;
  latestVersion: string;
}

export function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8")
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function readCache(uniHome: string): CacheEntry | null {
  try {
    const p = join(uniHome, ".update-check");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(uniHome: string, entry: CacheEntry): void {
  try {
    mkdirSync(uniHome, { recursive: true });
    writeFileSync(join(uniHome, ".update-check"), JSON.stringify(entry));
  } catch {
    // Cache write failure is non-fatal
  }
}

function fetchLatestVersion(pkgName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: "registry.npmjs.org",
        path: `/${pkgName}/latest`,
        headers: { Accept: "application/json" },
        timeout: 3000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as { version: string };
            resolve(parsed.version ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isNewer(current: string, candidate: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [cM, cm, cp] = parse(current);
  const [lM, lm, lp] = parse(candidate);
  if (lM !== cM) return lM > cM;
  if (lm !== cm) return lm > cm;
  return lp > cp;
}

/**
 * Returns `{ current, latest }` if a newer version is available, otherwise null.
 * Reads from a 24-hour cache. Triggers a background refresh when stale
 * so the result shows up on the next invocation without blocking this one.
 */
export async function checkForUpdate(
  uniHome: string,
  pkgName = "ai-plugin-bridge"
): Promise<{ current: string; latest: string } | null> {
  const current = getCurrentVersion();
  const cache = readCache(uniHome);
  const now = Date.now();

  if (cache) {
    const age = now - new Date(cache.checkedAt).getTime();
    if (age < CACHE_TTL_MS) {
      // Cache is fresh — use it
      return isNewer(current, cache.latestVersion)
        ? { current, latest: cache.latestVersion }
        : null;
    }
  }

  // Cache is stale — refresh in background (shows on next run)
  fetchLatestVersion(pkgName)
    .then((latest) => {
      if (latest) {
        writeCache(uniHome, {
          checkedAt: new Date().toISOString(),
          latestVersion: latest,
        });
      }
    })
    .catch(() => {});

  // Return stale cached value if it's still newer
  if (cache && isNewer(current, cache.latestVersion)) {
    return { current, latest: cache.latestVersion };
  }

  return null;
}

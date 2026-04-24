import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolId } from "./types.js";

interface DetectionResult {
  tool: ToolId;
  confidence: "definite" | "probable";
  manifestPath: string;
}

/**
 * Detect which tool a plugin directory was originally written for
 * by looking for known manifest files.
 */
export function detectSourceTool(pluginDir: string): DetectionResult | null {
  // Claude Code: .claude-plugin/plugin.json
  const claudeManifest = join(pluginDir, ".claude-plugin", "plugin.json");
  if (existsSync(claudeManifest)) {
    return {
      tool: "claude-code",
      confidence: "definite",
      manifestPath: claudeManifest,
    };
  }

  // Gemini CLI: gemini-extension.json
  const geminiManifest = join(pluginDir, "gemini-extension.json");
  if (existsSync(geminiManifest)) {
    return {
      tool: "gemini-cli",
      confidence: "definite",
      manifestPath: geminiManifest,
    };
  }

  // Copilot CLI: plugin.json at root (not inside .claude-plugin/)
  // Also check for .github/plugin/ directory as a secondary signal
  const copilotManifest = join(pluginDir, "plugin.json");
  const copilotGithubPlugin = join(pluginDir, ".github", "plugin");
  if (existsSync(copilotManifest)) {
    return {
      tool: "copilot-cli",
      confidence: "definite",
      manifestPath: copilotManifest,
    };
  }
  if (existsSync(copilotGithubPlugin)) {
    return {
      tool: "copilot-cli",
      confidence: "probable",
      manifestPath: copilotGithubPlugin,
    };
  }

  return null;
}

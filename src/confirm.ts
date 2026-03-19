import * as readline from "node:readline";
import { isYes } from "./output.js";

/**
 * Show a yes/no prompt. Returns true if confirmed.
 * Automatically returns true when --yes / -y flag is active.
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (isYes()) return true;

  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}`, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

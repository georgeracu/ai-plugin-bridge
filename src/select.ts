import * as readline from "node:readline";

/**
 * Parse a user selection string like "1,3,5-7" into zero-based indices.
 * Numbers are 1-based in the UI. Out-of-range values are silently dropped.
 */
export function parseSelection(input: string, count: number): number[] {
  const indices = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= count) indices.add(i - 1);
      }
    } else {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= count) indices.add(n - 1);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

/**
 * Display a numbered list and prompt the user to select items.
 * Returns the selected zero-based indices.
 */
export async function promptSelection(
  items: { label: string }[],
  prompt: string
): Promise<number[]> {
  for (let i = 0; i < items.length; i++) {
    console.log(`  ${i + 1}. ${items[i].label}`);
  }
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${prompt} `, (answer) => {
      rl.close();
      resolve(parseSelection(answer, items.length));
    });
  });
}

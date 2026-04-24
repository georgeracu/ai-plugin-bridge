import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ExtraFile, TranslationReport } from "../types.js";

export function writeExtraFiles(
  extraFiles: ExtraFile[],
  outputDir: string
): void {
  for (const extra of extraFiles) {
    const dest = join(outputDir, extra.relativePath);
    mkdirSync(join(dest, ".."), { recursive: true });
    if (extra.content !== null) {
      writeFileSync(dest, extra.content);
    }
  }
}

export function writeTranslationReport(
  report: TranslationReport,
  outputDir: string
): void {
  writeFileSync(
    join(outputDir, "translation-report.json"),
    JSON.stringify(report, null, 2)
  );
}

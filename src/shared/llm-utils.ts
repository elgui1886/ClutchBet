import * as fs from "node:fs";

/**
 * Load a prompt template from a file path.
 */
export function loadPrompt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

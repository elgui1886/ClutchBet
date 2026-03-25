import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export function loadYamlConfig<T>(filename: string): T {
  const configPath = path.resolve("config", filename);
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as T;
}

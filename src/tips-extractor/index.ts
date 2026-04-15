import dotenv from "dotenv"; dotenv.config({ override: true });
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildTipsExtractorGraph } from "./graph.js";

interface TipsExtractorConfig {
  channel: string;
  post_limit: number;
}

function loadConfig(): TipsExtractorConfig {
  const configPath = path.resolve("config", "analysis.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as TipsExtractorConfig;
}

export async function main() {
  console.log("🔍 Tips Extractor — starting...\n");

  const config = loadConfig();
  console.log(`📡 Channel: ${config.channel}`);
  console.log(`📊 Post limit per run: ${config.post_limit ?? 100}\n`);

  const graph = buildTipsExtractorGraph();

  await graph.invoke({
    channel: config.channel,
    postLimit: config.post_limit ?? 100,
  });

  console.log("\n✅ Tips Extractor workflow complete.");
}

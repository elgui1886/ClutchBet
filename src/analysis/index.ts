import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildAnalysisGraph } from "./graph.js";

interface AnalysisConfig {
  channel: string;
  months: number;
}

function loadConfig(): AnalysisConfig {
  const configPath = path.resolve("config", "analysis.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as AnalysisConfig;
}

export async function main() {
  console.log("🔬 Starting channel analysis workflow...\n");

  const config = loadConfig();
  console.log(`📡 Channel: ${config.channel}`);
  console.log(`📅 Time range: ${config.months} month(s)\n`);

  const graph = buildAnalysisGraph();

  await graph.invoke({
    channel: config.channel,
    timeRangeMonths: config.months,
  });

  console.log("\n✅ Analysis workflow complete.");
}

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadYamlConfig } from "../shared/config.js";
import { buildAnalysisGraph } from "./graph.js";

interface AnalysisConfig {
  timeRangeMonths: number;
  telegramChannels: string[];
}

function saveAnalysis(channelId: string, content: string): string {
  const analysisDir = path.resolve("analysis");
  if (!fs.existsSync(analysisDir)) {
    fs.mkdirSync(analysisDir, { recursive: true });
  }

  const safeName = channelId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(analysisDir, `${safeName}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

async function main() {
  console.log("🔬 Starting channel analysis workflow...\n");

  const config = loadYamlConfig<AnalysisConfig>("analysis.yaml");
  console.log(`📅 Time range: ${config.timeRangeMonths} months`);
  console.log(`📡 Channels: ${config.telegramChannels.join(", ")}\n`);

  const graph = buildAnalysisGraph();

  for (const channelId of config.telegramChannels) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 Analyzing channel: ${channelId}`);
    console.log(`${"=".repeat(60)}\n`);

    const result = await graph.invoke({
      channelId,
      timeRangeMonths: config.timeRangeMonths,
    });

    if (!result.finalAnalysis) {
      console.log(`⚠️  No analysis produced for ${channelId}. Skipping.`);
      continue;
    }

    const outputPath = saveAnalysis(channelId, result.finalAnalysis);
    console.log(`💾 Analysis saved to: ${outputPath}`);
  }

  console.log("\n✅ All channels analyzed.");
}

main().catch((err) => {
  console.error("❌ Analysis workflow failed:", err);
  process.exit(1);
});

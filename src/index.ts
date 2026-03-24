import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildGraph } from "./graph.js";
import type { GeneratedPost } from "./state.js";

interface Config {
  topic: string;
  telegramChannels: string[];
  publishChannel?: string;
}

function loadConfig(): Config {
  const configPath = path.resolve("config", "channels.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as Config;
}

function saveOutput(post: GeneratedPost): string {
  const outputDir = path.resolve("output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Save image
  const imagePath = path.join(outputDir, `post-${timestamp}.png`);
  const imageBuffer = Buffer.from(post.imageBase64, "base64");
  fs.writeFileSync(imagePath, imageBuffer);

  // Save text
  const textPath = path.join(outputDir, `post-${timestamp}.md`);
  fs.writeFileSync(textPath, post.text, "utf-8");

  return outputDir;
}

async function main() {
  console.log("🚀 Starting agentic workflow...\n");

  const config = loadConfig();
  console.log(`📌 Topic: ${config.topic}`);
  console.log(`� Channels: ${config.telegramChannels.join(", ")}\n`);

  const graph = buildGraph();

  const result = await graph.invoke({
    topic: config.topic,
    telegramChannels: config.telegramChannels,
    publishChannel: config.publishChannel ?? "",
  });

  if (!result.generatedPost) {
    console.log("⚠️  No relevant posts found on Telegram. Workflow stopped.");
    process.exit(0);
  }

  const outputDir = saveOutput(result.generatedPost);
  console.log(`💾 Output saved to: ${outputDir}\n`);
  console.log("--- Generated Text ---\n");
  console.log(result.generatedPost.text);
  console.log("\n--- End ---");
}

main().catch((err) => {
  console.error("❌ Workflow failed:", err);
  process.exit(1);
});

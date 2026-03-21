import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildGraph } from "./graph.js";

interface Config {
  topic: string;
  sampleFiles: string[];
}

function loadConfig(): Config {
  const configPath = path.resolve("config", "channels.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as Config;
}

function loadSamplePosts(sampleFiles: string[]): string[] {
  return sampleFiles.map((file) => {
    const filePath = path.resolve(file);
    return fs.readFileSync(filePath, "utf-8").trim();
  });
}

function saveOutput(post: string): string {
  const outputDir = path.resolve("output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `post-${timestamp}.md`);
  fs.writeFileSync(outputPath, post, "utf-8");
  return outputPath;
}

async function main() {
  console.log("🚀 Starting agentic workflow...\n");

  const config = loadConfig();
  console.log(`📌 Topic: ${config.topic}`);
  console.log(`📄 Sample files: ${config.sampleFiles.join(", ")}\n`);

  const posts = loadSamplePosts(config.sampleFiles);
  console.log(`📥 Loaded ${posts.length} sample posts\n`);

  const graph = buildGraph();

  const result = await graph.invoke({
    inputPosts: posts,
    topic: config.topic,
  });

  const outputPath = saveOutput(result.generatedPost);
  console.log(`💾 Generated post saved to: ${outputPath}\n`);
  console.log("--- Generated Post ---\n");
  console.log(result.generatedPost);
  console.log("\n--- End ---");
}

main().catch((err) => {
  console.error("❌ Workflow failed:", err);
  process.exit(1);
});

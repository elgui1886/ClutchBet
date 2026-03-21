import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildGraph } from "./graph.js";
import type { SamplePost, GeneratedPost } from "./state.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

interface Config {
  topic: string;
  sampleDirs: string[];
}

function loadConfig(): Config {
  const configPath = path.resolve("config", "channels.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as Config;
}

function loadSamplePosts(sampleDirs: string[]): SamplePost[] {
  return sampleDirs.map((dir) => {
    const dirPath = path.resolve(dir);
    const files = fs.readdirSync(dirPath);

    const images = files
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(dirPath, f));

    const textFile = files.find((f) => path.extname(f).toLowerCase() === ".txt");
    const text = textFile
      ? fs.readFileSync(path.join(dirPath, textFile), "utf-8").trim()
      : "";

    return { images, text };
  });
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
  console.log(`📂 Sample dirs: ${config.sampleDirs.join(", ")}\n`);

  const posts = loadSamplePosts(config.sampleDirs);
  const totalImages = posts.reduce((sum, p) => sum + p.images.length, 0);
  console.log(`📥 Loaded ${posts.length} samples (${totalImages} images total)\n`);

  const graph = buildGraph();

  const result = await graph.invoke({
    inputPosts: posts,
    topic: config.topic,
  });

  if (!result.generatedPost) {
    throw new Error("No post was generated");
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

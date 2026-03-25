import * as fs from "node:fs";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "../../shared/llm.js";
import type { AnalysisStateType } from "../state.js";
import type { ChannelPost } from "../state.js";

const CHUNK_PROMPT_PATH = path.resolve("prompts", "chunk-analysis.md");
const MAX_IMAGES_PER_CHUNK = 10;

function loadPrompt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function imageToBase64DataUrl(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "jpeg" : ext;
  const data = fs.readFileSync(imagePath);
  return `data:image/${mime};base64,${data.toString("base64")}`;
}

function formatPostForPrompt(post: ChannelPost): string {
  const dateStr = new Date(post.date * 1000).toISOString();
  const mediaLabel = post.mediaType !== "text" ? ` [${post.mediaType}]` : "";
  return `[${dateStr}]${mediaLabel} (ID: ${post.id})\n${post.text || "(nessun testo)"}`;
}

export async function chunkAnalyzerNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { chunks, currentChunkIndex, chunkAnalyses } = state;
  const chunk = chunks[currentChunkIndex];

  console.log(`\n🔍 Analyzing chunk ${currentChunkIndex + 1}/${chunks.length} (${chunk.length} posts)...`);

  const model = createModel();
  const template = loadPrompt(CHUNK_PROMPT_PATH);

  // Format posts text
  const postsText = chunk.map(formatPostForPrompt).join("\n\n---\n\n");

  const prompt = template
    .replace("{posts}", postsText)
    .replace("{chunk_number}", String(currentChunkIndex + 1))
    .replace("{total_chunks}", String(chunks.length));

  // Build content parts — text + sampled images
  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: prompt }];

  // Collect all images from chunk, sample if > MAX_IMAGES_PER_CHUNK
  const allImages = chunk.flatMap((p) => p.imagePaths);
  let selectedImages = allImages;

  if (allImages.length > MAX_IMAGES_PER_CHUNK) {
    // Evenly sample across the chunk
    const step = allImages.length / MAX_IMAGES_PER_CHUNK;
    selectedImages = [];
    for (let i = 0; i < MAX_IMAGES_PER_CHUNK; i++) {
      selectedImages.push(allImages[Math.floor(i * step)]);
    }
  }

  for (const imgPath of selectedImages) {
    contentParts.push({
      type: "image_url",
      image_url: { url: imageToBase64DataUrl(imgPath) },
    });
  }

  const response = await model.invoke([new HumanMessage({ content: contentParts })]);
  const analysis =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  console.log(`  ✅ Chunk ${currentChunkIndex + 1} analysis complete`);

  return {
    chunkAnalyses: [...chunkAnalyses, analysis],
    currentChunkIndex: currentChunkIndex + 1,
  };
}

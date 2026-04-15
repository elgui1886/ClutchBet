import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import * as path from "node:path";
import { loadPrompt } from "../../shared/llm-utils.js";
import type { AnalysisStateType } from "../state.js";
import type { RawPost } from "../../shared/channel-scraper.js";

const POSTS_PER_CHUNK = 50;

function formatPost(post: RawPost, index: number): string {
  const date = new Date(post.date).toLocaleDateString("it-IT");
  const img = post.hasImage ? " [📷 immagine]" : "";
  return `--- Post #${index + 1} (${date})${img} ---\n${post.text}`;
}

function chunkPosts(posts: RawPost[]): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < posts.length; i += POSTS_PER_CHUNK) {
    const batch = posts.slice(i, i + POSTS_PER_CHUNK);
    chunks.push(batch.map((p, j) => formatPost(p, i + j)).join("\n\n"));
  }
  return chunks;
}

export async function channelAnalyzerNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { rawPosts, channel } = state;

  if (rawPosts.length === 0) {
    console.log("⚠️  No posts to analyze.");
    return { analysisDocument: "" };
  }

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.3,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  // Step 1: Chunk posts into batches
  const chunks = chunkPosts(rawPosts);
  console.log(`📦 Split ${rawPosts.length} posts into ${chunks.length} chunk(s) of ~${POSTS_PER_CHUNK} posts each\n`);

  // Step 2: Analyze each chunk
  const chunkPromptTemplate = loadPrompt(
    path.resolve("prompts", "channel-analysis-chunk.md")
  );

  const chunkSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`🔍 Analyzing chunk ${i + 1}/${chunks.length}...`);

    const prompt = chunkPromptTemplate
      .replace("{channel_name}", channel)
      .replace("{chunk_number}", String(i + 1))
      .replace("{total_chunks}", String(chunks.length))
      .replace("{posts}", chunks[i]);

    const response = await model.invoke([new HumanMessage(prompt)]);
    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    chunkSummaries.push(text);
  }

  console.log(`\n✅ All ${chunks.length} chunk(s) analyzed. Running meta-analysis...\n`);

  // Step 3: Meta-analysis — synthesize all chunk summaries into one document
  const finalPromptTemplate = loadPrompt(
    path.resolve("prompts", "channel-analysis-final.md")
  );

  const allSummaries = chunkSummaries
    .map((s, i) => `## Chunk ${i + 1} Summary\n\n${s}`)
    .join("\n\n---\n\n");

  const finalPrompt = finalPromptTemplate
    .replace("{channel_name}", channel)
    .replace("{total_posts}", String(rawPosts.length))
    .replace("{time_range_start}", new Date(rawPosts[0].date).toLocaleDateString("it-IT"))
    .replace("{time_range_end}", new Date(rawPosts[rawPosts.length - 1].date).toLocaleDateString("it-IT"))
    .replace("{chunk_summaries}", allSummaries);

  const finalResponse = await model.invoke([new HumanMessage(finalPrompt)]);
  const analysisDocument =
    typeof finalResponse.content === "string"
      ? finalResponse.content
      : JSON.stringify(finalResponse.content);

  console.log("📝 Final analysis document generated.\n");

  return { chunks, chunkSummaries, analysisDocument };
}

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { Api } from "telegram";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createTelegramClient, resolvePeer } from "../../shared/telegram-utils.js";
import { loadPrompt } from "../../shared/llm-utils.js";
import type { WorkflowStateType, SamplePost } from "../state.js";

const FILTER_PROMPT_PATH = path.resolve("prompts", "telegram-filter.md");

function createTempDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve("temp", timestamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function isRelevantPost(
  model: ChatOpenAI,
  filterPrompt: string,
  text: string
): Promise<boolean> {
  const prompt = filterPrompt
    .replace("{today_date}", new Date().toISOString().split("T")[0])
    .replace("{post_text}", text);
  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const result = JSON.parse(cleaned) as { relevant: boolean; reason: string; message: string };
    console.log(`     → ${result.relevant ? "✅" : "❌"} ${result.reason} (${result.message})`);
    return result.relevant;
  } catch {
    console.warn("     ⚠️  Could not parse LLM filter response:", cleaned);
    return false;
  }
}

export async function scraperNode(
  state: WorkflowStateType
): Promise<Partial<WorkflowStateType>> {
  const { telegramChannels } = state;

  if (!telegramChannels || telegramChannels.length === 0) {
    console.log("⚠️  No Telegram channels configured. Skipping scraper.");
    return { inputPosts: [] };
  }

  const client = await createTelegramClient();

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  const filterPrompt = loadPrompt(FILTER_PROMPT_PATH);
  const tempDir = createTempDir();

  // --- Phase 1: Download all candidate messages from Telegram ---
  interface CandidateMsg {
    text: string;
    imgPath: string;
  }
  const candidates: CandidateMsg[] = [];

  for (const channel of telegramChannels) {
    console.log(`\n📡 Scanning channel: ${channel}`);
    try {
      const peer = resolvePeer(channel);
      console.log(`  🔗 Resolved peer: ${peer}`);
      const messages = await client.getMessages(peer, { limit: 10 });

      console.log(`  📋 Fetched ${messages.length} message(s):`);
      for (const msg of messages) {
        const date = msg.date ? new Date(msg.date * 1000).toISOString() : "unknown";
        const hasPhoto = msg instanceof Api.Message && msg.media instanceof Api.MessageMediaPhoto;
        const preview = (msg.message ?? "").slice(0, 80).replace(/\n/g, " ");
        console.log(`     #${msg.id} [${date}] photo=${hasPhoto} "${preview}${(msg.message ?? "").length > 80 ? "…" : ""}"`);
      }

      for (const msg of messages) {
        if (!(msg instanceof Api.Message)) continue;
        if (!(msg.media instanceof Api.MessageMediaPhoto)) continue;

        const text = msg.message ?? "";
        if (!text.trim()) {
          console.log(`  ⏭️  Skipping message #${msg.id} (no text)`);
          continue;
        }

        // Download image to temp directory
        const safeName = channel.replace(/[^a-zA-Z0-9_]/g, "");
        const imgPath = path.join(tempDir, `${safeName}-${msg.id}.jpg`);
        const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;

        if (!buffer) {
          console.warn(`  ⚠️  Could not download image for message #${msg.id}`);
          continue;
        }

        fs.writeFileSync(imgPath, buffer);
        candidates.push({ text, imgPath });
        console.log(`  📥 Downloaded message #${msg.id}`);
      }
    } catch (err) {
      console.error(`  ❌ Error scanning ${channel}:`, err);
    }
  }

  // Disconnect Telegram BEFORE LLM calls to avoid TIMEOUT errors
  await client.disconnect();

  // --- Phase 2: Filter candidates with LLM (no Telegram connection needed) ---
  const collectedPosts: SamplePost[] = [];

  for (const candidate of candidates) {
    console.log(`  🔎 Filtering: "${candidate.text.slice(0, 60).replace(/\n/g, " ")}..."`);
    const relevant = await isRelevantPost(model, filterPrompt, candidate.text);
    if (relevant) {
      collectedPosts.push({ images: [candidate.imgPath], text: candidate.text });
      console.log(`  ✅ Post collected`);
    }
  }

  console.log(`\n📥 Collected ${collectedPosts.length} relevant post(s) from Telegram\n`);
  return { inputPosts: collectedPosts };
}

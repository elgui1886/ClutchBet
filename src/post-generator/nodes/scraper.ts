import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { Api } from "telegram";
import { HumanMessage } from "@langchain/core/messages";
import { createTelegramClient } from "../../shared/telegram-client.js";
import { createModel } from "../../shared/llm.js";
import type { WorkflowStateType } from "../state.js";
import type { SamplePost } from "../state.js";
import type { ChatOpenAI } from "@langchain/openai";

const FILTER_PROMPT_PATH = path.resolve("prompts", "telegram-filter.md");

function loadPrompt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

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
  const prompt = filterPrompt.replace("{post_text}", text);
  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const result = JSON.parse(cleaned) as { relevant: boolean; reason: string };
    console.log(`     → ${result.relevant ? "✅" : "❌"} ${result.reason}`);
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
  const model = createModel();

  const filterPrompt = loadPrompt(FILTER_PROMPT_PATH);
  const tempDir = createTempDir();
  const collectedPosts: SamplePost[] = [];

  for (const channel of telegramChannels) {
    console.log(`\n📡 Scanning channel: ${channel}`);
    try {
      const messages = await client.getMessages(channel, { limit: 5 });

      for (const msg of messages) {
        if (!(msg instanceof Api.Message)) continue;
        if (!(msg.media instanceof Api.MessageMediaPhoto)) continue;

        const text = msg.message ?? "";
        console.log(`  🔎 Checking message #${msg.id}...`);

        const relevant = await isRelevantPost(model, filterPrompt, text);
        if (!relevant) continue;

        // Download image to temp directory
        const safeName = channel.replace(/[^a-zA-Z0-9_]/g, "");
        const imgPath = path.join(tempDir, `${safeName}-${msg.id}.jpg`);
        const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;

        if (!buffer) {
          console.warn(`  ⚠️  Could not download image for message #${msg.id}`);
          continue;
        }

        fs.writeFileSync(imgPath, buffer);
        collectedPosts.push({ images: [imgPath], text });
        console.log(`  ✅ Post #${msg.id} collected`);
      }
    } catch (err) {
      console.error(`  ❌ Error scanning ${channel}:`, err);
    }
  }

  await client.disconnect();

  console.log(`\n📥 Collected ${collectedPosts.length} relevant post(s) from Telegram\n`);
  return { inputPosts: collectedPosts };
}

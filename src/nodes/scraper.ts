import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { WorkflowStateType } from "../state.js";
import type { SamplePost } from "../state.js";

const FILTER_PROMPT_PATH = path.resolve("prompts", "telegram-filter.md");

/**
 * Resolve a channel identifier from various formats:
 *  - Telegram Web URL: https://web.telegram.org/k/#-1001259302052
 *  - t.me link: https://t.me/channelname
 *  - @username: @channelname
 *  - Numeric ID: 1259302052
 */
function resolvePeer(channel: string): string | Api.PeerChannel {
  // Telegram Web URL → extract numeric ID (the `-` prefix means it's a channel/group)
  const webMatch = channel.match(/web\.telegram\.org\/.*#-?(\d+)/);
  if (webMatch) {
    return new Api.PeerChannel({ channelId: BigInt(webMatch[1]) });
  }

  // t.me link → extract username
  const tmeMatch = channel.match(/t\.me\/([a-zA-Z0-9_]+)/);
  if (tmeMatch) {
    return `@${tmeMatch[1]}`;
  }

  // Pure numeric ID → treat as channel
  if (/^\d+$/.test(channel)) {
    return new Api.PeerChannel({ channelId: BigInt(channel) });
  }

  // Already an @username or other string
  return channel;
}

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

  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "");
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    throw new Error(
      "Missing TELEGRAM_API_ID, TELEGRAM_API_HASH or TELEGRAM_SESSION in environment.\n" +
        "Run: npx tsx src/setup-telegram.ts"
    );
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
    connection: ConnectionTCPFull,
  });

  await client.connect();

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  const filterPrompt = loadPrompt(FILTER_PROMPT_PATH);
  const tempDir = createTempDir();
  const collectedPosts: SamplePost[] = [];

  for (const channel of telegramChannels) {
    console.log(`\n📡 Scanning channel: ${channel}`);
    try {
      const peer = resolvePeer(channel);
      console.log(`  🔗 Resolved peer: ${peer}`);
      const messages = await client.getMessages(peer, { limit: 5 });

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

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { Api } from "telegram";
import { createTelegramClient } from "../../shared/telegram-client.js";
import type { AnalysisStateType } from "../state.js";
import type { ChannelPost } from "../state.js";

export async function channelReaderNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { channelId, timeRangeMonths } = state;

  console.log(`\n📡 Reading channel: ${channelId} (last ${timeRangeMonths} months)`);

  const client = await createTelegramClient();

  // Calculate cutoff date
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - timeRangeMonths);
  const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

  // Create temp dir for images
  const safeName = channelId.replace(/[^a-zA-Z0-9_]/g, "");
  const tempDir = path.resolve("temp", `analysis-${safeName}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const collectedPosts: ChannelPost[] = [];
  let offsetId = 0;
  let reachedCutoff = false;
  const BATCH_SIZE = 100;

  while (!reachedCutoff) {
    const messages = await client.getMessages(channelId, {
      limit: BATCH_SIZE,
      offsetId,
    });

    if (messages.length === 0) break;

    for (const msg of messages) {
      if (!(msg instanceof Api.Message)) continue;

      // Stop if message is older than cutoff
      if (msg.date < cutoffUnix) {
        reachedCutoff = true;
        break;
      }

      const text = msg.message ?? "";
      let mediaType: ChannelPost["mediaType"] = "text";
      const imagePaths: string[] = [];

      if (msg.media instanceof Api.MessageMediaPhoto) {
        mediaType = "photo";
        // Download photo
        const imgPath = path.join(tempDir, `${msg.id}.jpg`);
        const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;
        if (buffer) {
          fs.writeFileSync(imgPath, buffer);
          imagePaths.push(imgPath);
        }
      } else if (msg.media instanceof Api.MessageMediaDocument) {
        // Could be video, gif, or other document
        mediaType = "video";
      } else if (msg.media) {
        mediaType = "other";
      }

      collectedPosts.push({
        id: msg.id,
        date: msg.date,
        text,
        imagePaths,
        mediaType,
      });
    }

    // Move offset to oldest message in this batch for next iteration
    offsetId = messages[messages.length - 1].id;

    console.log(`  📄 Fetched ${collectedPosts.length} posts so far (offset: ${offsetId})...`);
  }

  await client.disconnect();

  // Sort chronologically (oldest first)
  collectedPosts.sort((a, b) => a.date - b.date);

  console.log(`\n📥 Collected ${collectedPosts.length} posts from ${channelId}\n`);
  return { posts: collectedPosts };
}

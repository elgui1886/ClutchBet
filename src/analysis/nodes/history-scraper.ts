import "dotenv/config";
import { Api } from "telegram";
import { createTelegramClient, resolvePeer } from "../../shared/telegram-utils.js";
import type { AnalysisStateType, RawPost } from "../state.js";

const BATCH_SIZE = 100;
const PAUSE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function historyScraperNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { channel, timeRangeMonths } = state;

  if (!channel) {
    console.log("⚠️  No channel configured. Skipping history scraper.");
    return { rawPosts: [] };
  }

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - timeRangeMonths);
  const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);

  console.log(`📡 Scraping history for channel: ${channel}`);
  console.log(`📅 Time range: last ${timeRangeMonths} month(s) (since ${cutoffDate.toISOString().split("T")[0]})`);

  const client = await createTelegramClient();
  const peer = resolvePeer(channel);

  // Fetch channel title
  let channelTitle = "";
  try {
    const entity = await client.getEntity(peer);
    channelTitle = (entity as any).title ?? "";
    if (channelTitle) {
      console.log(`📛 Channel title: ${channelTitle}`);
    }
  } catch {
    // Non-critical — continue without title
  }

  const posts: RawPost[] = [];

  let offsetId = 0;
  let keepGoing = true;

  try {
    while (keepGoing) {
      const messages = await client.getMessages(peer, {
        limit: BATCH_SIZE,
        offsetId,
      });

      if (!messages || messages.length === 0) {
        console.log("  📭 No more messages.");
        break;
      }

      for (const msg of messages) {
        if (!(msg instanceof Api.Message)) continue;

        // Check if we've gone past the cutoff date
        if (msg.date && msg.date < cutoffTimestamp) {
          keepGoing = false;
          break;
        }

        const text = msg.message ?? "";
        if (!text.trim()) continue;

        const hasImage = msg.media instanceof Api.MessageMediaPhoto;
        const date = msg.date
          ? new Date(msg.date * 1000).toISOString()
          : new Date().toISOString();

        posts.push({ text, date, hasImage });
      }

      // Update offset for pagination
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.id) {
        offsetId = lastMsg.id;
      } else {
        break;
      }

      console.log(`  📥 Fetched ${messages.length} messages (total collected: ${posts.length})`);

      // Rate limiting pause between batches
      if (keepGoing) {
        await sleep(PAUSE_MS);
      }
    }
  } finally {
    await client.disconnect();
  }

  // Sort posts chronologically (oldest first)
  posts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  console.log(`\n📊 Scraped ${posts.length} text post(s) from ${channel}\n`);
  return { rawPosts: posts, channelTitle };
}

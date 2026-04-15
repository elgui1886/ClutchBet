import "dotenv/config";
import { Api } from "telegram";
import { createTelegramClient, resolvePeer } from "./telegram-utils.js";

const BATCH_SIZE = 100;
const PAUSE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A single post scraped from a channel */
export interface RawPost {
  msgId: number;    // Telegram message ID (unique within channel)
  text: string;
  date: string;     // ISO date string
  hasImage: boolean;
  imageBase64?: string;  // Base64-encoded JPEG/PNG if downloaded
}

export interface ScrapeResult {
  posts: RawPost[];
  channelTitle: string;
}

/**
 * Scrapes the message history of a Telegram channel up to `timeRangeMonths` months ago.
 * Returns ALL posts (including image-only ones) sorted chronologically (oldest first).
 *
 * Pass `stopAtMsgId` to stop scraping once a message with id <= that value is encountered.
 * This allows incremental updates: only new posts since the last run are fetched.
 *
 * Callers can further filter the result as needed — e.g. the analysis workflow
 * keeps only text posts, while the tips extractor keeps everything.
 */
export async function scrapeChannelHistory(
  channel: string,
  timeRangeMonths: number,
  stopAtMsgId = 0
): Promise<ScrapeResult> {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - timeRangeMonths);
  const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);

  console.log(`📡 Scraping history for channel: ${channel}`);
  console.log(
    `📅 Time range: last ${timeRangeMonths} month(s) (since ${cutoffDate.toISOString().split("T")[0]})`
  );

  if (stopAtMsgId > 0) {
    console.log(`⏩ Incremental mode: will stop at msg_id ${stopAtMsgId}`);
  }

  const client = await createTelegramClient();
  const peer = resolvePeer(channel);

  let channelTitle = "";
  try {
    const entity = await client.getEntity(peer);
    channelTitle = (entity as any).title ?? "";
    if (channelTitle) console.log(`📛 Channel title: ${channelTitle}`);
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

        // Stop if we've reached the last already-known message (incremental mode)
        if (stopAtMsgId > 0 && msg.id <= stopAtMsgId) {
          keepGoing = false;
          break;
        }

        if (msg.date && msg.date < cutoffTimestamp) {
          keepGoing = false;
          break;
        }

        const text = msg.message ?? "";
        const hasImage = msg.media instanceof Api.MessageMediaPhoto;
        const date = msg.date
          ? new Date(msg.date * 1000).toISOString()
          : new Date().toISOString();

        // Skip posts with neither text nor image
        if (!text.trim() && !hasImage) continue;

        posts.push({ msgId: msg.id, text, date, hasImage });
      }

      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.id) {
        offsetId = lastMsg.id;
      } else {
        break;
      }

      console.log(
        `  📥 Fetched ${messages.length} messages (total collected: ${posts.length})`
      );

      if (keepGoing) await sleep(PAUSE_MS);
    }
  } finally {
    await client.disconnect();
  }

  // Sort chronologically (oldest first)
  posts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const newLabel = stopAtMsgId > 0 ? "new post(s)" : "post(s)";
  console.log(`\n📊 Scraped ${posts.length} ${newLabel} from ${channel}\n`);
  return { posts, channelTitle };
}

/**
 * Scrapes exactly `limit` posts from a Telegram channel, going backwards from `startBelowMsgId`.
 *
 * - `startBelowMsgId = 0` → starts from the most recent post (first run)
 * - `startBelowMsgId = N` → starts from the first post older than msg_id N (subsequent runs)
 *
 * Posts are returned sorted chronologically (oldest first).
 */
export async function scrapeChannelPage(
  channel: string,
  limit: number,
  startBelowMsgId = 0
): Promise<ScrapeResult> {
  const label = startBelowMsgId > 0
    ? `starting below msg_id ${startBelowMsgId}`
    : "starting from most recent";

  console.log(`📡 Scraping channel: ${channel}`);
  console.log(`📋 Mode: fetch up to ${limit} posts (${label})`);

  const client = await createTelegramClient();
  const peer = resolvePeer(channel);

  let channelTitle = "";
  try {
    const entity = await client.getEntity(peer);
    channelTitle = (entity as any).title ?? "";
    if (channelTitle) console.log(`📛 Channel title: ${channelTitle}`);
  } catch {
    // Non-critical — continue without title
  }

  const posts: RawPost[] = [];
  let offsetId = startBelowMsgId; // Telegram fetches messages with id < offsetId (0 = newest)
  let remaining = limit;

  try {
    while (remaining > 0) {
      const batchSize = Math.min(BATCH_SIZE, remaining);
      const messages = await client.getMessages(peer, {
        limit: batchSize,
        offsetId,
      });

      if (!messages || messages.length === 0) {
        console.log("  📭 No more messages.");
        break;
      }

      for (const msg of messages) {
        if (!(msg instanceof Api.Message)) continue;

        const text = msg.message ?? "";
        const hasImage = msg.media instanceof Api.MessageMediaPhoto;
        const date = msg.date
          ? new Date(msg.date * 1000).toISOString()
          : new Date().toISOString();

        if (!text.trim() && !hasImage) continue;

        let imageBase64: string | undefined;
        if (hasImage) {
          try {
            const buffer = await client.downloadMedia(msg, {}) as Buffer;
            if (buffer && buffer.length > 0) {
              imageBase64 = buffer.toString("base64");
            }
          } catch {
            // Non-critical — continue without image data
          }
        }

        posts.push({ msgId: msg.id, text, date, hasImage, imageBase64 });
        remaining--;
        if (remaining <= 0) break;
      }

      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.id) {
        offsetId = lastMsg.id;
      } else {
        break;
      }

      console.log(`  📥 Fetched ${messages.length} messages (collected: ${posts.length}/${limit})`);

      if (remaining > 0) await sleep(PAUSE_MS);
    }
  } finally {
    await client.disconnect();
  }

  // Sort chronologically (oldest first)
  posts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  console.log(`\n📊 Scraped ${posts.length} post(s) from ${channel}\n`);
  return { posts, channelTitle };
}

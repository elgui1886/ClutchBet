import dotenv from "dotenv"; dotenv.config({ override: true });
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { scrapeChannelPage } from "../../shared/channel-scraper.js";
import type { TipsExtractorStateType } from "../state.js";

const DB_PATH = path.resolve("data", "tips-analysis.db");

/**
 * Returns the min telegram_msg_id stored for a given channel, or 0 if none.
 * This is the oldest post we already have — the next run starts from below it.
 */
function getOldestKnownMsgId(affiliateName: string): number {
  if (!fs.existsSync(DB_PATH)) return 0;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db
      .prepare(
        "SELECT MIN(telegram_msg_id) as min_id FROM post_db WHERE post_affiliate_name = ?"
      )
      .get(affiliateName) as { min_id: number | null };
    db.close();
    return row.min_id ?? 0;
  } catch {
    return 0;
  }
}

export async function historyScraperNode(
  state: TipsExtractorStateType
): Promise<Partial<TipsExtractorStateType>> {
  const { channel, postLimit, channelTitle: knownTitle } = state;

  if (!channel) {
    console.log("⚠️  No channel configured. Skipping history scraper.");
    return { rawPosts: [] };
  }

  // On first run knownTitle is empty; we resolve it inside scrapeChannelPage.
  // On subsequent runs it's already in state (set by the previous run's db-writer).
  // We use it as the key to look up the DB — same value stored in post_affiliate_name.
  const oldestMsgId = getOldestKnownMsgId(knownTitle || channel);

  if (oldestMsgId > 0) {
    console.log(
      `⏩ Incremental mode: fetching ${postLimit} posts before msg_id ${oldestMsgId}`
    );
  } else {
    console.log(`🆕 First run: fetching the ${postLimit} most recent posts`);
  }

  const { posts, channelTitle } = await scrapeChannelPage(
    channel,
    postLimit,
    oldestMsgId
  );

  if (posts.length === 0 && oldestMsgId > 0) {
    console.log("✅ No older posts found — channel history fully scraped.");
  }

  return { rawPosts: posts, channelTitle };
}

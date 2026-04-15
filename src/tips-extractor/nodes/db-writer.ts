import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { TipsExtractorStateType, AnalyzedPost } from "../state.js";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "tips-analysis.db");

// 21 letters of the Italian alphabet (no J, K, W, X, Y)
const ITALIAN_ALPHABET = "ABCDEFGHILMNOPQRSTUVZ";

function generateSelectionId(usedIds: Set<string>): string {
  let id: string;
  do {
    id = Array.from(
      { length: 6 },
      () => ITALIAN_ALPHABET[Math.floor(Math.random() * ITALIAN_ALPHABET.length)]
    ).join("");
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function calcDistanceTimestamp(
  pubIso: string,
  eventIso: string | null | undefined
): string | null {
  if (!eventIso) return null;
  const pub = new Date(pubIso).getTime();
  const evt = new Date(eventIso).getTime();
  if (isNaN(pub) || isNaN(evt)) return null;
  const totalMinutes = Math.floor(Math.abs(evt - pub) / 60_000);
  const hh = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const mm = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function initDb(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_db (
      post_id                     INTEGER PRIMARY KEY,
      telegram_msg_id             INTEGER,
      post_affiliate_name         TEXT,
      post_publication_timestamp  TEXT,
      post_type                   TEXT,
      is_tips                     INTEGER,
      post_text                   TEXT,
      post_image                  INTEGER,
      tips_first_event_timestamp  TEXT,
      tips_distance_timestamp     TEXT,
      tips_event_count            INTEGER,
      tips_total_odds             REAL,
      tips_topic                  TEXT
    );

    CREATE TABLE IF NOT EXISTS selections_db (
      post_id                INTEGER NOT NULL,
      selections_id          TEXT PRIMARY KEY,
      selections_sport       TEXT,
      selections_competition TEXT,
      selections_event       TEXT,
      selections_timestamp   TEXT,
      selections_market      TEXT,
      selections_outcome     TEXT,
      selections_odds        REAL,
      FOREIGN KEY (post_id) REFERENCES post_db(post_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_channel_msgid
      ON post_db(post_affiliate_name, telegram_msg_id);
  `);

  // Migration: add telegram_msg_id to existing DBs that don't have it yet
  try {
    db.exec("ALTER TABLE post_db ADD COLUMN telegram_msg_id INTEGER");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_post_channel_msgid ON post_db(post_affiliate_name, telegram_msg_id)"
    );
  } catch {
    // Column already exists — no action needed
  }

  return db;
}

export async function dbWriterNode(
  state: TipsExtractorStateType
): Promise<Partial<TipsExtractorStateType>> {
  const { analyzedPosts, channelTitle, channel } = state;

  if (analyzedPosts.length === 0) {
    console.log("⚠️  No analyzed posts to save.");
    return {};
  }

  const affiliateName = channelTitle || channel;
  const db = initDb();

  // Remove only existing data for this channel so other channels are preserved
  const existingPostIds = db
    .prepare("SELECT post_id FROM post_db WHERE post_affiliate_name = ?")
    .all(affiliateName) as { post_id: number }[];

  if (existingPostIds.length > 0) {
    const ids = existingPostIds.map((r) => r.post_id).join(",");
    db.exec(`DELETE FROM selections_db WHERE post_id IN (${ids})`);
    db.prepare("DELETE FROM post_db WHERE post_affiliate_name = ?").run(affiliateName);
    console.log(`🗄️  Cleared ${existingPostIds.length} existing post(s) for "${affiliateName}"\n`);
  } else {
    console.log(`🗄️  No existing data for "${affiliateName}" — fresh insert\n`);
  }

  // post_id must be globally unique across all channels
  const maxRow = db
    .prepare("SELECT MAX(post_id) as max_id FROM post_db")
    .get() as { max_id: number | null };
  let postIdCounter = (maxRow.max_id ?? 0) + 1;

  // Pre-load all existing selections_ids to avoid collisions
  const usedSelectionIds = new Set<string>(
    (db.prepare("SELECT selections_id FROM selections_db").all() as { selections_id: string }[])
      .map((r) => r.selections_id)
  );

  const insertPost = db.prepare(`
    INSERT OR IGNORE INTO post_db (
      post_id, telegram_msg_id, post_affiliate_name, post_publication_timestamp,
      post_type, is_tips, post_text, post_image,
      tips_first_event_timestamp, tips_distance_timestamp,
      tips_event_count, tips_total_odds, tips_topic
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSelection = db.prepare(`
    INSERT INTO selections_db (
      post_id, selections_id, selections_sport, selections_competition,
      selections_event, selections_timestamp, selections_market,
      selections_outcome, selections_odds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let tipsCount = 0;
  let selectionsCount = 0;

  const commitAll = db.transaction((posts: AnalyzedPost[]) => {
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const postId = postIdCounter++;
      const distTs = post.isTips
        ? calcDistanceTimestamp(post.rawPost.date, post.tipsFirstEventTimestamp)
        : null;

      const result = insertPost.run(
        postId,
        post.rawPost.msgId,
        affiliateName,
        post.rawPost.date,
        post.postType,
        post.isTips ? 1 : 0,
        post.rawPost.text,
        post.rawPost.hasImage ? 1 : 0,
        post.isTips ? (post.tipsFirstEventTimestamp ?? null) : null,
        post.isTips ? distTs : null,
        post.isTips ? (post.tipsEventCount ?? null) : null,
        post.isTips ? (post.tipsTotalOdds ?? null) : null,
        post.isTips ? (post.tipsTopic ?? null) : null
      );

      if (post.isTips && post.selections.length > 0 && result.changes > 0) {
        tipsCount++;
        for (const sel of post.selections) {
          const selId = generateSelectionId(usedSelectionIds);
          insertSelection.run(
            postId,
            selId,
            sel.sport ?? null,
            sel.competition ?? null,
            sel.event ?? null,
            sel.timestamp ?? null,
            sel.market ?? null,
            sel.outcome ?? null,
            sel.odds ?? null
          );
          selectionsCount++;
        }
      }
    }
  });

  commitAll(analyzedPosts);
  db.close();

  console.log("─".repeat(50));
  console.log("✅ Database saved successfully!");
  console.log(`   Posts written    : ${analyzedPosts.length}`);
  console.log(`   Tips found       : ${tipsCount}`);
  console.log(`   Selections       : ${selectionsCount}`);
  console.log(`   Database         : ${DB_PATH}`);

  return {};
}

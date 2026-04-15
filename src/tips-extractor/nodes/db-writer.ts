import dotenv from "dotenv"; dotenv.config({ override: true });
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
      tips_event_count            INTEGER
    );

    CREATE TABLE IF NOT EXISTS tips_db (
      tip_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id      INTEGER NOT NULL,
      tip_position INTEGER NOT NULL,
      tip_topic    TEXT,
      tip_odds     REAL,
      tip_selections_count INTEGER,
      FOREIGN KEY (post_id) REFERENCES post_db(post_id)
    );

    CREATE TABLE IF NOT EXISTS selections_db (
      selection_id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tip_id                 INTEGER NOT NULL,
      post_id                INTEGER NOT NULL,
      selections_id          TEXT UNIQUE,
      selections_sport       TEXT,
      selections_competition TEXT,
      selections_event       TEXT,
      selections_timestamp   TEXT,
      selections_market      TEXT,
      selections_outcome     TEXT,
      selections_odds        REAL,
      FOREIGN KEY (tip_id)  REFERENCES tips_db(tip_id),
      FOREIGN KEY (post_id) REFERENCES post_db(post_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_channel_msgid
      ON post_db(post_affiliate_name, telegram_msg_id);
  `);

  // Migrations: add columns to existing DBs
  const migrations = [
    "ALTER TABLE post_db ADD COLUMN telegram_msg_id INTEGER",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_post_channel_msgid ON post_db(post_affiliate_name, telegram_msg_id)",
    // Drop old columns no longer used (not possible in SQLite — just ignore)
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* already applied */ }
  }

  // Migrate selections_db: add tip_id and selection_id if missing
  try { db.exec("ALTER TABLE selections_db ADD COLUMN tip_id INTEGER"); } catch { /* ok */ }
  try { db.exec("ALTER TABLE selections_db ADD COLUMN selection_id INTEGER"); } catch { /* ok */ }
  try { db.exec("ALTER TABLE selections_db ADD COLUMN post_id INTEGER"); } catch { /* ok */ }

  // Create tips_db if it didn't exist before
  db.exec(`
    CREATE TABLE IF NOT EXISTS tips_db (
      tip_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id      INTEGER NOT NULL,
      tip_position INTEGER NOT NULL,
      tip_topic    TEXT,
      tip_odds     REAL,
      tip_selections_count INTEGER,
      FOREIGN KEY (post_id) REFERENCES post_db(post_id)
    );
  `);

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
    db.exec(`DELETE FROM tips_db WHERE post_id IN (${ids})`);
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
    (db.prepare("SELECT selections_id FROM selections_db WHERE selections_id IS NOT NULL").all() as { selections_id: string }[])
      .map((r) => r.selections_id)
  );

  const insertPost = db.prepare(`
    INSERT OR IGNORE INTO post_db (
      post_id, telegram_msg_id, post_affiliate_name, post_publication_timestamp,
      post_type, is_tips, post_text, post_image,
      tips_first_event_timestamp, tips_distance_timestamp,
      tips_event_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTip = db.prepare(`
    INSERT INTO tips_db (
      post_id, tip_position, tip_topic, tip_odds, tip_selections_count
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const insertSelection = db.prepare(`
    INSERT INTO selections_db (
      tip_id, post_id, selections_id,
      selections_sport, selections_competition, selections_event,
      selections_timestamp, selections_market, selections_outcome, selections_odds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let postsCount = 0;
  let tipsCount = 0;
  let selectionsCount = 0;

  const commitAll = db.transaction((posts: AnalyzedPost[]) => {
    for (const post of posts) {
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
      );

      if (result.changes === 0) continue;
      postsCount++;

      if (!post.isTips || post.tips.length === 0) continue;

      for (let tipIdx = 0; tipIdx < post.tips.length; tipIdx++) {
        const tip = post.tips[tipIdx];
        const tipResult = insertTip.run(
          postId,
          tipIdx + 1,
          tip.topic ?? null,
          tip.totalOdds ?? null,
          tip.selectionsCount,
        );
        const tipId = tipResult.lastInsertRowid as number;
        tipsCount++;

        for (const sel of tip.selections) {
          const selId = generateSelectionId(usedSelectionIds);
          insertSelection.run(
            tipId,
            postId,
            selId,
            sel.sport ?? null,
            sel.competition ?? null,
            sel.event ?? null,
            sel.timestamp ?? null,
            sel.market ?? null,
            sel.outcome ?? null,
            sel.odds ?? null,
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
  console.log(`   Posts written    : ${postsCount}`);
  console.log(`   Tips written     : ${tipsCount}`);
  console.log(`   Selections       : ${selectionsCount}`);
  console.log(`   Database         : ${DB_PATH}`);

  return {};
}

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { ContentItem } from "../content-generator/state.js";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "clutchbet.db");

// ── Database setup ───────────────────────────────────────────

function getDb(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_queue (
      id             TEXT PRIMARY KEY,
      profile        TEXT NOT NULL,
      date           TEXT NOT NULL,
      format_slug    TEXT NOT NULL,
      format_name    TEXT NOT NULL,
      text           TEXT NOT NULL,
      image_base64   TEXT,
      publish_time   TEXT,
      bets_json      TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      published_at   TEXT,
      telegram_msg_id INTEGER,
      rating         INTEGER
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cq_date_profile ON content_queue(date, profile);
    CREATE INDEX IF NOT EXISTS idx_cq_status ON content_queue(status);
  `);

  // Migration: add columns if they don't exist (for existing DBs)
  try { db.exec("ALTER TABLE content_queue ADD COLUMN telegram_msg_id INTEGER"); } catch {}
  try { db.exec("ALTER TABLE content_queue ADD COLUMN rating INTEGER"); } catch {}

  return db;
}

// ── Helpers ──────────────────────────────────────────────────

export function contentItemId(date: string, profile: string, formatSlug: string): string {
  return `${date}_${profile}_${formatSlug}`;
}

function rowToContentItem(row: Record<string, unknown>): ContentItem {
  return {
    formatSlug: row.format_slug as string,
    formatName: row.format_name as string,
    text: row.text as string,
    imageBase64: (row.image_base64 as string) ?? undefined,
    publishTime: (row.publish_time as string) ?? undefined,
    bets: row.bets_json ? JSON.parse(row.bets_json as string) : undefined,
    approved: true,
    published: false,
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Save generated content items to the store. Skips duplicates by ID.
 */
export function saveContentItems(
  items: ContentItem[],
  profile: string,
  date: string
): void {
  if (items.length === 0) return;

  const db = getDb();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_queue
      (id, profile, date, format_slug, format_name, text, image_base64, publish_time, bets_json)
    VALUES
      (@id, @profile, @date, @formatSlug, @formatName, @text, @imageBase64, @publishTime, @betsJson)
  `);

  const insertMany = db.transaction((contentItems: ContentItem[]) => {
    for (const item of contentItems) {
      insert.run({
        id: contentItemId(date, profile, item.formatSlug),
        profile,
        date,
        formatSlug: item.formatSlug,
        formatName: item.formatName,
        text: item.text,
        imageBase64: item.imageBase64 ?? null,
        publishTime: item.publishTime ?? null,
        betsJson: item.bets ? JSON.stringify(item.bets) : null,
      });
    }
  });

  insertMany(items);
  db.close();
}

/**
 * Get pending (unpublished) content for a profile on a specific date.
 */
export function getPendingContent(profile: string, date: string): ContentItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM content_queue
       WHERE profile = ? AND date = ? AND status = 'pending'
       ORDER BY CASE WHEN publish_time IS NULL THEN 0 ELSE 1 END, publish_time ASC`
    )
    .all(profile, date) as Array<Record<string, unknown>>;
  db.close();
  return rows.map(rowToContentItem);
}

/**
 * Check if content has already been generated for a profile on a given date.
 */
export function hasContentForDate(profile: string, date: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM content_queue WHERE profile = ? AND date = ?")
    .get(profile, date) as { cnt: number };
  db.close();
  return row.cnt > 0;
}

/**
 * Mark a single content item as published.
 */
export function markContentPublished(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE content_queue SET status = 'published', published_at = datetime('now') WHERE id = ?"
  ).run(id);
  db.close();
}

/**
 * Update a plan item with generated content (text, image, bets).
 * Called by the publisher after just-in-time content generation.
 */
export function updateContentGenerated(
  id: string,
  text: string,
  imageBase64?: string,
  betsJson?: string,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE content_queue SET text = ?, image_base64 = ?, bets_json = ? WHERE id = ?"
  ).run(text, imageBase64 ?? null, betsJson ?? null, id);
  db.close();
}

/**
 * Expire content from previous days so it won't be retried.
 * Returns the number of expired items.
 */
export function expireOldContent(today: string): number {
  const db = getDb();
  const result = db
    .prepare("UPDATE content_queue SET status = 'expired' WHERE date < ? AND status = 'pending'")
    .run(today);
  db.close();
  return result.changes;
}

// ── Post Memory & Feedback ───────────────────────────────────

/** A published post record for memory/context injection */
export interface PostMemoryEntry {
  date: string;
  formatSlug: string;
  formatName: string;
  text: string;
  publishTime: string | null;
  rating: number | null;  // 1 = good, -1 = bad, null = unrated
}

/**
 * Save the Telegram message ID for a published content item.
 * Used later to read reactions for feedback.
 */
export function saveTelegramMsgId(id: string, msgId: number): void {
  const db = getDb();
  db.prepare("UPDATE content_queue SET telegram_msg_id = ? WHERE id = ?").run(msgId, id);
  db.close();
}

/**
 * Update the rating for a content item (based on Telegram reaction).
 * rating: 1 = liked (👍), -1 = disliked (👎), null = unrated
 */
export function updateContentRating(id: string, rating: number | null): void {
  const db = getDb();
  db.prepare("UPDATE content_queue SET rating = ? WHERE id = ?").run(rating, id);
  db.close();
}

/**
 * Get recent published posts for a profile within a date range.
 * Used to inject post memory context into the generation prompt.
 * Excludes image_base64 to keep the result lightweight.
 */
export function getRecentPosts(profile: string, daysBack: number): PostMemoryEntry[] {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const rows = db.prepare(`
    SELECT date, format_slug, format_name, text, publish_time, rating
    FROM content_queue
    WHERE profile = ? AND date >= ? AND status = 'published' AND text != ''
    ORDER BY date DESC, publish_time DESC
  `).all(profile, cutoffStr) as Array<Record<string, unknown>>;
  db.close();

  return rows.map((r) => ({
    date: r.date as string,
    formatSlug: r.format_slug as string,
    formatName: r.format_name as string,
    text: r.text as string,
    publishTime: (r.publish_time as string) ?? null,
    rating: (r.rating as number) ?? null,
  }));
}

/**
 * Get published posts that have a telegram_msg_id but no rating yet.
 * Used by the reaction-checker to know which messages to check.
 */
export function getUnratedPostsWithMsgId(profile: string): Array<{ id: string; telegramMsgId: number; date: string }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, telegram_msg_id, date FROM content_queue
    WHERE profile = ? AND status = 'published' AND telegram_msg_id IS NOT NULL AND rating IS NULL
    ORDER BY date DESC
    LIMIT 50
  `).all(profile) as Array<Record<string, unknown>>;
  db.close();

  return rows.map((r) => ({
    id: r.id as string,
    telegramMsgId: r.telegram_msg_id as number,
    date: r.date as string,
  }));
}

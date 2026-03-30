import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "clutchbet.db");
const LEGACY_JSON = path.join(DATA_DIR, "bets.json");

/** A single bet selection within a published post */
export interface TrackedBet {
  id: string;                    // unique: date_formatSlug_index
  date: string;                  // YYYY-MM-DD
  formatSlug: string;
  formatName: string;
  postText: string;              // the full published post text
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;               // HH:MM
  selection: string;             // e.g. "Over 2.5", "1", "Goal"
  odds: number;
  result?: "won" | "lost" | "void";
  matchScore?: string;           // e.g. "2-1"
  recapPublished?: boolean;
  resolvedAt?: string;           // ISO timestamp
}

export interface BetsStore {
  bets: TrackedBet[];
}

// ── Database setup ───────────────────────────────────────────

function getDb(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id             TEXT PRIMARY KEY,
      date           TEXT NOT NULL,
      format_slug    TEXT NOT NULL,
      format_name    TEXT NOT NULL,
      post_text      TEXT NOT NULL,
      home_team      TEXT NOT NULL,
      away_team      TEXT NOT NULL,
      league         TEXT NOT NULL,
      kickoff        TEXT NOT NULL,
      selection      TEXT NOT NULL,
      odds           REAL NOT NULL,
      result         TEXT,
      match_score    TEXT,
      recap_published INTEGER NOT NULL DEFAULT 0,
      resolved_at    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bets_date ON bets(date);
    CREATE INDEX IF NOT EXISTS idx_bets_result ON bets(result);
    CREATE INDEX IF NOT EXISTS idx_bets_recap ON bets(recap_published);
  `);

  return db;
}

function rowToBet(row: Record<string, unknown>): TrackedBet {
  return {
    id: row.id as string,
    date: row.date as string,
    formatSlug: row.format_slug as string,
    formatName: row.format_name as string,
    postText: row.post_text as string,
    homeTeam: row.home_team as string,
    awayTeam: row.away_team as string,
    league: row.league as string,
    kickoff: row.kickoff as string,
    selection: row.selection as string,
    odds: row.odds as number,
    result: (row.result as TrackedBet["result"]) ?? undefined,
    matchScore: (row.match_score as string) ?? undefined,
    recapPublished: (row.recap_published as number) === 1,
    resolvedAt: (row.resolved_at as string) ?? undefined,
  };
}

// ── Migration from legacy JSON ───────────────────────────────

function migrateFromJson(db: Database.Database): void {
  if (!fs.existsSync(LEGACY_JSON)) return;

  const existing = db.prepare("SELECT COUNT(*) as cnt FROM bets").get() as { cnt: number };
  if (existing.cnt > 0) return; // already migrated

  console.log("📦 Migrating bets from JSON to SQLite...");
  const raw = fs.readFileSync(LEGACY_JSON, "utf-8");
  const store = JSON.parse(raw) as BetsStore;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bets (id, date, format_slug, format_name, post_text, home_team, away_team, league, kickoff, selection, odds, result, match_score, recap_published, resolved_at)
    VALUES (@id, @date, @formatSlug, @formatName, @postText, @homeTeam, @awayTeam, @league, @kickoff, @selection, @odds, @result, @matchScore, @recapPublished, @resolvedAt)
  `);

  const migrate = db.transaction((bets: TrackedBet[]) => {
    for (const b of bets) {
      insert.run({
        id: b.id,
        date: b.date,
        formatSlug: b.formatSlug,
        formatName: b.formatName,
        postText: b.postText,
        homeTeam: b.homeTeam,
        awayTeam: b.awayTeam,
        league: b.league,
        kickoff: b.kickoff,
        selection: b.selection,
        odds: b.odds,
        result: b.result ?? null,
        matchScore: b.matchScore ?? null,
        recapPublished: b.recapPublished ? 1 : 0,
        resolvedAt: b.resolvedAt ?? null,
      });
    }
  });

  migrate(store.bets);
  console.log(`✅ Migrated ${store.bets.length} bet(s). You can safely delete ${LEGACY_JSON}`);
}

// ── Public API (same interface as before) ────────────────────

/**
 * Load all bets from the database.
 */
export function loadBets(): BetsStore {
  const db = getDb();
  migrateFromJson(db);
  const rows = db.prepare("SELECT * FROM bets ORDER BY date DESC, kickoff ASC").all();
  db.close();
  return { bets: rows.map((r) => rowToBet(r as Record<string, unknown>)) };
}

/**
 * Add new bets to the store. Skips duplicates by ID.
 */
export function addBets(newBets: TrackedBet[]): void {
  if (newBets.length === 0) return;

  const db = getDb();
  migrateFromJson(db);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bets (id, date, format_slug, format_name, post_text, home_team, away_team, league, kickoff, selection, odds)
    VALUES (@id, @date, @formatSlug, @formatName, @postText, @homeTeam, @awayTeam, @league, @kickoff, @selection, @odds)
  `);

  const insertMany = db.transaction((bets: TrackedBet[]) => {
    for (const b of bets) {
      insert.run({
        id: b.id,
        date: b.date,
        formatSlug: b.formatSlug,
        formatName: b.formatName,
        postText: b.postText,
        homeTeam: b.homeTeam,
        awayTeam: b.awayTeam,
        league: b.league,
        kickoff: b.kickoff,
        selection: b.selection,
        odds: b.odds,
      });
    }
  });

  insertMany(newBets);
  db.close();
}

/**
 * Get all pending (unresolved) bets.
 */
export function getPendingBets(): TrackedBet[] {
  const db = getDb();
  migrateFromJson(db);
  const rows = db.prepare("SELECT * FROM bets WHERE result IS NULL ORDER BY date, kickoff").all();
  db.close();
  return rows.map((r) => rowToBet(r as Record<string, unknown>));
}

/**
 * Get all resolved bets that haven't had a recap published yet.
 */
export function getUnrecappedBets(): TrackedBet[] {
  const db = getDb();
  migrateFromJson(db);
  const rows = db.prepare("SELECT * FROM bets WHERE result IS NOT NULL AND recap_published = 0 ORDER BY date, kickoff").all();
  db.close();
  return rows.map((r) => rowToBet(r as Record<string, unknown>));
}

/**
 * Update a bet's result in the store.
 */
export function updateBetResult(
  betId: string,
  result: "won" | "lost" | "void",
  matchScore: string
): void {
  const db = getDb();
  db.prepare(
    "UPDATE bets SET result = ?, match_score = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(result, matchScore, betId);
  db.close();
}

/**
 * Mark bets as having their recap published.
 */
export function markRecapPublished(betIds: string[]): void {
  if (betIds.length === 0) return;
  const db = getDb();
  const update = db.prepare("UPDATE bets SET recap_published = 1 WHERE id = ?");
  const batch = db.transaction((ids: string[]) => {
    for (const id of ids) update.run(id);
  });
  batch(betIds);
  db.close();
}

/**
 * Get weekly stats (for Il Fischio Finale).
 */
export function getWeeklyStats(weekEndDate: string): {
  total: number;
  won: number;
  lost: number;
  voided: number;
  pending: number;
  roi: number;
} {
  const db = getDb();
  migrateFromJson(db);

  const endDate = new Date(weekEndDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = weekEndDate;

  const rows = db
    .prepare("SELECT result, odds FROM bets WHERE date >= ? AND date <= ?")
    .all(startStr, endStr) as Array<{ result: string | null; odds: number }>;
  db.close();

  const won = rows.filter((r) => r.result === "won").length;
  const lost = rows.filter((r) => r.result === "lost").length;
  const voided = rows.filter((r) => r.result === "void").length;
  const pending = rows.filter((r) => r.result == null).length;

  // Simple flat-stake ROI: each bet is 1 unit
  const profit = rows.reduce((acc, r) => {
    if (r.result === "won") return acc + (r.odds - 1);
    if (r.result === "lost") return acc - 1;
    return acc;
  }, 0);
  const roi = rows.length > 0 ? (profit / rows.length) * 100 : 0;

  return { total: rows.length, won, lost, voided, pending, roi };
}

/**
 * Get stats for an arbitrary date range.
 * Useful for monthly, quarterly, and annual analysis.
 */
export function getStatsForPeriod(startDate: string, endDate: string): {
  total: number;
  won: number;
  lost: number;
  voided: number;
  pending: number;
  roi: number;
  profitUnits: number;
  avgOdds: number;
  byFormat: Record<string, { total: number; won: number; lost: number; roi: number }>;
  bySelection: Record<string, { total: number; won: number; lost: number }>;
} {
  const db = getDb();
  migrateFromJson(db);

  const rows = db
    .prepare("SELECT * FROM bets WHERE date >= ? AND date <= ? ORDER BY date, kickoff")
    .all(startDate, endDate) as Array<Record<string, unknown>>;
  db.close();

  const bets = rows.map(rowToBet);

  const won = bets.filter((b) => b.result === "won").length;
  const lost = bets.filter((b) => b.result === "lost").length;
  const voided = bets.filter((b) => b.result === "void").length;
  const pending = bets.filter((b) => !b.result).length;

  const resolved = bets.filter((b) => b.result === "won" || b.result === "lost");
  const profitUnits = resolved.reduce((acc, b) => {
    if (b.result === "won") return acc + (b.odds - 1);
    return acc - 1;
  }, 0);
  const roi = resolved.length > 0 ? (profitUnits / resolved.length) * 100 : 0;
  const avgOdds = resolved.length > 0
    ? resolved.reduce((s, b) => s + b.odds, 0) / resolved.length
    : 0;

  // Breakdown by format
  const byFormat: Record<string, { total: number; won: number; lost: number; roi: number }> = {};
  for (const b of resolved) {
    const key = b.formatSlug;
    if (!byFormat[key]) byFormat[key] = { total: 0, won: 0, lost: 0, roi: 0 };
    byFormat[key].total++;
    if (b.result === "won") byFormat[key].won++;
    if (b.result === "lost") byFormat[key].lost++;
  }
  for (const key of Object.keys(byFormat)) {
    const f = byFormat[key];
    const p = bets
      .filter((b) => b.formatSlug === key && (b.result === "won" || b.result === "lost"))
      .reduce((acc, b) => (b.result === "won" ? acc + (b.odds - 1) : acc - 1), 0);
    f.roi = f.total > 0 ? (p / f.total) * 100 : 0;
  }

  // Breakdown by selection type
  const bySelection: Record<string, { total: number; won: number; lost: number }> = {};
  for (const b of resolved) {
    const key = b.selection.toLowerCase().trim();
    if (!bySelection[key]) bySelection[key] = { total: 0, won: 0, lost: 0 };
    bySelection[key].total++;
    if (b.result === "won") bySelection[key].won++;
    if (b.result === "lost") bySelection[key].lost++;
  }

  return { total: bets.length, won, lost, voided, pending, roi, profitUnits, avgOdds, byFormat, bySelection };
}

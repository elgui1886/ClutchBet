import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "clutchbet.db");

/** A single bet selection within a published post */
export interface TrackedBet {
  id: string;                    // unique: date_formatSlug_index
  slipId: string;                // groups bets into a schedina: date_formatSlug
  profile: string;               // profile slug (e.g. "il-capitano")
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

/** A schedina (bet slip) — groups bets from the same post */
export interface Schedina {
  slipId: string;
  date: string;
  formatSlug: string;
  formatName: string;
  bets: TrackedBet[];
  totalOdds: number;             // product of all individual odds
  status: "pending" | "in_corsa" | "vinta" | "bruciata";
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
      slip_id        TEXT NOT NULL,
      profile        TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_bets_slip ON bets(slip_id);
    CREATE INDEX IF NOT EXISTS idx_bets_profile ON bets(profile);
  `);

  return db;
}

function rowToBet(row: Record<string, unknown>): TrackedBet {
  return {
    id: row.id as string,
    slipId: row.slip_id as string,
    profile: row.profile as string,
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

// ── Public API ───────────────────────────────────────────────

/**
 * Extract profile slug from a profile YAML path.
 * e.g. "config/profiles/il-capitano.yaml" → "il-capitano"
 */
export function profileSlugFromPath(profilePath: string): string {
  const basename = path.basename(profilePath, path.extname(profilePath));
  return basename;
}

/**
 * Load all bets from the database.
 */
export function loadBets(): BetsStore {
  const db = getDb();
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

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bets (id, slip_id, profile, date, format_slug, format_name, post_text, home_team, away_team, league, kickoff, selection, odds)
    VALUES (@id, @slipId, @profile, @date, @formatSlug, @formatName, @postText, @homeTeam, @awayTeam, @league, @kickoff, @selection, @odds)
  `);

  const insertMany = db.transaction((bets: TrackedBet[]) => {
    for (const b of bets) {
      insert.run({
        id: b.id,
        slipId: b.slipId,
        profile: b.profile,
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
 * Get all pending (unresolved) bets for a profile.
 */
export function getPendingBets(profile: string): TrackedBet[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM bets WHERE result IS NULL AND profile = ? ORDER BY date, kickoff").all(profile);
  db.close();
  return rows.map((r) => rowToBet(r as Record<string, unknown>));
}

/**
 * Get all resolved bets that haven't had a recap published yet, for a profile.
 */
export function getUnrecappedBets(profile: string): TrackedBet[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM bets WHERE result IS NOT NULL AND recap_published = 0 AND profile = ? ORDER BY date, kickoff").all(profile);
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
 * Get weekly stats for a profile.
 */
export function getWeeklyStats(weekEndDate: string, profile: string): {
  total: number;
  won: number;
  lost: number;
  voided: number;
  pending: number;
  roi: number;
} {
  const db = getDb();

  const endDate = new Date(weekEndDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = weekEndDate;

  const rows = db.prepare(
    "SELECT result, odds FROM bets WHERE date >= ? AND date <= ? AND profile = ?"
  ).all(startStr, endStr, profile) as Array<{ result: string | null; odds: number }>;
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
 * Get stats for an arbitrary date range, for a profile.
 * Useful for monthly, quarterly, and annual analysis.
 */
export function getStatsForPeriod(startDate: string, endDate: string, profile: string): {
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

  const rows = db.prepare(
    "SELECT * FROM bets WHERE date >= ? AND date <= ? AND profile = ? ORDER BY date, kickoff"
  ).all(startDate, endDate, profile) as Array<Record<string, unknown>>;
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

// ── Schedina (bet slip) functions ────────────────────────────

/**
 * Compute the status of a schedina from its bets:
 * - "pending"   = no bets resolved yet
 * - "in_corsa"  = some bets won, some still pending, none lost
 * - "vinta"     = all bets resolved and all won
 * - "bruciata"  = at least one bet lost
 */
function computeSchedina(slipId: string, bets: TrackedBet[]): Schedina {
  const first = bets[0];
  const totalOdds = bets.reduce((acc, b) => acc * b.odds, 1);

  const won = bets.filter((b) => b.result === "won").length;
  const lost = bets.filter((b) => b.result === "lost").length;
  const pending = bets.filter((b) => !b.result).length;

  let status: Schedina["status"];
  if (lost > 0) {
    status = "bruciata";
  } else if (pending === bets.length) {
    status = "pending";
  } else if (pending === 0 && won === bets.length) {
    status = "vinta";
  } else {
    status = "in_corsa";
  }

  return {
    slipId,
    date: first.date,
    formatSlug: first.formatSlug,
    formatName: first.formatName,
    bets,
    totalOdds: Math.round(totalOdds * 100) / 100,
    status,
  };
}

/**
 * Get all active schedine (not fully resolved or recently resolved) for a profile.
 * Groups bets by slip_id and computes each schedina's status.
 */
export function getActiveSchedine(profile: string): Schedina[] {
  const db = getDb();

  // Get all slips that have at least one pending bet OR were resolved today
  const today = new Date().toISOString().split("T")[0];
  const rows = db.prepare(`
    SELECT * FROM bets WHERE slip_id IN (
      SELECT DISTINCT slip_id FROM bets
      WHERE (result IS NULL OR (resolved_at IS NOT NULL AND date(resolved_at) = ?))
        AND profile = ?
    )
    ORDER BY slip_id, kickoff
  `).all(today, profile) as Array<Record<string, unknown>>;
  db.close();

  const bets = rows.map(rowToBet);
  return groupIntoSchedine(bets);
}

/**
 * Get all schedine for a given date, for a profile.
 */
export function getSchedineForDate(date: string, profile: string): Schedina[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM bets WHERE date = ? AND profile = ? ORDER BY slip_id, kickoff"
  ).all(date, profile) as Array<Record<string, unknown>>;
  db.close();

  return groupIntoSchedine(rows.map(rowToBet));
}

function groupIntoSchedine(bets: TrackedBet[]): Schedina[] {
  const map = new Map<string, TrackedBet[]>();
  for (const b of bets) {
    const group = map.get(b.slipId) ?? [];
    group.push(b);
    map.set(b.slipId, group);
  }
  return Array.from(map.entries()).map(([slipId, group]) => computeSchedina(slipId, group));
}

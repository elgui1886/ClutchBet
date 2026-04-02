import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.resolve("data");
const HISTORY_DIR = path.join(DATA_DIR, "content-history");

interface TopicEntry {
  date: string;       // YYYY-MM-DD
  topic: string;      // brief topic summary (1-2 sentences)
}

interface FormatHistory {
  entries: TopicEntry[];
}

function historyPath(profileSlug: string, formatSlug: string): string {
  return path.join(HISTORY_DIR, `${profileSlug}_${formatSlug}.json`);
}

function ensureDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Load past topics for a given profile + format.
 * Returns the list of topic summaries (most recent last).
 */
export function loadTopicHistory(
  profileSlug: string,
  formatSlug: string,
  limit = 30
): TopicEntry[] {
  const filePath = historyPath(profileSlug, formatSlug);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: FormatHistory = JSON.parse(raw);
    return data.entries.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Save a new topic entry for a given profile + format.
 */
export function saveTopicEntry(
  profileSlug: string,
  formatSlug: string,
  topic: string
): void {
  ensureDir();
  const filePath = historyPath(profileSlug, formatSlug);
  const existing = loadTopicHistory(profileSlug, formatSlug, 100);

  existing.push({
    date: new Date().toISOString().slice(0, 10),
    topic,
  });

  // Keep only the last 100 entries
  const trimmed = existing.slice(-100);
  const data: FormatHistory = { entries: trimmed };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

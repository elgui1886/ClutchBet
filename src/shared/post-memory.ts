import { getRecentPosts, type PostMemoryEntry } from "./content-store.js";
import { getSchedineForPeriod, getStatsForPeriod, type Schedina } from "./bet-tracker.js";

/** Configuration for post memory injection */
export interface PostMemoryConfig {
  /** Number of days to look back for post history (default: 3) */
  memoryDays: number;
}

/**
 * Builds the full post memory context to inject into the LLM prompt.
 * Includes:
 * 1. Recent posts (with ratings) for style continuity and anti-repetition
 * 2. Storyline summary (recent wins/losses, streaks, momentum)
 */
export function buildPostMemoryContext(
  profile: string,
  config: PostMemoryConfig,
  currentFormatSlug: string,
): string {
  const sections: string[] = [];

  // 1. Recent post history
  const recentPosts = getRecentPosts(profile, config.memoryDays);
  if (recentPosts.length > 0) {
    sections.push(buildRecentPostsSection(recentPosts, currentFormatSlug));
  }

  // 2. Storyline / momentum summary
  const storyline = buildStorylineSection(profile, config.memoryDays);
  if (storyline) {
    sections.push(storyline);
  }

  if (sections.length === 0) return "";

  return (
    `## 🧠 MEMORIA — I tuoi post recenti e la situazione attuale\n\n` +
    `Usa questa sezione per:\n` +
    `- NON ripeterti: aperture, strutture, frasi già usate → variale\n` +
    `- Mantenere continuità: se ieri hai vinto, puoi citarlo. Se hai perso, puoi ammetterlo\n` +
    `- Imparare dal feedback: i post con 👍 sono piaciuti, imitane lo stile. Quelli con 👎 sono da evitare\n\n` +
    sections.join("\n\n")
  );
}

function buildRecentPostsSection(posts: PostMemoryEntry[], currentFormatSlug: string): string {
  // Show same-format posts first (most relevant), then others
  const sameFormat = posts.filter((p) => p.formatSlug === currentFormatSlug);
  const otherFormats = posts.filter((p) => p.formatSlug !== currentFormatSlug);

  const lines: string[] = [];

  if (sameFormat.length > 0) {
    lines.push(`### Post recenti dello STESSO formato ("${sameFormat[0].formatName}")\n`);
    lines.push(`Questi sono i tuoi post recenti per questo formato. NON ripetere le stesse aperture, strutture o espressioni. Varia SEMPRE.\n`);
    for (const post of sameFormat.slice(0, 5)) {
      const ratingIcon = post.rating === 1 ? " 👍" : post.rating === -1 ? " 👎" : "";
      // Truncate long posts to avoid context overflow
      const truncated = post.text.length > 400 ? post.text.slice(0, 400) + "..." : post.text;
      lines.push(`**${post.date}**${ratingIcon}:`);
      lines.push("```");
      lines.push(truncated);
      lines.push("```\n");
    }

    // Extract repeated patterns to explicitly warn about
    const openings = sameFormat.map((p) => p.text.split("\n")[0].trim()).filter(Boolean);
    const repeatedOpenings = findRepeatedPatterns(openings);
    if (repeatedOpenings.length > 0) {
      lines.push(`⚠️ **Aperture VIETATE** (le hai già usate troppo):`);
      for (const op of repeatedOpenings) {
        lines.push(`- "${op}"`);
      }
      lines.push("");
    }
  }

  if (otherFormats.length > 0) {
    lines.push(`### Altri post recenti (per contesto e continuità)\n`);
    // Show a compact view of other formats (just date + format + first line)
    for (const post of otherFormats.slice(0, 8)) {
      const ratingIcon = post.rating === 1 ? " 👍" : post.rating === -1 ? " 👎" : "";
      const firstLine = post.text.split("\n").find((l) => l.trim().length > 0) ?? "";
      const preview = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine;
      lines.push(`- ${post.date} | ${post.formatName}${ratingIcon}: "${preview}"`);
    }
    lines.push("");
  }

  // Feedback-driven guidance
  const liked = posts.filter((p) => p.rating === 1);
  const disliked = posts.filter((p) => p.rating === -1);

  if (liked.length > 0) {
    lines.push(`### ✅ Cosa ha funzionato (post con 👍)`);
    lines.push(`Questi post sono piaciuti — imitane il tono, la struttura e l'energia:\n`);
    for (const post of liked.slice(0, 3)) {
      const truncated = post.text.length > 300 ? post.text.slice(0, 300) + "..." : post.text;
      lines.push(`**${post.date} — ${post.formatName}**:`);
      lines.push("```");
      lines.push(truncated);
      lines.push("```\n");
    }
  }

  if (disliked.length > 0) {
    lines.push(`### ❌ Cosa NON ha funzionato (post con 👎)`);
    lines.push(`Questi post NON sono piaciuti — evita questo approccio:\n`);
    for (const post of disliked.slice(0, 3)) {
      const truncated = post.text.length > 300 ? post.text.slice(0, 300) + "..." : post.text;
      lines.push(`**${post.date} — ${post.formatName}**:`);
      lines.push("```");
      lines.push(truncated);
      lines.push("```\n");
    }
  }

  return lines.join("\n");
}

function buildStorylineSection(profile: string, daysBack: number): string | null {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - daysBack);
  const startStr = startDate.toISOString().split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

  const stats = getStatsForPeriod(startStr, todayStr, profile);
  const schedine = getSchedineForPeriod(startStr, todayStr, profile);

  if (stats.total === 0 && schedine.length === 0) return null;

  const lines: string[] = [];
  lines.push(`### 📊 Situazione attuale (ultimi ${daysBack} giorni)\n`);

  if (stats.total > 0) {
    const resolved = stats.won + stats.lost;
    lines.push(`- Scommesse totali: ${stats.total} (risolte: ${resolved})`);
    lines.push(`- Vinte: ${stats.won} | Perse: ${stats.lost} | In attesa: ${stats.pending}`);
    if (resolved > 0) {
      lines.push(`- ROI: ${stats.roi > 0 ? "+" : ""}${stats.roi.toFixed(1)}%`);
    }
  }

  // Detect streaks
  const recentSchedine = schedine
    .filter((s) => s.status === "vinta" || s.status === "bruciata")
    .sort((a, b) => b.date.localeCompare(a.date));

  if (recentSchedine.length >= 2) {
    const streak = detectStreak(recentSchedine);
    if (streak) {
      lines.push(`- ${streak}`);
    }
  }

  // Yesterday's results for storyline
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdaySchedine = schedine.filter((s) => s.date === yesterdayStr);

  if (yesterdaySchedine.length > 0) {
    const won = yesterdaySchedine.filter((s) => s.status === "vinta").length;
    const lost = yesterdaySchedine.filter((s) => s.status === "bruciata").length;
    if (won > 0 || lost > 0) {
      lines.push(`- Ieri: ${won} schedina/e vinta/e, ${lost} bruciata/e`);
    }
  }

  lines.push("");
  lines.push(
    `Usa queste informazioni per dare CONTINUITÀ ai tuoi post. ` +
    `Se sei in striscia positiva, puoi essere più carico. ` +
    `Se hai perso ieri, puoi ammettere la sconfitta e ripartire con onestà. ` +
    `NON ignorare la realtà — i follower vedono i risultati.`
  );

  return lines.join("\n");
}

/**
 * Detects a win/loss streak from recent schedine.
 */
function detectStreak(schedine: Schedina[]): string | null {
  if (schedine.length === 0) return null;

  const firstStatus = schedine[0].status;
  let count = 0;
  for (const s of schedine) {
    if (s.status === firstStatus) count++;
    else break;
  }

  if (count < 2) return null;

  if (firstStatus === "vinta") {
    return `🔥 Striscia POSITIVA: ${count} schedine vinte di fila!`;
  } else {
    return `⚠️ Striscia negativa: ${count} schedine bruciate di fila`;
  }
}

/**
 * Finds repeated opening patterns (words/phrases that appear in >50% of openings).
 */
function findRepeatedPatterns(openings: string[]): string[] {
  if (openings.length < 3) return [];

  const repeated: string[] = [];
  const seen = new Map<string, number>();

  for (const opening of openings) {
    // Check first 3-4 words as pattern
    const words = opening.replace(/[^\w\s]/g, "").trim().split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (words.length > 3) {
      seen.set(words, (seen.get(words) ?? 0) + 1);
    }
  }

  for (const [pattern, count] of seen) {
    if (count >= 2 && count / openings.length >= 0.4) {
      // Find the actual original text for display
      const original = openings.find((o) =>
        o.toLowerCase().startsWith(pattern.slice(0, Math.min(20, pattern.length)))
      );
      if (original) {
        repeated.push(original.slice(0, 60));
      }
    }
  }

  return repeated.slice(0, 5);
}

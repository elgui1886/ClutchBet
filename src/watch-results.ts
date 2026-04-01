import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parse as parseYaml } from "yaml";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { loadPrompt } from "./shared/llm-utils.js";
import {
  getPendingBets,
  updateBetResult,
  markRecapPublished,
  getActiveSchedine,
  type TrackedBet,
  type Schedina,
} from "./shared/bet-tracker.js";
import { createTelegramClient, resolvePeer } from "./shared/telegram-utils.js";
import type { ProfileConfig } from "./content-generator/state.js";

// ── Constants ────────────────────────────────────────────────

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const UPDATE_PROMPT_PATH = path.resolve("prompts", "results-update.md");

const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;   // 2 hours
const RETRY_DELAY_MS = 30 * 60 * 1000;           // 30 minutes
const MAX_RETRIES = 3;
const SCAN_INTERVAL_MS = 60 * 60 * 1000;          // 1 hour — rescan for new bets

// ── Types ────────────────────────────────────────────────────

interface ContentConfig {
  profile: string;
  publishChannel?: string;
  reviewBeforePublish?: boolean;
  league?: { id?: number; season?: number };
}

interface MatchResult {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  status: string;
}

interface ScheduledCheck {
  matchKey: string;
  retryCount: number;
  timer: ReturnType<typeof setTimeout>;
  bets: TrackedBet[];
}

// ── Global state ─────────────────────────────────────────────

const scheduledChecks = new Map<string, ScheduledCheck>();
let isProcessing = false;
const checkQueue: Array<() => Promise<void>> = [];

// ── Helpers ──────────────────────────────────────────────────

function now(): string {
  return new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getMatchKey(bet: TrackedBet): string {
  return `${bet.date}_${normalize(bet.homeTeam)}_${normalize(bet.awayTeam)}`;
}

function getEstimatedEndTime(bet: TrackedBet): Date {
  const [hours, minutes] = bet.kickoff.split(":").map(Number);
  const d = new Date(
    `${bet.date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
  );
  return new Date(d.getTime() + MATCH_DURATION_MS);
}

async function enqueueCheck(fn: () => Promise<void>): Promise<void> {
  if (isProcessing) {
    checkQueue.push(fn);
    return;
  }
  isProcessing = true;
  try {
    await fn();
  } finally {
    isProcessing = false;
    if (checkQueue.length > 0) {
      const next = checkQueue.shift()!;
      await enqueueCheck(next);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("👀 Starting results watcher...\n");

  const config = loadContentConfig();
  const profile = loadProfile(config.profile);

  console.log(`📄 Profile: ${profile.profile.name}`);
  console.log(`📡 Publish channel: ${config.publishChannel ?? "none"}`);
  console.log(`📝 Review before publish: ${config.reviewBeforePublish ?? false}\n`);

  // Initial scan & schedule
  scanAndSchedule(config, profile);

  // Periodic re-scan for new bets (published by npm run content meanwhile)
  const scanInterval = setInterval(() => {
    console.log(`\n🔄 [${now()}] Re-scanning for new pending bets...`);
    scanAndSchedule(config, profile);
  }, SCAN_INTERVAL_MS);

  // Check if we can exit (all done)
  const exitCheck = setInterval(() => {
    if (scheduledChecks.size === 0 && !isProcessing && checkQueue.length === 0) {
      const pending = getPendingBets();
      if (pending.length === 0) {
        console.log(`\n✅ [${now()}] All bets resolved. Watcher exiting.`);
        clearInterval(scanInterval);
        clearInterval(exitCheck);
      }
    }
  }, 60_000);

  console.log("⏳ Watcher is running. Press Ctrl+C to stop.\n");
}

// ── Scheduling ───────────────────────────────────────────────

function scanAndSchedule(config: ContentConfig, profile: ProfileConfig) {
  const pending = getPendingBets();
  if (pending.length === 0) {
    console.log("✅ No pending bets.");
    return;
  }

  // Group by match
  const matchGroups = new Map<string, TrackedBet[]>();
  for (const bet of pending) {
    const key = getMatchKey(bet);
    const group = matchGroups.get(key) ?? [];
    group.push(bet);
    matchGroups.set(key, group);
  }

  let newScheduled = 0;
  for (const [key, bets] of matchGroups) {
    if (scheduledChecks.has(key)) continue;

    const estimatedEnd = getEstimatedEndTime(bets[0]);
    const delayMs = Math.max(0, estimatedEnd.getTime() - Date.now());

    const check: ScheduledCheck = {
      matchKey: key,
      retryCount: 0,
      bets,
      timer: setTimeout(
        () => enqueueCheck(() => runCheck(key, config, profile)),
        delayMs
      ),
    };

    scheduledChecks.set(key, check);
    newScheduled++;

    const b = bets[0];
    if (delayMs === 0) {
      console.log(`   ⚡ ${b.homeTeam} vs ${b.awayTeam} (kick ${b.kickoff}) — checking NOW`);
    } else {
      const mins = Math.round(delayMs / 60_000);
      console.log(
        `   ⏰ ${b.homeTeam} vs ${b.awayTeam} (kick ${b.kickoff}) — check at ${formatTime(estimatedEnd)} (~${mins} min)`
      );
    }
  }

  if (newScheduled > 0) {
    console.log(`\n📋 ${newScheduled} new check(s) scheduled. Total active: ${scheduledChecks.size}`);
  } else if (pending.length > 0) {
    console.log(`📋 ${pending.length} pending bet(s), all already scheduled.`);
  }
}

// ── Check execution ──────────────────────────────────────────

async function runCheck(key: string, config: ContentConfig, profile: ProfileConfig) {
  const check = scheduledChecks.get(key);
  if (!check) return;

  const b = check.bets[0];
  console.log(`\n🔍 [${now()}] Checking: ${b.homeTeam} vs ${b.awayTeam}...`);

  const results = await fetchResults(check.bets, config);

  const resolved: TrackedBet[] = [];
  const unresolved: TrackedBet[] = [];

  for (const bet of check.bets) {
    const matchResult = findMatch(bet, results);
    if (!matchResult) {
      unresolved.push(bet);
      continue;
    }

    const score = `${matchResult.homeGoals}-${matchResult.awayGoals}`;
    const result = evaluateBet(bet.selection, matchResult);
    updateBetResult(bet.id, result, score);
    bet.result = result;
    bet.matchScore = score;
    resolved.push(bet);

    const icon = result === "won" ? "✅" : result === "lost" ? "❌" : "⚪";
    console.log(
      `   ${icon} ${bet.homeTeam} vs ${bet.awayTeam} (${score}): ${bet.selection} → ${result}`
    );
  }

  // Publish update for resolved bets
  if (resolved.length > 0) {
    await publishUpdate(resolved, config, profile);
  }

  // Handle unresolved — retry or give up
  if (unresolved.length > 0) {
    if (check.retryCount < MAX_RETRIES) {
      check.retryCount++;
      console.log(
        `   ⏳ ${b.homeTeam} vs ${b.awayTeam}: not finished. Retry ${check.retryCount}/${MAX_RETRIES} in 30 min`
      );
      check.bets = unresolved;
      check.timer = setTimeout(
        () => enqueueCheck(() => runCheck(key, config, profile)),
        RETRY_DELAY_MS
      );
    } else {
      console.log(
        `   ⚠️  Max retries (${MAX_RETRIES}) reached for ${b.homeTeam} vs ${b.awayTeam}. Skipping.`
      );
      scheduledChecks.delete(key);
    }
  } else {
    scheduledChecks.delete(key);
  }
}

// ── Update post generation & publishing ──────────────────────

async function publishUpdate(
  resolved: TrackedBet[],
  config: ContentConfig,
  profile: ProfileConfig
) {
  const involvedSlipIds = new Set(resolved.map((b) => b.slipId));
  const allSchedine = getActiveSchedine();
  const schedine = allSchedine.filter((s) => involvedSlipIds.has(s.slipId));

  console.log("\n📋 Stato schedine coinvolte:");
  for (const s of schedine) {
    const type = s.bets.length === 1 ? "singola" : `multipla (${s.bets.length} selezioni)`;
    const icon =
      s.status === "vinta"
        ? "✅"
        : s.status === "bruciata"
          ? "❌"
          : s.status === "in_corsa"
            ? "🔄"
            : "⏳";
    console.log(
      `   ${icon} ${s.formatName} — ${type} — ${s.status.toUpperCase()} (quota tot: ${s.totalOdds})`
    );
    for (const bet of s.bets) {
      const bIcon = bet.result === "won" ? "✅" : bet.result === "lost" ? "❌" : "⏳";
      console.log(
        `      ${bIcon} ${bet.homeTeam}-${bet.awayTeam}: ${bet.selection} @ ${bet.odds} ${bet.matchScore ? `(${bet.matchScore})` : ""}`
      );
    }
  }

  // Generate update post
  const updateText = await generateUpdatePost(profile, resolved, schedine);

  console.log("\n" + "=".repeat(60));
  console.log("📝 UPDATE POST\n");
  console.log(updateText);
  console.log("=".repeat(60));

  const reviewBeforePublish = config.reviewBeforePublish ?? false;
  let shouldPublish = true;

  if (reviewBeforePublish) {
    const answer = await askUser("\nPubblicare l'aggiornamento? (s/n): ");
    shouldPublish = answer.toLowerCase() === "s" || answer.toLowerCase() === "si";
  }

  if (shouldPublish && config.publishChannel) {
    await publishPost(updateText, config.publishChannel);
    markRecapPublished(resolved.map((b) => b.id));
    console.log("✅ Aggiornamento pubblicato.");
  } else if (!shouldPublish) {
    console.log("⏭️  Aggiornamento non pubblicato.");
  } else {
    console.log("⚠️  No publish channel configured.");
  }

  // Save locally
  saveRecap(updateText);
}

// ── Result fetching ──────────────────────────────────────────

async function fetchResults(
  bets: TrackedBet[],
  config: ContentConfig
): Promise<MatchResult[]> {
  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!apiKey) {
    console.log("⚠️  FOOTBALL_API_KEY not set. Using mock results.\n");
    return getMockResults(bets);
  }

  const dates = [...new Set(bets.map((b) => b.date))];
  const leagueId = config.league?.id ?? 135;
  const season = config.league?.season ?? 2025;
  const allResults: MatchResult[] = [];

  for (const date of dates) {
    try {
      const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
      url.searchParams.set("date", date);
      url.searchParams.set("status", "FT-AET-PEN");
      url.searchParams.set("league", String(leagueId));
      url.searchParams.set("season", String(season));

      const response = await fetch(url.toString(), {
        headers: { "x-apisports-key": apiKey },
      });

      if (!response.ok) {
        console.error(`❌ API-Football ${response.status} for date ${date}`);
        continue;
      }

      const data = (await response.json()) as {
        response: Array<{
          fixture: { id: number; status: { short: string } };
          teams: { home: { name: string }; away: { name: string } };
          goals: { home: number; away: number };
        }>;
      };

      for (const item of data.response) {
        allResults.push({
          fixtureId: item.fixture.id,
          homeTeam: item.teams.home.name,
          awayTeam: item.teams.away.name,
          homeGoals: item.goals.home,
          awayGoals: item.goals.away,
          status: item.fixture.status.short,
        });
      }
    } catch (err) {
      console.error(`❌ Failed to fetch results for ${date}:`, err);
    }
  }

  return allResults;
}

// ── Bet evaluation ───────────────────────────────────────────

function findMatch(bet: TrackedBet, results: MatchResult[]): MatchResult | undefined {
  return results.find(
    (r) =>
      normalize(r.homeTeam) === normalize(bet.homeTeam) &&
      normalize(r.awayTeam) === normalize(bet.awayTeam)
  );
}

function evaluateBet(
  selection: string,
  match: MatchResult
): "won" | "lost" | "void" {
  const sel = selection.toLowerCase().trim();
  const totalGoals = match.homeGoals + match.awayGoals;

  // 1X2
  if (sel === "1" || sel === "home") {
    return match.homeGoals > match.awayGoals ? "won" : "lost";
  }
  if (sel === "x" || sel === "draw" || sel === "pareggio") {
    return match.homeGoals === match.awayGoals ? "won" : "lost";
  }
  if (sel === "2" || sel === "away") {
    return match.awayGoals > match.homeGoals ? "won" : "lost";
  }

  // Double chance
  if (sel === "1x") {
    return match.homeGoals >= match.awayGoals ? "won" : "lost";
  }
  if (sel === "x2") {
    return match.awayGoals >= match.homeGoals ? "won" : "lost";
  }
  if (sel === "12") {
    return match.homeGoals !== match.awayGoals ? "won" : "lost";
  }

  // Over/Under
  const overMatch = sel.match(/over\s*(\d+\.?\d*)/);
  if (overMatch) {
    return totalGoals > parseFloat(overMatch[1]) ? "won" : "lost";
  }
  const underMatch = sel.match(/under\s*(\d+\.?\d*)/);
  if (underMatch) {
    return totalGoals < parseFloat(underMatch[1]) ? "won" : "lost";
  }

  // Goal / NoGoal (BTTS)
  if (
    sel === "goal" ||
    sel === "btts" ||
    sel === "entrambe segnano" ||
    sel === "gol"
  ) {
    return match.homeGoals > 0 && match.awayGoals > 0 ? "won" : "lost";
  }
  if (
    sel === "nogol" ||
    sel === "nogoal" ||
    sel === "no goal" ||
    sel === "no gol"
  ) {
    return match.homeGoals === 0 || match.awayGoals === 0 ? "won" : "lost";
  }

  // Multigol
  const multigolMatch = sel.match(/multigol\s*(\d+)-(\d+)/);
  if (multigolMatch) {
    const min = parseInt(multigolMatch[1]);
    const max = parseInt(multigolMatch[2]);
    return totalGoals >= min && totalGoals <= max ? "won" : "lost";
  }

  console.log(`  ⚠️  Cannot evaluate selection "${selection}" — marking as void`);
  return "void";
}

// ── Post generation ──────────────────────────────────────────

async function generateUpdatePost(
  profile: ProfileConfig,
  resolved: TrackedBet[],
  schedine: Schedina[]
): Promise<string> {
  const template = loadPrompt(UPDATE_PROMPT_PATH);

  const tonePrinciples = profile.tone.principles
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");
  const forbiddenPhrases = profile.tone.forbidden_phrases
    .map((p) => `- "${p}"`)
    .join("\n");
  const lossPrinciples = profile.losses.principles
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");

  const newlyResolved = resolved
    .map((bet) => {
      const icon =
        bet.result === "won" ? "✅" : bet.result === "lost" ? "❌" : "⚪";
      return `${icon} ${bet.homeTeam} vs ${bet.awayTeam} (${bet.matchScore}) — ${bet.selection} @ ${bet.odds} → ${bet.result}`;
    })
    .join("\n");

  const schedineStatus = schedine
    .map((s) => {
      const type =
        s.bets.length === 1
          ? "Singola"
          : `Multipla (${s.bets.length} selezioni, quota totale ${s.totalOdds})`;
      const statusLabel = {
        pending: "⏳ In attesa (nessuna partita ancora finita)",
        in_corsa: "🔄 IN CORSA (finora tutto bene, mancano delle partite)",
        vinta: "✅ VINTA!",
        bruciata: "❌ BRUCIATA",
      }[s.status];

      const betLines = s.bets
        .map((b) => {
          if (b.result) {
            const icon =
              b.result === "won" ? "✅" : b.result === "lost" ? "❌" : "⚪";
            return `  ${icon} ${b.homeTeam}-${b.awayTeam} (${b.matchScore}): ${b.selection} → ${b.result}`;
          }
          return `  ⏳ ${b.homeTeam}-${b.awayTeam}: ${b.selection} (partita non ancora finita)`;
        })
        .join("\n");

      return `${s.formatName} — ${type}\nStato: ${statusLabel}\n${betLines}`;
    })
    .join("\n\n");

  const prompt = template
    .replace("{profile_name}", profile.profile.name)
    .replace("{claim}", profile.profile.claim)
    .replace("{tone_principles}", tonePrinciples)
    .replace("{forbidden_phrases}", forbiddenPhrases)
    .replace("{register}", profile.tone.register)
    .replace("{loss_principles}", lossPrinciples)
    .replace("{newly_resolved}", newlyResolved)
    .replace("{schedine_status}", schedineStatus)
    .replace("{emoji_max}", String(profile.tone.emoji_max));

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
  });

  const response = await model.invoke([new HumanMessage(prompt)]);
  return (
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content)
  ).trim();
}

// ── Publishing ───────────────────────────────────────────────

async function publishPost(text: string, channel: string): Promise<void> {
  const client = await createTelegramClient();
  try {
    const peer = resolvePeer(channel);
    await client.sendMessage(peer, { message: text });
  } finally {
    await client.disconnect();
  }
}

// ── Utilities ────────────────────────────────────────────────

function loadContentConfig(): ContentConfig {
  const configPath = path.resolve("config", "content.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as ContentConfig;
}

function loadProfile(profilePath: string): ProfileConfig {
  const resolved = path.resolve(profilePath);
  const raw = fs.readFileSync(resolved, "utf-8");
  return parseYaml(raw) as ProfileConfig;
}

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function saveRecap(text: string): void {
  const outputDir = path.resolve("output", "recaps");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const recapPath = path.join(outputDir, `update_${timestamp}.md`);
  fs.writeFileSync(recapPath, text, "utf-8");
  console.log(`💾 Update saved to: ${recapPath}`);
}

function getMockResults(bets: TrackedBet[]): MatchResult[] {
  console.log("🔧 Using mock results for development\n");
  const scores: Array<[number, number]> = [
    [2, 1], [1, 0], [3, 2], [0, 0], [1, 1], [2, 0], [1, 3], [0, 1],
  ];
  return bets.map((bet, i) => {
    const [h, a] = scores[i % scores.length];
    return {
      fixtureId: 0,
      homeTeam: bet.homeTeam,
      awayTeam: bet.awayTeam,
      homeGoals: h,
      awayGoals: a,
      status: "FT",
    };
  });
}

main().catch((err) => {
  console.error("❌ watch-results failed:", err);
  process.exit(1);
});

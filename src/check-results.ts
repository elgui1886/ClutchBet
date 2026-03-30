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
  type TrackedBet,
} from "./shared/bet-tracker.js";
import { createTelegramClient, resolvePeer } from "./shared/telegram-utils.js";
import type { ProfileConfig } from "./content-generator/state.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const RECAP_PROMPT_PATH = path.resolve("prompts", "bet-recap.md");

interface ContentConfig {
  profile: string;
  publishChannel?: string;
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

async function main() {
  console.log("🔍 Checking results for pending bets...\n");

  const pending = getPendingBets();
  if (pending.length === 0) {
    console.log("✅ No pending bets to check.");
    process.exit(0);
  }

  console.log(`📋 ${pending.length} pending bet(s):\n`);
  for (const bet of pending) {
    console.log(`   ${bet.homeTeam} vs ${bet.awayTeam} — ${bet.selection} @ ${bet.odds}`);
  }
  console.log();

  // Fetch match results
  const results = await fetchResults(pending);

  // Evaluate each bet
  const resolved: TrackedBet[] = [];
  for (const bet of pending) {
    const match = findMatch(bet, results);
    if (!match) {
      console.log(`   ⏳ ${bet.homeTeam} vs ${bet.awayTeam}: match not finished yet`);
      continue;
    }

    const score = `${match.homeGoals}-${match.awayGoals}`;
    const result = evaluateBet(bet.selection, match);

    updateBetResult(bet.id, result, score);
    bet.result = result;
    bet.matchScore = score;
    resolved.push(bet);

    const icon = result === "won" ? "✅" : result === "lost" ? "❌" : "⚪";
    console.log(`   ${icon} ${bet.homeTeam} vs ${bet.awayTeam} (${score}): ${bet.selection} → ${result}`);
  }

  if (resolved.length === 0) {
    console.log("\nℹ️  No matches finished yet. Run again later.");
    process.exit(0);
  }

  console.log(`\n📊 ${resolved.length} bet(s) resolved\n`);

  // Generate and publish recap
  const config = loadContentConfig();
  const profile = loadProfile(config.profile);

  const recapText = await generateRecap(profile, resolved);

  console.log("\n" + "=".repeat(60));
  console.log("📝 RECAP POST\n");
  console.log(recapText);
  console.log("\n" + "=".repeat(60));

  const answer = await askUser("\nPubblicare il recap? (s/n): ");
  if (answer.toLowerCase() === "s" || answer.toLowerCase() === "si") {
    if (config.publishChannel) {
      await publishRecap(recapText, config.publishChannel);
      markRecapPublished(resolved.map((b) => b.id));
      console.log("✅ Recap pubblicato e bets aggiornate.");
    } else {
      console.log("⚠️  No publish channel configured.");
    }
  } else {
    console.log("⏭️  Recap non pubblicato.");
  }

  // Save recap locally
  const outputDir = path.resolve("output", "recaps");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().split("T")[0];
  const recapPath = path.join(outputDir, `recap_${timestamp}.md`);
  fs.writeFileSync(recapPath, recapText, "utf-8");
  console.log(`💾 Recap saved to: ${recapPath}`);
}

async function fetchResults(bets: TrackedBet[]): Promise<MatchResult[]> {
  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!apiKey) {
    console.log("⚠️  FOOTBALL_API_KEY not set. Using mock results.\n");
    return getMockResults(bets);
  }

  // Get unique dates from pending bets
  const dates = [...new Set(bets.map((b) => b.date))];
  const allResults: MatchResult[] = [];

  for (const date of dates) {
    try {
      const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
      url.searchParams.set("date", date);
      url.searchParams.set("status", "FT-AET-PEN"); // finished matches
      url.searchParams.set("league", "135"); // Serie A
      url.searchParams.set("season", "2025");

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

function findMatch(bet: TrackedBet, results: MatchResult[]): MatchResult | undefined {
  return results.find(
    (r) =>
      normalize(r.homeTeam) === normalize(bet.homeTeam) &&
      normalize(r.awayTeam) === normalize(bet.awayTeam)
  );
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function evaluateBet(selection: string, match: MatchResult): "won" | "lost" | "void" {
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
  if (sel === "goal" || sel === "btts" || sel === "entrambe segnano" || sel === "gol") {
    return match.homeGoals > 0 && match.awayGoals > 0 ? "won" : "lost";
  }
  if (sel === "nogol" || sel === "nogoal" || sel === "no goal" || sel === "no gol") {
    return match.homeGoals === 0 || match.awayGoals === 0 ? "won" : "lost";
  }

  // Multigol
  const multigolMatch = sel.match(/multigol\s*(\d+)-(\d+)/);
  if (multigolMatch) {
    const min = parseInt(multigolMatch[1]);
    const max = parseInt(multigolMatch[2]);
    return totalGoals >= min && totalGoals <= max ? "won" : "lost";
  }

  // If we can't evaluate, mark as void
  console.log(`  ⚠️  Cannot evaluate selection "${selection}" — marking as void`);
  return "void";
}

async function generateRecap(profile: ProfileConfig, bets: TrackedBet[]): Promise<string> {
  const template = loadPrompt(RECAP_PROMPT_PATH);

  const tonePrinciples = profile.tone.principles.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const forbiddenPhrases = profile.tone.forbidden_phrases.map((p) => `- "${p}"`).join("\n");
  const lossPrinciples = profile.losses.principles.map((p, i) => `${i + 1}. ${p}`).join("\n");

  const betsResults = bets
    .map((bet) => {
      const icon = bet.result === "won" ? "✅" : bet.result === "lost" ? "❌" : "⚪";
      return `${icon} **${bet.homeTeam} vs ${bet.awayTeam}** (${bet.matchScore})\n   Selezione: ${bet.selection} @ ${bet.odds}\n   Risultato: ${bet.result}`;
    })
    .join("\n\n");

  const won = bets.filter((b) => b.result === "won").length;
  const lost = bets.filter((b) => b.result === "lost").length;
  const periodStats = `Oggi: ${bets.length} giocate | ${won} ✅ ${lost} ❌`;

  const prompt = template
    .replace("{profile_name}", profile.profile.name)
    .replace("{claim}", profile.profile.claim)
    .replace("{tone_principles}", tonePrinciples)
    .replace("{forbidden_phrases}", forbiddenPhrases)
    .replace("{register}", profile.tone.register)
    .replace("{loss_principles}", lossPrinciples)
    .replace("{bets_results}", betsResults)
    .replace("{period_stats}", periodStats)
    .replace("{emoji_max}", String(profile.tone.emoji_max));

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
  });

  const response = await model.invoke([new HumanMessage(prompt)]);
  const text =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return text.trim();
}

async function publishRecap(text: string, channel: string): Promise<void> {
  const client = await createTelegramClient();
  try {
    const peer = resolvePeer(channel);
    await client.sendMessage(peer, { message: text });
  } finally {
    await client.disconnect();
  }
}

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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getMockResults(bets: TrackedBet[]): MatchResult[] {
  console.log("🔧 Using mock results for development\n");
  return bets.map((bet) => ({
    fixtureId: 0,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    homeGoals: 2,
    awayGoals: 1,
    status: "FT",
  }));
}

main().catch((err) => {
  console.error("❌ check-results failed:", err);
  process.exit(1);
});

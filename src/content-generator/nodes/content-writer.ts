import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { loadPrompt, buildSystemMessages } from "../../shared/llm-utils.js";
import { renderBetSlipImage, type BetSlip } from "../../generation/image-renderer.js";
import { generateBackground } from "../../generation/background-generator.js";
import { profileSlugFromPath, getSchedineForDate, getSchedineForPeriod, getWeeklyStats, getStatsForPeriod, type Schedina } from "../../shared/bet-tracker.js";
import { loadTopicHistory, saveTopicEntry } from "../../shared/content-history.js";
import type {
  ContentStateType,
  ContentItem,
  BetSelection,
  FormatConfig,
  Fixture,
  ProfileConfig,
  SquadPlayer,
} from "../state.js";

const CONTENT_PROMPT_PATH = path.resolve("prompts", "content-post.md");

/** Formats that contain trackable bets (require fixture/odds data) */
function hasBets(format: FormatConfig): boolean {
  // Conversational formats (buongiorno, chiusura) use fixture data for context
  // but don't propose actual bets
  if (format.type === "conversational") return false;
  return format.requires_data.some((d) =>
    ["fixtures", "odds", "referee_stats", "player_cards", "tennis_fixtures"].includes(d)
  );
}

/** Current time in Europe/Rome as minutes since midnight. */
function nowMinutesInRome(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

/** Earliest hour at which bet-format posts can be published (12:00). */
const PUBLISH_START_MINUTES = 12 * 60;

/**
 * Computes dynamic publish time by spreading posts evenly from 12:00
 * until 1h before the earliest kickoff in the schedina.
 *
 * Example: 4 bet posts with matches at 21:00 → 12:00, 14:40, 17:20, 20:00
 *
 * Returns undefined if the computed time is already past (publish immediately).
 */
function computeDynamicPublishTime(
  bets: BetSelection[] | undefined,
  fixtures: Fixture[],
  formatIndex: number,
  totalBetFormats: number,
): string | undefined {
  let kickoffs: string[] = [];
  if (bets && bets.length > 0) {
    kickoffs = bets.map((b) => b.kickoff).filter(Boolean);
  }
  if (kickoffs.length === 0) {
    kickoffs = fixtures.map((f) => f.time);
  }
  if (kickoffs.length === 0) return undefined;

  kickoffs.sort();
  const [h, m] = kickoffs[0].split(":").map(Number);
  const deadlineMinutes = h * 60 + m - 60; // 1h before earliest kickoff

  let pubMinutes: number;

  if (deadlineMinutes <= PUBLISH_START_MINUTES) {
    // Matches are early (before 13:00) — fall back to 10-min spacing from now
    pubMinutes = PUBLISH_START_MINUTES + formatIndex * 10;
  } else if (totalBetFormats <= 1) {
    // Single bet post → publish at deadline
    pubMinutes = deadlineMinutes;
  } else {
    // Spread evenly: first post at 12:00, last post at deadline
    const interval = (deadlineMinutes - PUBLISH_START_MINUTES) / (totalBetFormats - 1);
    pubMinutes = Math.round(PUBLISH_START_MINUTES + interval * formatIndex);
  }

  if (pubMinutes <= nowMinutesInRome()) return undefined;

  const pubH = Math.floor(pubMinutes / 60);
  const pubM = pubMinutes % 60;
  return `${String(pubH).padStart(2, "0")}:${String(pubM).padStart(2, "0")}`;
}

/**
 * Content-writer node — PLANNER mode.
 *
 * Instead of generating all content upfront, this node now only computes
 * the publish schedule (which format at what time). Actual content generation
 * happens just-in-time inside the publisher, right before each post goes out.
 *
 * This prevents lineup-dependent formats (marcatori, cartellini) from citing
 * players who may not end up playing due to late injuries or tactical choices.
 */
export async function contentWriterNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { profile, scheduledFormats, fixtures } = state;

  if (!profile) {
    console.log("❌ No profile loaded. Cannot plan content.");
    return { contentItems: [] };
  }

  if (scheduledFormats.length === 0) {
    console.log("ℹ️  No formats scheduled. Nothing to plan.");
    return { contentItems: [] };
  }

  console.log(`\n📋 Planning publish schedule for ${scheduledFormats.length} format(s)...\n`);

  const items: ContentItem[] = [];
  let earlyBetIndex = 0;

  // Separate bet formats into "early" (spread from 12:00) and "late" (before match)
  const earlyBetFormats = scheduledFormats.filter((s) => {
    const f = profile.formats.find((fmt) => fmt.slug === s);
    return f && hasBets(f) && !f.publish_before_match;
  });

  const totalEarlyBets = earlyBetFormats.length;

  for (const slug of scheduledFormats) {
    const format = profile.formats.find((f) => f.slug === slug);
    if (!format) {
      console.log(`⚠️  Format "${slug}" not found in profile. Skipping.`);
      continue;
    }

    // Compute publish time
    let publishTime = format.publish_time;

    if (format.publish_before_match && fixtures.length > 0) {
      // Late-generation format: publish N minutes before earliest kickoff
      publishTime = computeBeforeMatchTime(fixtures, format.publish_before_match);
      console.log(`  ⏰ ${format.name}: ${publishTime ?? "now"} (${format.publish_before_match} min before match)`);
    } else if (hasBets(format) && fixtures.length > 0) {
      // Early bet format: spread from 12:00 to 1h before kickoff
      publishTime = computeDynamicPublishTime(undefined, fixtures, earlyBetIndex, totalEarlyBets);
      earlyBetIndex++;
      console.log(`  ⏰ ${format.name}: ${publishTime ?? "now"} (spread ${earlyBetIndex}/${totalEarlyBets})`);
    } else {
      console.log(`  ⏰ ${format.name}: ${publishTime ?? "now"} (fixed)`);
    }

    items.push({
      formatSlug: slug,
      formatName: format.name,
      text: "",  // empty — content will be generated just-in-time by the publisher
      publishTime,
      approved: false,
      published: false,
    });
  }

  console.log(`\n📋 Schedule planned: ${items.length} post(s)\n`);

  return { contentItems: items };
}

/**
 * Computes publish time as N minutes before the earliest fixture kickoff.
 * Returns undefined if the time has already passed.
 */
function computeBeforeMatchTime(
  fixtures: Fixture[],
  minutesBefore: number,
): string | undefined {
  const footballFixtures = fixtures.filter((f) => f.sport !== "tennis");
  const kickoffs = footballFixtures.map((f) => f.time).filter(Boolean);
  if (kickoffs.length === 0) return undefined;

  kickoffs.sort();
  const [h, m] = kickoffs[0].split(":").map(Number);
  const pubMinutes = h * 60 + m - minutesBefore;

  if (pubMinutes <= nowMinutesInRome()) return undefined;

  const pubH = Math.floor(pubMinutes / 60);
  const pubM = pubMinutes % 60;
  return `${String(pubH).padStart(2, "0")}:${String(pubM).padStart(2, "0")}`;
}

/**
 * Generates content for a single format. Called just-in-time by the publisher
 * right before the post is published.
 *
 * @returns The generated text, optional image, and optional bets.
 */
export async function generateSingleFormat(
  format: FormatConfig,
  profile: ProfileConfig,
  profilePath: string,
  fixtures: Fixture[],
  alreadyPublishedBets?: BetSelection[],
): Promise<{ text: string; imageBase64?: string; bets?: BetSelection[] }> {
  const profileSlug = profileSlugFromPath(profilePath);

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: format.temperature ?? 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  const template = loadPrompt(CONTENT_PROMPT_PATH);

  // Filter out fixtures that have already started (important for JIT generation)
  const activeFixtures = fixtures.filter((f) => {
    const [h, m] = f.time.split(":").map(Number);
    return h * 60 + m > nowMinutesInRome();
  });

  console.log(`✍️  Generating: ${format.name} (${activeFixtures.length} active fixtures)...`);

  // Load past topic history for educational formats
  const pastTopics = !hasBets(format)
    ? loadTopicHistory(profileSlug, format.slug)
    : [];

  // Fetch daily bet results for formats that need them (e.g. Chiusura)
  const dailyResults = format.requires_data.includes("daily_results")
    ? getSchedineForDate(new Date().toISOString().split("T")[0], profileSlug)
    : undefined;

  // Fetch weekly results for recap formats (e.g. Il Fischio Finale)
  let weeklyData: { schedine: Schedina[]; stats: ReturnType<typeof getWeeklyStats> } | undefined;
  if (format.requires_data.includes("weekly_results")) {
    const today = new Date().toISOString().split("T")[0];
    const stats = getWeeklyStats(today, profileSlug);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const schedine = getSchedineForPeriod(weekStart.toISOString().split("T")[0], today, profileSlug);
    weeklyData = { schedine, stats };
    if (schedine.length > 0) {
      console.log(`  📊 Weekly data: ${schedine.length} schedine, ${stats.won}W/${stats.lost}L`);
    } else {
      console.log(`  ⚠️  No weekly bet data found for recap`);
    }
  }

  // Fetch monthly results for report formats (e.g. Report Mensile)
  let monthlyData: { schedine: Schedina[]; stats: ReturnType<typeof getStatsForPeriod> } | undefined;
  if (format.requires_data.includes("monthly_results")) {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
    const todayStr = today.toISOString().split("T")[0];
    const stats = getStatsForPeriod(monthStart, todayStr, profileSlug);
    const schedine = getSchedineForPeriod(monthStart, todayStr, profileSlug);
    monthlyData = { schedine, stats };
    if (schedine.length > 0) {
      console.log(`  📊 Monthly data: ${schedine.length} schedine, ${stats.won}W/${stats.lost}L`);
    } else {
      console.log(`  ⚠️  No monthly bet data found for report`);
    }
  }

  const prompt = buildPrompt(template, profile, format, activeFixtures, pastTopics, alreadyPublishedBets, dailyResults, weeklyData, monthlyData);
  const systemMessages = buildSystemMessages(profile);

  const MAX_RETRIES = 2;
  let text = "";
  let bets: BetSelection[] | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`  🔄 Retry ${attempt}/${MAX_RETRIES}: regenerating due to bet validation errors...`);
    }

    const response = await model.invoke([...systemMessages, new HumanMessage(prompt)]);
    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse the unified JSON output (text + bets in a single LLM call)
    try {
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned) as { text: string; bets?: BetSelection[] };
      text = parsed.text?.trim() ?? "";
      if (hasBets(format) && Array.isArray(parsed.bets) && parsed.bets.length > 0) {
        bets = parsed.bets;
        console.log(`  📊 Found ${bets.length} bet(s): ${bets.map((b) => `${b.homeTeam}-${b.awayTeam} ${b.selection} @${b.odds}`).join(", ")}`);
      }
    } catch {
      console.log(`  ⚠️  Could not parse JSON response. Treating as plain text.`);
      text = raw.trim();
      break; // no bets to validate
    }

    // Validate bets against real fixture data
    if (bets && bets.length > 0 && activeFixtures.length > 0) {
      const { valid: fixtureValid, correctedBets, errors } = validateBets(bets, activeFixtures);
      if (errors.length > 0) {
        console.log(`  ⚠️  Bet validation issues (attempt ${attempt + 1}):`);
        for (const err of errors) console.log(`     - ${err}`);
      }

      // Check overlap with already-published bets (max 50% allowed)
      const overlapResult = checkBetOverlap(correctedBets, alreadyPublishedBets);
      if (overlapResult) {
        console.log(`  ⚠️  ${overlapResult}`);
      }

      const allValid = fixtureValid && !overlapResult;

      if (allValid || attempt === MAX_RETRIES) {
        if (!allValid && attempt === MAX_RETRIES) {
          console.log(`  🔧 Max retries reached. Applying programmatic corrections...`);
        }
        bets = correctedBets;
        // Sync corrected odds back into the post text
        if (!fixtureValid) {
          text = syncOddsInText(text, bets);
        }
        break;
      }
      // else: retry generation
    } else {
      break; // no bets or no fixtures — nothing to validate
    }
  }

  // Render bet-slip image
  let imageBase64: string | undefined;
  if (format.generate_image && bets && bets.length > 0) {
    try {
      console.log(`  🖼️  Rendering bet-slip image...`);
      const slip: BetSlip = {
        title: format.name,
        bets: bets.map((b) => ({
          homeTeam: b.homeTeam,
          awayTeam: b.awayTeam,
          betType: b.selection,
          odd: b.odds,
        })),
        totalOdd: parseFloat(
          bets.reduce((acc, b) => acc * b.odds, 1).toFixed(2)
        ),
      };

      let backgroundBase64: string | undefined;
      if (profile.branding && process.env.AI_IMAGE_ENABLED !== "false") {
        try {
          backgroundBase64 = await generateBackground(
            profile.branding,
            format.name,
          );
        } catch (bgErr) {
          console.log(`  ⚠️  AI background generation failed: ${bgErr}. Using plain background.`);
        }
      } else if (profile.branding) {
        console.log(`  ℹ️  AI image generation disabled (AI_IMAGE_ENABLED=false). Using plain background.`);
      }

      const imageBuffer = await renderBetSlipImage(
        slip,
        profile.branding,
        profile.profile.name,
        backgroundBase64,
      );
      imageBase64 = imageBuffer.toString("base64");
      console.log(`  🖼️  Image rendered (${Math.round(imageBuffer.length / 1024)} KB)`);
    } catch (err) {
      console.log(`  ⚠️  Image rendering failed: ${err}. Publishing text only.`);
    }
  }

  // Save topic to history for educational formats
  if (!hasBets(format)) {
    try {
      const topicSummary = await extractTopicSummary(model, text.trim());
      if (topicSummary) {
        saveTopicEntry(profileSlug, format.slug, topicSummary);
        console.log(`  📝 Topic saved to history: "${topicSummary}"`);
      }
    } catch (err) {
      console.log(`  ⚠️  Could not save topic to history: ${err}`);
    }
  }

  console.log(`✅ ${format.name} generated (${text.trim().length} chars)\n`);

  return { text: text.trim(), imageBase64, bets };
}

/**
 * Asks the LLM to summarize the topic of an educational post in one short sentence.
 */
async function extractTopicSummary(
  model: ChatOpenAI,
  postText: string
): Promise<string | null> {
  const prompt = `Riassumi in UNA sola frase breve (max 15 parole) l'argomento principale di questo post educativo sul betting. Rispondi SOLO con la frase, niente altro.

Post:
${postText}`;

  try {
    const response = await model.invoke([new HumanMessage(prompt)]);
    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    return raw.trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

function buildPrompt(
  template: string,
  profile: ProfileConfig,
  format: FormatConfig,
  fixtures: Fixture[],
  pastTopics: Array<{ date: string; topic: string }> = [],
  alreadyPublishedBets?: BetSelection[],
  dailyResults?: Schedina[],
  weeklyData?: { schedine: Schedina[]; stats: ReturnType<typeof getWeeklyStats> },
  monthlyData?: { schedine: Schedina[]; stats: ReturnType<typeof getStatsForPeriod> },
): string {
  const tonePrinciples = profile.tone.principles
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");

  const forbiddenPhrases = profile.tone.forbidden_phrases
    .map((p) => `- "${p}"`)
    .join("\n");

  const examplePhrases = (profile.tone.example_phrases ?? [])
    .map((p) => `- "${p}"`)
    .join("\n");

  const universe = (profile.profile.universe ?? [])
    .map((u) => `- **${u.name}**: ${u.role}`)
    .join("\n");

  const sportsData = buildSportsData(format, fixtures, pastTopics, dailyResults, weeklyData, monthlyData);

  const channelName =
    profile.profile.universe.find((u) =>
      u.role.toLowerCase().includes("canale principale")
    )?.name ?? profile.profile.name;

  const examplePostsSection = buildExamplePostsSection(format);

  // Pick a random style variant for this generation (if configured)
  const styleVariant = buildStyleVariantSection(format);

  // Build already-published bets section to enforce max 50% overlap
  let alreadyPublishedSection = "";
  if (alreadyPublishedBets && alreadyPublishedBets.length > 0) {
    const lines = alreadyPublishedBets.map(
      (b) => `- ${b.homeTeam} vs ${b.awayTeam} → ${b.selection} @ ${b.odds}`
    );
    alreadyPublishedSection =
      `## Schedine già pubblicate oggi\n\n` +
      `Le seguenti selezioni sono già state pubblicate in altri post oggi. ` +
      `Rispetta la regola 16: massimo il 50% delle tue selezioni può coincidere con quelle sotto.\n\n` +
      lines.join("\n");
  }

  // Build affiliate rules if the format is "promo-del-giorno" and config has affiliate info
  const affiliateConfig = profile.config?.affiliate;
  let affiliateRules = "";
  if (format.slug === "promo-del-giorno" && affiliateConfig) {
    affiliateRules = `\n### Link affiliato\n- Sito: **${affiliateConfig.name}**\n- Link: ${affiliateConfig.link}\n- CTA suggerita: "${affiliateConfig.cta}"\n\nInserisci il link in modo naturale, come un suggerimento da amico. NON essere aggressivo o pressante. Esempio: "Se volete provare, su ${affiliateConfig.name} c'è un bonus interessante 👉 ${affiliateConfig.link}"\n`;
  }

  return template
    .replace("{profile_name}", profile.profile.name)
    .replace("{claim}", profile.profile.claim)
    .replace("{channel_name}", channelName)
    .replace("{tone_principles}", tonePrinciples)
    .replace("{forbidden_phrases}", forbiddenPhrases)
    .replace("{example_phrases}", examplePhrases)
    .replace("{universe}", universe)
    .replace("{register}", profile.tone.register)
    .replace("{emoji_max}", String(profile.tone.emoji_max))
    .replace("{uppercase_rule}", profile.tone.uppercase_rule)
    .replace("{format_name}", format.name)
    .replace("{format_description}", format.description)
    .replace("{format_template}", format.template)
    .replace("{example_posts_section}", examplePostsSection)
    .replace("{style_variant}", styleVariant)
    .replace("{sports_data}", sportsData)
    .replace("{already_published_bets}", alreadyPublishedSection)
    .replace("{affiliate_rules}", affiliateRules);
}

function buildExamplePostsSection(format: FormatConfig): string {
  if (!format.example_posts || format.example_posts.length === 0) {
    return "";
  }

  const examples = format.example_posts
    .map((post, i) => `#### Esempio ${i + 1}\n\`\`\`\n${post}\n\`\`\``)
    .join("\n\n");

  return `### Esempi di post REALI per questo format (IMITALI come stile, tono e struttura)\n\nQuesti sono post reali che hai scritto in passato. Il tuo nuovo post deve avere lo STESSO livello di personalità, lo STESSO modo di parlare, le STESSE scelte lessicali. Non copiarli parola per parola (i dati cambiano), ma il FEELING deve essere identico.\n\n${examples}`;
}

/**
 * Picks a random style variant from the format config (if any) and returns
 * a prompt section that gives the LLM a creative direction for this specific post.
 * This prevents posts from crystallizing into the same patterns over time.
 */
function buildStyleVariantSection(format: FormatConfig): string {
  if (!format.style_variants || format.style_variants.length === 0) {
    return "";
  }

  const variant = format.style_variants[Math.floor(Math.random() * format.style_variants.length)];
  console.log(`  🎨 Style variant: "${variant}"`);

  return `## Direttiva stilistica per QUESTO post\n\n**IMPORTANTE**: per questo specifico post, segui questa indicazione creativa:\n\n> ${variant}\n\nQuesta direttiva ha la priorità sulle abitudini. Usala per dare un taglio diverso al post, pur restando coerente con il tuo tono e la tua personalità.`;
}

// ── Bet validation ───────────────────────────────────────────

/** Maximum allowed deviation between LLM-returned odds and real odds. */
const ODDS_TOLERANCE = 0.10; // 10%

/** Fuzzy team name match for validation — handles abbreviations. */
function teamsMatchFuzzy(a: string, b: string): boolean {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  return al === bl || al.includes(bl) || bl.includes(al);
}

/**
 * Finds the best matching fixture for a bet, returning the fixture and
 * the specific real odds value for the bet's selection type.
 */
function findMatchingFixture(
  bet: BetSelection,
  fixtures: Fixture[],
): { fixture: Fixture; realOdds: number | undefined } | undefined {
  const match = fixtures.find(
    (f) =>
      teamsMatchFuzzy(f.homeTeam, bet.homeTeam) &&
      teamsMatchFuzzy(f.awayTeam, bet.awayTeam),
  );
  if (!match) return undefined;

  let realOdds: number | undefined;
  if (match.odds) {
    const sel = bet.selection.toLowerCase().trim();
    if (sel === "1" || sel === "home") realOdds = match.odds.home;
    else if (sel === "x" || sel === "draw") realOdds = match.odds.draw;
    else if (sel === "2" || sel === "away") realOdds = match.odds.away;
    else if (sel.includes("over") && sel.includes("2.5")) realOdds = match.odds.over25;
    else if (sel.includes("under") && sel.includes("2.5")) realOdds = match.odds.under25;
    else if (sel === "goal" || sel === "btts" || sel.includes("goal sì")) realOdds = match.odds.btts_yes;
    else if (sel === "nogol" || sel === "nogoal" || sel.includes("goal no")) realOdds = match.odds.btts_no;
    // For selections we don't have real odds for (marcatori, cartellini, etc.), realOdds stays undefined
  }

  return { fixture: match, realOdds };
}

/**
 * Validates bets against real fixture data.
 * Returns corrected bets (with real odds where available) and a list of errors.
 */
function validateBets(
  bets: BetSelection[],
  fixtures: Fixture[],
): { valid: boolean; correctedBets: BetSelection[]; errors: string[] } {
  const errors: string[] = [];
  const correctedBets: BetSelection[] = [];

  for (const bet of bets) {
    const result = findMatchingFixture(bet, fixtures);

    if (!result) {
      errors.push(
        `Fixture not found: ${bet.homeTeam} vs ${bet.awayTeam} — LLM may have hallucinated this match`,
      );
      // Drop hallucinated fixture entirely
      continue;
    }

    const corrected = { ...bet };

    if (result.realOdds != null && result.realOdds > 0) {
      const deviation = Math.abs(bet.odds - result.realOdds) / result.realOdds;
      if (deviation > ODDS_TOLERANCE) {
        errors.push(
          `Odds mismatch: ${bet.homeTeam}-${bet.awayTeam} ${bet.selection} — ` +
            `LLM: ${bet.odds}, real: ${result.realOdds} (${(deviation * 100).toFixed(0)}% off)`,
        );
        corrected.odds = result.realOdds;
      }
    }

    correctedBets.push(corrected);
  }

  // If all bets were dropped (all hallucinated), that's invalid
  const valid = errors.length === 0 && correctedBets.length > 0;
  return { valid, correctedBets, errors };
}

/**
 * Checks if the generated bets overlap more than 50% with already-published bets.
 * Two bets are considered overlapping if they share the same match AND the same market.
 *
 * Returns an error message if overlap exceeds 50%, or null if OK.
 */
function checkBetOverlap(
  newBets: BetSelection[],
  publishedBets?: BetSelection[],
): string | null {
  if (!publishedBets || publishedBets.length === 0 || newBets.length === 0) {
    return null;
  }

  let overlapping = 0;
  for (const nb of newBets) {
    const isDuplicate = publishedBets.some(
      (pb) =>
        teamsMatchFuzzy(pb.homeTeam, nb.homeTeam) &&
        teamsMatchFuzzy(pb.awayTeam, nb.awayTeam) &&
        pb.selection.toLowerCase().trim() === nb.selection.toLowerCase().trim(),
    );
    if (isDuplicate) overlapping++;
  }

  const overlapPct = overlapping / newBets.length;
  if (overlapPct > 0.5) {
    return (
      `Overlap too high: ${overlapping}/${newBets.length} selections (${(overlapPct * 100).toFixed(0)}%) ` +
      `duplicate already-published bets (max 50% allowed)`
    );
  }

  return null;
}

/**
 * Updates odds values in the post text to match the corrected bet odds.
 * Searches for the old odds number near the team names and replaces it.
 */
function syncOddsInText(text: string, bets: BetSelection[]): string {
  let result = text;
  for (const bet of bets) {
    // Find patterns like "@ 1.85" or "@1.85" near the bet context and replace
    // We look for any decimal number after @ that we need to correct
    // This is best-effort — handles the most common template patterns
    const oddsFormatted = bet.odds % 1 === 0 ? bet.odds.toFixed(1) : String(bet.odds);
    // Replace odds near team name context: find "@ <number>" patterns
    const oddsPattern = new RegExp(
      `(${escapeRegex(bet.homeTeam)}[\\s\\S]{0,200}?)@\\s*\\d+\\.\\d+`,
      "i",
    );
    const match = result.match(oddsPattern);
    if (match) {
      result = result.replace(oddsPattern, `$1@ ${oddsFormatted}`);
    }
  }

  // Recalculate total odds if present in text
  if (bets.length > 0) {
    const totalOdds = parseFloat(bets.reduce((acc, b) => acc * b.odds, 1).toFixed(2));
    result = result.replace(
      /([Qq]uota\s+totale[:\s]*)\d+[\.,]\d+/i,
      `$1${totalOdds}`,
    );
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Formats a squad into a compact string grouped by role. */
function formatSquad(squad: SquadPlayer[]): string {
  const groups: Record<string, string[]> = {};
  for (const p of squad) {
    // Normalize positions into broad categories
    let role: string;
    const pos = p.position.toLowerCase();
    if (pos.includes("goal")) role = "POR";
    else if (pos.includes("back") || pos.includes("defen")) role = "DIF";
    else if (pos.includes("mid")) role = "CEN";
    else role = "ATT";

    (groups[role] ??= []).push(p.name);
  }

  const order = ["POR", "DIF", "CEN", "ATT"];
  return order
    .filter((r) => groups[r]?.length)
    .map((r) => `[${r}] ${groups[r]!.join(", ")}`)
    .join(" | ");
}

function buildSportsData(
  format: FormatConfig,
  fixtures: Fixture[],
  pastTopics: Array<{ date: string; topic: string }> = [],
  dailyResults?: Schedina[],
  weeklyData?: { schedine: Schedina[]; stats: ReturnType<typeof getWeeklyStats> },
  monthlyData?: { schedine: Schedina[]; stats: ReturnType<typeof getStatsForPeriod> },
): string {
  // Append daily results summary if available
  const dailyResultsSection = buildDailyResultsSection(dailyResults);

  // Build weekly/monthly recap sections
  const weeklySection = weeklyData ? buildWeeklyResultsSection(weeklyData.schedine, weeklyData.stats) : "";
  const monthlySection = monthlyData ? buildMonthlyResultsSection(monthlyData.schedine, monthlyData.stats) : "";

  if (format.requires_data.length === 0 || format.requires_data.every((d) => ["daily_results", "weekly_results", "monthly_results"].includes(d))) {
    const dataSections = [dailyResultsSection, weeklySection, monthlySection].filter(Boolean).join("\n\n");
    let base = dataSections || "Nessun dato sportivo necessario per questo format. Genera contenuto originale basato sulla tua conoscenza del betting sportivo.";

    if (pastTopics.length > 0) {
      const topicList = pastTopics
        .map((t) => `- ${t.date}: ${t.topic}`)
        .join("\n");
      base += `\n\n### ⚠️ Argomenti GIÀ trattati in passato (NON ripeterli)\n\nQuesti argomenti sono già stati pubblicati. DEVI scegliere un argomento DIVERSO, che non sia una variazione o riformulazione di quelli già trattati.\n\n${topicList}\n\nScegli un argomento NUOVO e ORIGINALE che non sia mai stato coperto.`;
    }

    return base;
  }

  // Determine which fixtures to show based on format requirements
  const isTennisFormat = format.requires_data.includes("tennis_fixtures");
  const relevantFixtures = isTennisFormat
    ? fixtures.filter((f) => f.sport === "tennis")
    : fixtures.filter((f) => f.sport !== "tennis");

  if (relevantFixtures.length === 0) {
    const sportName = isTennisFormat ? "tennis" : "calcio";
    let noMatchMsg = `Nessuna partita di ${sportName} disponibile oggi. Genera contenuto basato sulle prossime partite in programma o su dati generali.`;
    if (dailyResultsSection) noMatchMsg += "\n\n" + dailyResultsSection;
    return noMatchMsg;
  }

  // Conversational formats (buongiorno, chiusura) get a lightweight summary
  // instead of the full fixture dump with odds, squads, and multi-bet rules
  if (format.type === "conversational") {
    return buildConversationalSummary(relevantFixtures, fixtures, dailyResultsSection);
  }

  const lines: string[] = [];
  
  if (isTennisFormat) {
    lines.push("### Match di tennis di oggi\n");
    for (const fixture of relevantFixtures) {
      lines.push(`**${fixture.homeTeam} vs ${fixture.awayTeam}**`);
      lines.push(`- Torneo: ${fixture.league}`);
      lines.push(`- Ora: ${fixture.time}`);
      if (fixture.odds) {
        const o = fixture.odds;
        lines.push(`- Quote: **${fixture.homeTeam}** ${o.home.toFixed(2)} | **${fixture.awayTeam}** ${o.away.toFixed(2)}`);
      }
      lines.push("");
    }
  } else {
    lines.push("### Partite di oggi\n");
    for (const fixture of relevantFixtures) {
      lines.push(`**${fixture.homeTeam} vs ${fixture.awayTeam}**`);
      lines.push(`- Campionato: ${fixture.league}`);
      lines.push(`- Data: ${fixture.date}`);
      lines.push(`- Ora: ${fixture.time}`);
      if (fixture.venue) {
        lines.push(`- Stadio: ${fixture.venue}`);
      }
      if (fixture.referee) {
        lines.push(`- Arbitro: ${fixture.referee}`);
      }
      if (fixture.odds) {
        const o = fixture.odds;
        lines.push(`- Quote 1X2: **1** ${o.home.toFixed(2)} | **X** ${o.draw.toFixed(2)} | **2** ${o.away.toFixed(2)}`);
        if (o.over25 != null && o.under25 != null) {
          lines.push(`- Over/Under 2.5: **Over** ${o.over25.toFixed(2)} | **Under** ${o.under25.toFixed(2)}`);
        }
        if (o.btts_yes != null && o.btts_no != null) {
          lines.push(`- Goal/NoGoal: **Goal** ${o.btts_yes.toFixed(2)} | **NoGoal** ${o.btts_no.toFixed(2)}`);
        }
        if (o.bookmaker) {
          lines.push(`- Fonte quote: ${o.bookmaker}`);
        }
        // Anytime scorer odds (from player props)
        if (o.anytimeScorers && o.anytimeScorers.length > 0) {
          const scorers = o.anytimeScorers
            .slice(0, 6)
            .map((s) => `${s.player} @ ${s.odds.toFixed(2)}`)
            .join(", ");
          lines.push(`- 🎯 Marcatori (segna almeno 1 gol): ${scorers}`);
        }
        // Player card odds (from player props)
        if (o.playerCards && o.playerCards.length > 0) {
          const cards = o.playerCards
            .slice(0, 6)
            .map((c) => `${c.player} @ ${c.odds.toFixed(2)}`)
            .join(", ");
          lines.push(`- 🟨 Cartellini (ammonizione): ${cards}`);
        }
      }
      // Current squad / official lineup data for each team
      if (fixture.homeSquad && fixture.homeSquad.length > 0) {
        const label = fixture.hasOfficialLineup
          ? `Formazione ufficiale (TITOLARI CONFERMATI) ${fixture.homeTeam}`
          : `Rosa attuale ${fixture.homeTeam}`;
        lines.push(`- ${label}: ${formatSquad(fixture.homeSquad)}`);
      }
      if (fixture.awaySquad && fixture.awaySquad.length > 0) {
        const label = fixture.hasOfficialLineup
          ? `Formazione ufficiale (TITOLARI CONFERMATI) ${fixture.awayTeam}`
          : `Rosa attuale ${fixture.awayTeam}`;
        lines.push(`- ${label}: ${formatSquad(fixture.awaySquad)}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "\n> ⚠️ REGOLA FONDAMENTALE — SCHEDINA MULTI-BET:\n" +
      "> Ogni post con scommesse DEVE essere una SCHEDINA con minimo 1 e massimo 6 selezioni da partite DIVERSE.\n" +
      "> NON proporre MAI una singola scommessa isolata. Seleziona le partite più interessanti tra quelle sopra.\n" +
      "> Per ogni selezione indica: partita, selezione e quota.\n" +
      "> In fondo al post mostra la QUOTA TOTALE della schedina (prodotto delle singole quote).\n\n" +
      "> Le quote sopra sono REALI e aggiornate. Usale nei tuoi post. " +
      "Non inventare MAI quote, partite, giocatori o statistiche. " +
      "Se un dato non è disponibile, omettilo.\n\n" +
      "> ⚠️ REGOLA GIOCATORI:\n" +
      (fixtures.some((f) => f.hasOfficialLineup)
        ? "> Le formazioni ufficiali sono CONFERMATE (sezioni 'Formazione ufficiale (TITOLARI CONFERMATI)'). " +
          "Cita SOLO i giocatori elencati lì — sono i titolari certi. " +
          "NON citare giocatori dalla tua memoria o da altre fonti."
        : "> Sono disponibili solo le ROSE, non le formazioni ufficiali. " +
          "Cita giocatori ESCLUSIVAMENTE dai nomi elencati nelle sezioni 'Rosa attuale'. " +
          "NON usare giocatori dalla tua memoria — potrebbero essere stati ceduti o ritirati. " +
          "Se la rosa di una squadra non è disponibile, NON citare giocatori di quella squadra.")
  );

  let result = lines.join("\n");

  // Append daily results if available (e.g. for conversational formats)
  if (dailyResultsSection) {
    result += "\n\n" + dailyResultsSection;
  }

  return result;
}

/**
 * Builds a lightweight summary for conversational formats (buongiorno, chiusura).
 * Includes: number of matches per competition, time range, and notable matches.
 * No odds, no squads, no multi-bet rules.
 */
function buildConversationalSummary(
  relevantFixtures: Fixture[],
  allFixtures: Fixture[],
  dailyResultsSection?: string,
): string {
  const lines: string[] = ["### Programma di oggi (sintesi)\n"];

  // Group by competition
  const byLeague = new Map<string, Fixture[]>();
  for (const f of relevantFixtures) {
    const group = byLeague.get(f.league) ?? [];
    group.push(f);
    byLeague.set(f.league, group);
  }

  for (const [league, matches] of byLeague) {
    const times = matches.map((m) => m.time).sort();
    const timeRange = times.length === 1
      ? `ore ${times[0]}`
      : `dalle ${times[0]} alle ${times[times.length - 1]}`;
    lines.push(`- **${league}**: ${matches.length} partita/e (${timeRange})`);
    // List the matches compactly
    for (const m of matches) {
      lines.push(`  • ${m.homeTeam} - ${m.awayTeam} (${m.time})`);
    }
  }

  // Tennis matches if any
  const tennis = allFixtures.filter((f) => f.sport === "tennis");
  if (tennis.length > 0) {
    lines.push(`- **Tennis**: ${tennis.length} match`);
  }

  lines.push("");
  lines.push(
    "> Usa queste info per dare colore al messaggio: anticipa le partite, " +
      "cita le competizioni, i big match se ci sono. NON elencare tutte le partite — " +
      "basta un riferimento naturale ('Stasera Champions', 'Serie A nel pomeriggio', ecc.)."
  );

  if (dailyResultsSection) {
    lines.push("\n" + dailyResultsSection);
  }

  return lines.join("\n");
}

/**
 * Builds a human-readable summary of today's bet results for the LLM.
 * Used by conversational formats (Chiusura) to comment authentically on the day.
 */
function buildDailyResultsSection(schedine?: Schedina[]): string {
  if (!schedine || schedine.length === 0) return "";

  const vinte = schedine.filter((s) => s.status === "vinta");
  const bruciate = schedine.filter((s) => s.status === "bruciata");
  const inCorsa = schedine.filter((s) => s.status === "in_corsa");
  const pending = schedine.filter((s) => s.status === "pending");

  const lines: string[] = ["### Risultati scommesse di oggi\n"];
  lines.push(`Schedine totali: ${schedine.length}`);
  if (vinte.length > 0) lines.push(`✅ Vinte: ${vinte.length}`);
  if (bruciate.length > 0) lines.push(`❌ Bruciate: ${bruciate.length}`);
  if (inCorsa.length > 0) lines.push(`⏳ In corsa: ${inCorsa.length}`);
  if (pending.length > 0) lines.push(`🕐 Non ancora giocate: ${pending.length}`);
  lines.push("");

  for (const s of schedine) {
    const statusIcon = s.status === "vinta" ? "✅" : s.status === "bruciata" ? "❌" : s.status === "in_corsa" ? "⏳" : "🕐";
    lines.push(`${statusIcon} **${s.formatName}** (quota ${s.totalOdds.toFixed(2)}) — ${s.status.toUpperCase()}`);
    for (const b of s.bets) {
      const betIcon = b.result === "won" ? "✅" : b.result === "lost" ? "❌" : "⏳";
      const score = b.matchScore ? ` (${b.matchScore})` : "";
      lines.push(`   ${betIcon} ${b.homeTeam} vs ${b.awayTeam}${score}: ${b.selection} @ ${b.odds}`);
    }

    // Highlight near-misses (lost by exactly 1 event)
    if (s.status === "bruciata") {
      const lostCount = s.bets.filter((b) => b.result === "lost").length;
      if (lostCount === 1) {
        const lostBet = s.bets.find((b) => b.result === "lost")!;
        lines.push(`   💔 Persa per UN solo evento: ${lostBet.homeTeam} vs ${lostBet.awayTeam}`);
      }
    }
    lines.push("");
  }

  lines.push(
    "> Usa questi risultati per commentare la giornata in modo EMOTIVO e AUTENTICO. " +
      "Se hai vinto, festeggia! Se hai perso per un evento, leva sulla sfortuna. " +
      "Se hai perso più schedine, accetta con classe senza drammi. " +
      "Se le partite non sono ancora finite, anticipa l'attesa. " +
      "NON inventare risultati — usa SOLO quelli sopra."
  );

  return lines.join("\n");
}

/**
 * Builds a section with weekly bet results for the Fischio Finale recap.
 * Shows only wins and near-misses (lost by 1 event). No percentages.
 */
function buildWeeklyResultsSection(
  schedine: Schedina[],
  stats: ReturnType<typeof getWeeklyStats>,
): string {
  if (schedine.length === 0) {
    return "### Risultati della settimana\n\nNessuna schedina questa settimana. Genera un recap leggero parlando della settimana in generale.";
  }

  const vinte = schedine.filter((s) => s.status === "vinta");
  const nearMisses = schedine.filter(
    (s) => s.status === "bruciata" && s.bets.filter((b) => b.result === "lost").length === 1,
  );

  const lines: string[] = ["### Risultati della settimana\n"];
  lines.push(`Schedine totali: ${schedine.length}`);
  lines.push(`Schedine vinte: ${vinte.length}`);
  if (nearMisses.length > 0) lines.push(`Quasi-vincite (perse per 1 evento): ${nearMisses.length}`);
  lines.push("");

  // Show winning schedine
  for (const s of vinte) {
    lines.push(`✅ **${s.formatName}** (${s.date}) — VINTA! Quota ${s.totalOdds.toFixed(2)} 💰`);
    for (const b of s.bets) {
      const score = b.matchScore ? ` (${b.matchScore})` : "";
      lines.push(`   ✅ ${b.homeTeam} vs ${b.awayTeam}${score}: ${b.selection} @ ${b.odds}`);
    }
    lines.push("");
  }

  // Show near-misses
  for (const s of nearMisses) {
    const lostBet = s.bets.find((b) => b.result === "lost")!;
    lines.push(`😤 **${s.formatName}** (${s.date}) — Bruciata per UN evento! Quota ${s.totalOdds.toFixed(2)}`);
    for (const b of s.bets) {
      const betIcon = b.result === "won" ? "✅" : "❌";
      const score = b.matchScore ? ` (${b.matchScore})` : "";
      lines.push(`   ${betIcon} ${b.homeTeam} vs ${b.awayTeam}${score}: ${b.selection} @ ${b.odds}`);
    }
    lines.push(`   💔 Ci ha tradito: ${lostBet.homeTeam} vs ${lostBet.awayTeam}`);
    lines.push("");
  }

  lines.push(
    "> REGOLE PER IL RECAP SETTIMANALE:\n" +
      "> - Racconta SOLO le vincite e le quasi-vincite (perse per 1 evento). Queste sono le storie del tuo recap.\n" +
      "> - NON elencare percentuali di successo, ROI, o statistiche secche. Il tono è EMOTIVO, non contabile.\n" +
      "> - Per le quasi-vincite, enfatizza la sfortuna con il tuo stile: 'ci ha tradito il pari al 92°'.\n" +
      "> - NON menzionare le schedine completamente sbagliate.\n" +
      "> - Se non ci sono vincite né quasi-vincite, accetta con classe e chiudi guardando avanti.\n" +
      "> - NON inventare risultati o schedine — usa SOLO i dati sopra."
  );

  return lines.join("\n");
}

/**
 * Builds a section with monthly bet results for the Report Mensile.
 * Highlights the best wins and most dramatic near-misses. No percentages.
 */
function buildMonthlyResultsSection(
  schedine: Schedina[],
  stats: ReturnType<typeof getStatsForPeriod>,
): string {
  if (schedine.length === 0) {
    return "### Risultati del mese\n\nNessuna schedina questo mese. Genera un report leggero parlando degli obiettivi per il mese prossimo.";
  }

  const vinte = schedine.filter((s) => s.status === "vinta");
  const nearMisses = schedine.filter(
    (s) => s.status === "bruciata" && s.bets.filter((b) => b.result === "lost").length === 1,
  );

  // Sort wins by total odds descending (biggest wins first)
  vinte.sort((a, b) => b.totalOdds - a.totalOdds);

  const lines: string[] = ["### Risultati del mese\n"];
  lines.push(`Schedine totali: ${schedine.length}`);
  lines.push(`Schedine vinte: ${vinte.length}`);
  if (nearMisses.length > 0) lines.push(`Quasi-vincite: ${nearMisses.length}`);
  lines.push("");

  // Top 5 wins (best odds first)
  const topWins = vinte.slice(0, 5);
  if (topWins.length > 0) {
    lines.push("#### 🏆 Le vincite migliori del mese\n");
    for (const s of topWins) {
      lines.push(`✅ **${s.formatName}** (${s.date}) — Quota ${s.totalOdds.toFixed(2)} 💰`);
      for (const b of s.bets) {
        const score = b.matchScore ? ` (${b.matchScore})` : "";
        lines.push(`   ✅ ${b.homeTeam} vs ${b.awayTeam}${score}: ${b.selection} @ ${b.odds}`);
      }
      lines.push("");
    }
  }

  // Top 3 near-misses (highest odds = most painful)
  nearMisses.sort((a, b) => b.totalOdds - a.totalOdds);
  const topNearMisses = nearMisses.slice(0, 3);
  if (topNearMisses.length > 0) {
    lines.push("#### 😤 Le più amare (perse per UN evento)\n");
    for (const s of topNearMisses) {
      const lostBet = s.bets.find((b) => b.result === "lost")!;
      lines.push(`❌ **${s.formatName}** (${s.date}) — Quota ${s.totalOdds.toFixed(2)}`);
      lines.push(`   💔 Traditi da: ${lostBet.homeTeam} vs ${lostBet.awayTeam} (${lostBet.selection})`);
      lines.push("");
    }
  }

  lines.push(
    "> REGOLE PER IL REPORT MENSILE:\n" +
      "> - Celebra le vincite più belle con entusiasmo. Racconta i momenti chiave.\n" +
      "> - Le quasi-vincite sono storie di sfortuna: raccontale con ironia e classe.\n" +
      "> - NON elencare percentuali, ROI, tabelle, o numeri freddi.\n" +
      "> - Il tono è da bilancio emotivo del mese: cosa abbiamo vissuto insieme.\n" +
      "> - Chiudi guardando al mese prossimo con carica e fiducia.\n" +
      "> - NON inventare risultati — usa SOLO i dati sopra."
  );

  return lines.join("\n");
}

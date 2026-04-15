import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { loadPrompt } from "../../shared/llm-utils.js";
import { renderBetSlipImage, type BetSlip } from "../../generation/image-renderer.js";
import { generateBackground } from "../../generation/background-generator.js";
import { profileSlugFromPath } from "../../shared/bet-tracker.js";
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
): Promise<{ text: string; imageBase64?: string; bets?: BetSelection[] }> {
  const profileSlug = profileSlugFromPath(profilePath);

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
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

  const prompt = buildPrompt(template, profile, format, activeFixtures, pastTopics);
  const response = await model.invoke([new HumanMessage(prompt)]);
  const text =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // Extract structured bets for tracking
  let bets: BetSelection[] | undefined;
  if (hasBets(format) && activeFixtures.length > 0) {
    console.log(`  📊 Extracting bet selections for tracking...`);
    bets = await extractBets(model, text.trim(), activeFixtures);
    if (bets.length > 0) {
      console.log(`  📊 Found ${bets.length} bet(s): ${bets.map((b) => `${b.homeTeam}-${b.awayTeam} ${b.selection}`).join(", ")}`);
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
        totalOdd: Math.min(
          bets.reduce((acc, b) => acc * b.odds, 1),
          35
        ),
      };

      let backgroundBase64: string | undefined;
      if (profile.branding) {
        try {
          backgroundBase64 = await generateBackground(
            profile.branding,
            format.name,
          );
        } catch (bgErr) {
          console.log(`  ⚠️  AI background generation failed: ${bgErr}. Using plain background.`);
        }
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
 * Asks the LLM to extract structured bet data from a generated post.
 */
async function extractBets(
  model: ChatOpenAI,
  postText: string,
  fixtures: Fixture[]
): Promise<BetSelection[]> {
  const fixtureList = fixtures
    .map((f) => `${f.homeTeam} vs ${f.awayTeam} (${f.league}, ${f.time})`)
    .join("\n");

  const extractPrompt = `Analizza il seguente post di betting e estrai TUTTE le scommesse/selezioni proposte.

## Post
${postText}

## Partite disponibili
${fixtureList}

## Output
Rispondi ESCLUSIVAMENTE con un array JSON valido. Niente testo aggiuntivo. Ogni elemento:
[
  {
    "homeTeam": "Squadra Casa",
    "awayTeam": "Squadra Ospite",
    "league": "Nome Competizione",
    "kickoff": "20:45",
    "selection": "Over 2.5",
    "odds": 1.85
  }
]

Se il post non contiene scommesse specifiche (es. contenuto educativo), rispondi con: []
Se la quota non è specificata, usa 0 come valore.`;

  try {
    const response = await model.invoke([new HumanMessage(extractPrompt)]);
    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned) as BetSelection[];
  } catch {
    console.log(`  ⚠️  Could not extract bets from post. Skipping tracking.`);
    return [];
  }
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
  pastTopics: Array<{ date: string; topic: string }> = []
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

  const sportsData = buildSportsData(format, fixtures, pastTopics);

  const channelName =
    profile.profile.universe.find((u) =>
      u.role.toLowerCase().includes("canale principale")
    )?.name ?? profile.profile.name;

  const examplePostsSection = buildExamplePostsSection(format);

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
    .replace("{sports_data}", sportsData)
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
  pastTopics: Array<{ date: string; topic: string }> = []
): string {
  if (format.requires_data.length === 0) {
    let base = "Nessun dato sportivo necessario per questo format. Genera contenuto originale basato sulla tua conoscenza del betting sportivo.";

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
    return `Nessuna partita di ${sportName} disponibile oggi. Genera contenuto basato sulle prossime partite in programma o su dati generali.`;
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
      }
      // Current squad data for each team
      if (fixture.homeSquad && fixture.homeSquad.length > 0) {
        lines.push(`- Rosa attuale ${fixture.homeTeam}: ${formatSquad(fixture.homeSquad)}`);
      }
      if (fixture.awaySquad && fixture.awaySquad.length > 0) {
        lines.push(`- Rosa attuale ${fixture.awayTeam}: ${formatSquad(fixture.awaySquad)}`);
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
      "> ⚠️ REGOLA GIOCATORI — USA SOLO LA ROSA ATTUALE:\n" +
      "> Se citi giocatori nel post (marcatori, cartellini, ecc.), usa ESCLUSIVAMENTE " +
      "i nomi presenti nelle rose attuali elencate sopra per ogni squadra. " +
      "NON usare giocatori dalla tua memoria — potrebbero essere stati ceduti o ritirati. " +
      "Se la rosa di una squadra non è disponibile, NON citare giocatori di quella squadra."
  );

  return lines.join("\n");
}

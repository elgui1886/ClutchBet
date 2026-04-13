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
} from "../state.js";

const CONTENT_PROMPT_PATH = path.resolve("prompts", "content-post.md");

/** Formats that contain trackable bets (require fixture/odds data) */
function hasBets(format: FormatConfig): boolean {
  return format.requires_data.some((d) =>
    ["fixtures", "odds", "referee_stats", "player_cards"].includes(d)
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

/**
 * Computes dynamic publish time: 1h before the earliest kickoff in the schedina.
 * Returns undefined if the computed time is already past (publish immediately).
 */
function computeDynamicPublishTime(
  bets: BetSelection[] | undefined,
  fixtures: Fixture[],
  offsetMinutes: number = 0,
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
  const pubMinutes = h * 60 + m - 60 + offsetMinutes;

  if (pubMinutes <= nowMinutesInRome()) return undefined;

  const pubH = Math.floor(pubMinutes / 60);
  const pubM = pubMinutes % 60;
  return `${String(pubH).padStart(2, "0")}:${String(pubM).padStart(2, "0")}`;
}

/**
 * Content-writer node — generates one post per scheduled format using the LLM.
 * The profile's tone of voice, format template, and real sports data are injected into the prompt.
 * For bet-containing formats, also extracts structured bet data for tracking.
 */
export async function contentWriterNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { profile, profilePath, scheduledFormats, fixtures } = state;

  if (!profile) {
    console.log("❌ No profile loaded. Cannot generate content.");
    return { contentItems: [] };
  }

  if (scheduledFormats.length === 0) {
    console.log("ℹ️  No formats scheduled. Nothing to generate.");
    return { contentItems: [] };
  }

  const profileSlug = profileSlugFromPath(profilePath);

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  const template = loadPrompt(CONTENT_PROMPT_PATH);
  const items: ContentItem[] = [];
  let betFormatIndex = 0;

  for (const slug of scheduledFormats) {
    const format = profile.formats.find((f) => f.slug === slug);
    if (!format) {
      console.log(`⚠️  Format "${slug}" not found in profile. Skipping.`);
      continue;
    }

    console.log(`✍️  Generating: ${format.name}...`);

    // Load past topic history for educational formats (no sports data needed)
    const pastTopics = !hasBets(format)
      ? loadTopicHistory(profileSlug, slug)
      : [];

    const prompt = buildPrompt(template, profile, format, fixtures, pastTopics);
    const response = await model.invoke([new HumanMessage(prompt)]);
    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Extract structured bets for tracking (only for bet-containing formats)
    let bets: BetSelection[] | undefined;
    if (hasBets(format) && fixtures.length > 0) {
      console.log(`  📊 Extracting bet selections for tracking...`);
      bets = await extractBets(model, text.trim(), fixtures);
      if (bets.length > 0) {
        console.log(`  📊 Found ${bets.length} bet(s): ${bets.map((b) => `${b.homeTeam}-${b.awayTeam} ${b.selection}`).join(", ")}`);
      }
    }

    // Render bet-slip image only if the format is configured for it
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

        // Generate AI background if branding is available
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

    // Save topic to history for educational formats to avoid future duplicates
    if (!hasBets(format)) {
      try {
        const topicSummary = await extractTopicSummary(model, text.trim());
        if (topicSummary) {
          saveTopicEntry(profileSlug, slug, topicSummary);
          console.log(`  📝 Topic saved to history: "${topicSummary}"`);
        }
      } catch (err) {
        console.log(`  ⚠️  Could not save topic to history: ${err}`);
      }
    }

    // Compute publish time: dynamic for bet formats, fixed for non-bet formats
    let publishTime = format.publish_time;
    if (hasBets(format) && fixtures.length > 0) {
      publishTime = computeDynamicPublishTime(bets, fixtures, betFormatIndex * 10);
      betFormatIndex++;
      if (publishTime) {
        console.log(`  ⏰ Dynamic publish time: ${publishTime} (1h before earliest kickoff)`);
      } else {
        console.log(`  ⏰ Earliest kickoff is less than 1h away — publishing immediately`);
      }
    }

    items.push({
      formatSlug: slug,
      formatName: format.name,
      text: text.trim(),
      imageBase64,
      publishTime,
      bets,
      approved: false,
      published: false,
    });

    console.log(`✅ ${format.name} generated (${text.trim().length} chars)${format.publish_time ? ` — scheduled for ${format.publish_time}` : ""}\n`);
  }

  return { contentItems: items };
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
    "league": "Serie A",
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
    .replace("{sports_data}", sportsData);
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

function buildSportsData(
  format: FormatConfig,
  fixtures: Fixture[],
  pastTopics: Array<{ date: string; topic: string }> = []
): string {
  if (format.requires_data.length === 0) {
    let base = "Nessun dato sportivo necessario per questo format. Genera contenuto educativo originale basato sulla tua conoscenza del betting sportivo.";

    if (pastTopics.length > 0) {
      const topicList = pastTopics
        .map((t) => `- ${t.date}: ${t.topic}`)
        .join("\n");
      base += `\n\n### ⚠️ Argomenti GIÀ trattati in passato (NON ripeterli)\n\nQuesti argomenti sono già stati pubblicati. DEVI scegliere un argomento DIVERSO, che non sia una variazione o riformulazione di quelli già trattati.\n\n${topicList}\n\nScegli un argomento NUOVO e ORIGINALE che non sia mai stato coperto.`;
    }

    return base;
  }

  if (fixtures.length === 0) {
    return "Nessuna partita disponibile oggi. Genera contenuto basato sulle prossime partite in programma o su dati generali.";
  }

  const lines: string[] = ["### Partite di oggi\n"];

  for (const fixture of fixtures) {
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
    lines.push("");
  }

  lines.push(
    "\n> ⚠️ REGOLA FONDAMENTALE — SCHEDINA MULTI-BET:\n" +
      "> Ogni post con scommesse DEVE essere una SCHEDINA con minimo 1 e massimo 6 selezioni da partite DIVERSE.\n" +
      "> NON proporre MAI una singola scommessa isolata. Seleziona le partite più interessanti tra quelle sopra.\n" +
      "> Per ogni selezione indica: partita, selezione e quota.\n" +
      "> In fondo al post mostra la QUOTA TOTALE della schedina (prodotto delle singole quote).\n\n" +
      "> Le quote sopra sono REALI e aggiornate. Usale nei tuoi post. " +
      "Non inventare MAI quote, partite, giocatori o statistiche. " +
      "Se un dato non è disponibile, omettilo."
  );

  return lines.join("\n");
}

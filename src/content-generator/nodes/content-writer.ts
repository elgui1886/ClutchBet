import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { loadPrompt } from "../../shared/llm-utils.js";
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

/**
 * Content-writer node — generates one post per scheduled format using the LLM.
 * The profile's tone of voice, format template, and real sports data are injected into the prompt.
 * For bet-containing formats, also extracts structured bet data for tracking.
 */
export async function contentWriterNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { profile, scheduledFormats, fixtures } = state;

  if (!profile) {
    console.log("❌ No profile loaded. Cannot generate content.");
    return { contentItems: [] };
  }

  if (scheduledFormats.length === 0) {
    console.log("ℹ️  No formats scheduled. Nothing to generate.");
    return { contentItems: [] };
  }

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
  });

  const template = loadPrompt(CONTENT_PROMPT_PATH);
  const items: ContentItem[] = [];

  for (const slug of scheduledFormats) {
    const format = profile.formats.find((f) => f.slug === slug);
    if (!format) {
      console.log(`⚠️  Format "${slug}" not found in profile. Skipping.`);
      continue;
    }

    console.log(`✍️  Generating: ${format.name}...`);

    const prompt = buildPrompt(template, profile, format, fixtures);
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

    items.push({
      formatSlug: slug,
      formatName: format.name,
      text: text.trim(),
      publishTime: format.publish_time,
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

function buildPrompt(
  template: string,
  profile: ProfileConfig,
  format: FormatConfig,
  fixtures: Fixture[]
): string {
  const tonePrinciples = profile.tone.principles
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");

  const forbiddenPhrases = profile.tone.forbidden_phrases
    .map((p) => `- "${p}"`)
    .join("\n");

  const sportsData = buildSportsData(format, fixtures);

  const channelName =
    profile.profile.universe.find((u) =>
      u.role.toLowerCase().includes("canale principale")
    )?.name ?? profile.profile.name;

  return template
    .replace("{profile_name}", profile.profile.name)
    .replace("{claim}", profile.profile.claim)
    .replace("{channel_name}", channelName)
    .replace("{tone_principles}", tonePrinciples)
    .replace("{forbidden_phrases}", forbiddenPhrases)
    .replace("{register}", profile.tone.register)
    .replace("{emoji_max}", String(profile.tone.emoji_max))
    .replace("{uppercase_rule}", profile.tone.uppercase_rule)
    .replace("{format_name}", format.name)
    .replace("{format_description}", format.description)
    .replace("{format_template}", format.template)
    .replace("{sports_data}", sportsData);
}

function buildSportsData(format: FormatConfig, fixtures: Fixture[]): string {
  if (format.requires_data.length === 0) {
    return "Nessun dato sportivo necessario per questo format. Genera contenuto educativo originale basato sulla tua conoscenza del betting sportivo.";
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
    "\n> Nota: Le quote sopra sono REALI e aggiornate. Usale nei tuoi post. " +
      "Puoi aggiungere ragionamenti e analisi basati sulla tua conoscenza " +
      "(forma squadre, statistiche recenti, ecc.)."
  );

  return lines.join("\n");
}

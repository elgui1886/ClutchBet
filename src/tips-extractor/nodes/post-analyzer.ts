import dotenv from "dotenv"; dotenv.config({ override: true });
import * as path from "node:path";
import * as fs from "node:fs";
import OpenAI from "openai";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { TipsExtractorStateType, AnalyzedPost, AnalyzedTip, LLMTip } from "../state.js";
import type { RawPost } from "../../shared/channel-scraper.js";

// Text-only posts: batch processing (faster, cheaper)
const LLM_BATCH_SIZE = 15;
// Vision posts: process individually (each needs image data)
const VISION_BATCH_SIZE = 1;
const PAUSE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BatchInputItem {
  idx: number;
  timestamp: string;
  text: string;
  has_image: boolean;
  channel: string;
}

interface LLMPostResult {
  idx: number;
  post_type: "tips_new" | "tips_update" | "interaction";
  is_tips: boolean;
  tips_first_event_timestamp: string | null;
  tips: LLMTip[];
}

interface LLMResponse {
  posts: LLMPostResult[];
}

function parseResults(results: LLMPostResult[], batchPosts: RawPost[]): AnalyzedPost[] {
  return results.map((result) => {
    const rawPost = batchPosts[result.idx];
    const tips: AnalyzedTip[] = (result.tips ?? []).map((t: LLMTip) => ({
      topic: t.topic ?? null,
      totalOdds: t.total_odds ?? null,
      selectionsCount: (t.selections ?? []).length,
      selections: t.selections ?? [],
    }));

    return {
      rawPost,
      postType: result.post_type,
      isTips: result.is_tips,
      tipsFirstEventTimestamp: result.is_tips
        ? (result.tips_first_event_timestamp ?? null)
        : null,
      tipsEventCount: result.is_tips ? tips.length : null,
      tips: result.is_tips ? tips : [],
    } satisfies AnalyzedPost;
  });
}

/** Analyze a batch of text-only posts (no images) */
async function analyzeTextBatch(
  model: ChatOpenAI,
  promptTemplate: string,
  affiliateName: string,
  batchPosts: RawPost[],
): Promise<AnalyzedPost[]> {
  const batchInput: BatchInputItem[] = batchPosts.map((p, i) => ({
    idx: i,
    timestamp: p.date,
    text: p.text,
    has_image: p.hasImage,
    channel: affiliateName,
  }));

  const prompt = promptTemplate.replace(
    "{posts_json}",
    JSON.stringify(batchInput, null, 2)
  );

  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;
  const parsed = JSON.parse(jsonStr.trim()) as LLMResponse;
  return parseResults(parsed.posts ?? [], batchPosts);
}

/** Analyze a single post that has an image using vision — uses native OpenAI client to avoid LangChain key override issues */
async function analyzeVisionPost(
  visionClient: OpenAI,
  affiliateName: string,
  post: RawPost,
): Promise<AnalyzedPost> {
  const visionPrompt = `Sei un analista di scommesse sportive. Analizza questo post Telegram di un canale italiano di betting.

Canale: ${affiliateName}
Testo del post: ${post.text || "(testo vuoto — vedi immagine allegata)"}
Data: ${post.date}

L'immagine allegata è quasi certamente una bet slip (schedina scommesse) di una piattaforma come Daznbet, Snai, Bet365 o simili.

Rispondi con un JSON valido con questa struttura:
{
  "posts": [{
    "idx": 0,
    "post_type": "tips_new",
    "is_tips": true,
    "tips_first_event_timestamp": "<ISO UTC o null>",
    "tips": [{
      "topic": "<nome rubrica o 'n/a'>",
      "total_odds": <quota totale come numero o null>,
      "selections": [{
        "sport": "<football/tennis/basket/other>",
        "competition": "<nome competizione completo>",
        "event": "<TeamA - TeamB>",
        "timestamp": "<ISO UTC o null>",
        "market": "<1X2/Over 2.5/Goal-NoGoal/etc>",
        "outcome": "<1/X/2/Over/Under/Goal/ecc>",
        "odds": <quota decimale o null>
      }]
    }]
  }]
}

Leggi attentamente l'immagine della bet slip per estrarre: partite, mercati, quote singole e quota totale.
Se il post non è una tip (es. è un saluto o promo senza schedina), usa post_type "interaction" e is_tips false con tips [].`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{
    role: "user",
    content: post.imageBase64
      ? [
          { type: "text", text: visionPrompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${post.imageBase64}`, detail: "high" } },
        ]
      : visionPrompt,
  }];

  const response = await visionClient.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;
  const parsed = JSON.parse(jsonStr.trim()) as LLMResponse;
  const results = parseResults(parsed.posts ?? [], [post]);
  return results[0] ?? fallbackPost(post);
}

function fallbackPost(rawPost: RawPost): AnalyzedPost {
  return {
    rawPost,
    postType: "interaction",
    isTips: false,
    tipsFirstEventTimestamp: null,
    tipsEventCount: null,
    tips: [],
  };
}

export async function postAnalyzerNode(
  state: TipsExtractorStateType
): Promise<Partial<TipsExtractorStateType>> {
  const { rawPosts, channelTitle, channel } = state;

  if (rawPosts.length === 0) {
    console.log("⚠️  No posts to analyze.");
    return { analyzedPosts: [] };
  }

  const affiliateName = channelTitle || channel;
  const promptTemplate = fs.readFileSync(
    path.resolve("prompts", "tips-extractor.md"),
    "utf-8"
  );

  // Text model for text-only posts
  const textModel = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  // Vision client: use native OpenAI SDK to bypass LangChain key resolution issues
  const imageApiKey = process.env.OPENAI_IMAGE_API_KEY;
  const visionClient = new OpenAI({
    apiKey: imageApiKey ?? process.env.OPENAI_API_KEY,
    baseURL: imageApiKey ? "https://api.openai.com/v1" : process.env.OPENAI_BASE_URL,
  });
  console.log(`🔑 Vision key: ${(imageApiKey ?? process.env.OPENAI_API_KEY)?.substring(0, 10)}...`);

  // Split posts: vision posts (have image downloaded) vs text-only
  const visionPosts = rawPosts.filter((p) => p.hasImage && p.imageBase64);
  const textPosts = rawPosts.filter((p) => !(p.hasImage && p.imageBase64));

  console.log(`🤖 Analyzing ${rawPosts.length} posts:`);
  console.log(`   📷 Vision (image) posts: ${visionPosts.length}`);
  console.log(`   📝 Text-only posts:      ${textPosts.length}\n`);

  // Map from msgId → analyzed result (to preserve original order at the end)
  const resultMap = new Map<number, AnalyzedPost>();

  // ── Vision posts (one by one) ──
  if (visionPosts.length > 0) {
    console.log(`🖼️  Processing ${visionPosts.length} vision post(s)...`);
    for (let i = 0; i < visionPosts.length; i++) {
      const post = visionPosts[i];
      console.log(`  📷 Vision ${i + 1}/${visionPosts.length} (msg ${post.msgId})...`);
      try {
        const result = await analyzeVisionPost(visionClient, affiliateName, post);
        resultMap.set(post.msgId, result);
      } catch (err) {
        console.error(`  ❌ Vision failed for msg ${post.msgId}:`, (err as Error).message);
        resultMap.set(post.msgId, fallbackPost(post));
      }
      if (i < visionPosts.length - 1) await sleep(PAUSE_MS);
    }
    console.log();
  }

  // ── Text-only posts (batched) ──
  if (textPosts.length > 0) {
    const totalBatches = Math.ceil(textPosts.length / LLM_BATCH_SIZE);
    console.log(`📝 Processing ${textPosts.length} text post(s) in ${totalBatches} batch(es)...`);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * LLM_BATCH_SIZE;
      const batchPosts = textPosts.slice(batchStart, batchStart + LLM_BATCH_SIZE);

      console.log(
        `  📦 Batch ${batchIdx + 1}/${totalBatches} ` +
          `(posts ${batchStart + 1}–${batchStart + batchPosts.length})...`
      );

      try {
        const results = await analyzeTextBatch(textModel, promptTemplate, affiliateName, batchPosts);
        for (const r of results) resultMap.set(r.rawPost.msgId, r);
        console.log(`    ✅ Analyzed ${results.length} post(s)`);
      } catch (err) {
        console.error(`    ❌ Batch ${batchIdx + 1} failed:`, (err as Error).message);
        for (const p of batchPosts) resultMap.set(p.msgId, fallbackPost(p));
      }

      if (batchIdx < totalBatches - 1) await sleep(PAUSE_MS);
    }
    console.log();
  }

  // Rebuild in original order
  const allAnalyzed = rawPosts.map((p) => resultMap.get(p.msgId) ?? fallbackPost(p));

  const tipsPostsCount = allAnalyzed.filter((p) => p.isTips).length;
  const totalTips = allAnalyzed.reduce((sum, p) => sum + (p.tipsEventCount ?? 0), 0);
  const totalSelections = allAnalyzed.reduce(
    (sum, p) => sum + p.tips.reduce((s, t) => s + t.selectionsCount, 0),
    0
  );

  console.log(`✅ LLM analysis complete:`);
  console.log(`   Posts processed  : ${allAnalyzed.length}`);
  console.log(`   Posts with tips  : ${tipsPostsCount}`);
  console.log(`   Total tips       : ${totalTips}`);
  console.log(`   Total selections : ${totalSelections}\n`);

  return { analyzedPosts: allAnalyzed };
}

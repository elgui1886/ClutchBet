import "dotenv/config";
import * as path from "node:path";
import * as fs from "node:fs";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { TipsExtractorStateType, AnalyzedPost, LLMSelection } from "../state.js";
import type { RawPost } from "../../shared/channel-scraper.js";

const LLM_BATCH_SIZE = 15;
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
  tips_event_count: number | null;
  tips_total_odds: number | null;
  tips_topic: string | null;
  selections: LLMSelection[];
}

interface LLMResponse {
  posts: LLMPostResult[];
}

async function analyzeBatch(
  model: ChatOpenAI,
  promptTemplate: string,
  affiliateName: string,
  batchPosts: RawPost[],
  batchOffset: number
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

  // Strip markdown code fences if present
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;

  const parsed = JSON.parse(jsonStr.trim()) as LLMResponse;
  const results = parsed.posts ?? [];

  return results.map((result) => {
    const rawPost = batchPosts[result.idx];
    return {
      rawPost,
      postType: result.post_type,
      isTips: result.is_tips,
      tipsFirstEventTimestamp: result.is_tips
        ? (result.tips_first_event_timestamp ?? null)
        : null,
      tipsEventCount: result.is_tips ? (result.tips_event_count ?? null) : null,
      tipsTotalOdds: result.is_tips ? (result.tips_total_odds ?? null) : null,
      tipsTopic: result.is_tips ? (result.tips_topic ?? null) : null,
      selections: result.is_tips ? (result.selections ?? []) : [],
    } satisfies AnalyzedPost;
  });
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

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });

  const totalBatches = Math.ceil(rawPosts.length / LLM_BATCH_SIZE);
  console.log(
    `🤖 Analyzing ${rawPosts.length} posts in ${totalBatches} batch(es) of ${LLM_BATCH_SIZE}...\n`
  );

  const allAnalyzed: AnalyzedPost[] = [];
  let failedBatches = 0;

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * LLM_BATCH_SIZE;
    const batchPosts = rawPosts.slice(batchStart, batchStart + LLM_BATCH_SIZE);

    console.log(
      `📦 Batch ${batchIdx + 1}/${totalBatches} ` +
        `(posts ${batchStart + 1}–${batchStart + batchPosts.length})...`
    );

    try {
      const results = await analyzeBatch(
        model,
        promptTemplate,
        affiliateName,
        batchPosts,
        batchStart
      );
      allAnalyzed.push(...results);
      console.log(`  ✅ Analyzed ${results.length} post(s)`);
    } catch (err) {
      console.error(
        `  ❌ Batch ${batchIdx + 1} failed:`,
        (err as Error).message
      );
      failedBatches++;
      // Push placeholders so post indices remain consistent with rawPosts
      for (const rawPost of batchPosts) {
        allAnalyzed.push({
          rawPost,
          postType: "interaction",
          isTips: false,
          tipsFirstEventTimestamp: null,
          tipsEventCount: null,
          tipsTotalOdds: null,
          tipsTopic: null,
          selections: [],
        });
      }
    }

    if (batchIdx < totalBatches - 1) await sleep(PAUSE_MS);
  }

  if (failedBatches > 0) {
    console.log(
      `\n⚠️  ${failedBatches} batch(es) failed — affected posts saved as "interaction"\n`
    );
  }

  const tipsCount = allAnalyzed.filter((p) => p.isTips).length;
  console.log(
    `\n✅ LLM analysis complete: ${allAnalyzed.length} posts processed, ${tipsCount} tips found\n`
  );

  return { analyzedPosts: allAnalyzed };
}

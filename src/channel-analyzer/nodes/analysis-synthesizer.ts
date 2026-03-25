import * as fs from "node:fs";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "../../shared/llm.js";
import type { AnalysisStateType } from "../state.js";

const SYNTHESIS_PROMPT_PATH = path.resolve("prompts", "analysis-synthesis.md");

function loadPrompt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export async function analysisSynthesizerNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { chunkAnalyses, channelId, posts } = state;

  console.log(`\n📝 Synthesizing ${chunkAnalyses.length} chunk analyses into final document...`);

  const model = createModel();
  const template = loadPrompt(SYNTHESIS_PROMPT_PATH);

  // Calculate date range from posts
  const dates = posts.map((p) => p.date).sort((a, b) => a - b);
  const dateFrom = new Date(dates[0] * 1000).toLocaleDateString("it-IT");
  const dateTo = new Date(dates[dates.length - 1] * 1000).toLocaleDateString("it-IT");
  const dateRange = `${dateFrom} – ${dateTo}`;

  const partialAnalyses = chunkAnalyses
    .map((a, i) => `--- Analisi Chunk ${i + 1}/${chunkAnalyses.length} ---\n${a}`)
    .join("\n\n");

  const prompt = template
    .replace("{partial_analyses}", partialAnalyses)
    .replace("{channel_id}", channelId)
    .replace("{post_count}", String(posts.length))
    .replace("{date_range}", dateRange);

  const response = await model.invoke([new HumanMessage(prompt)]);
  const finalAnalysis =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  console.log("  ✅ Synthesis complete\n");

  return { finalAnalysis };
}

import { HumanMessage } from "@langchain/core/messages";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowStateType, SamplePost } from "../state.js";
import { renderBetSlipImage, type BetSlip } from "../image-renderer.js";
import { loadPrompt } from "../../shared/llm-utils.js";
import { ChatOpenAI } from "@langchain/openai";

const ANALYSIS_PROMPT_PATH = path.resolve("prompts", "image-analysis.md");
const OPTIMIZER_PROMPT_PATH = path.resolve("prompts", "bet-optimizer.md");
const TEXT_PROMPT_PATH = path.resolve("prompts", "post-generator.md");

function imageToBase64DataUrl(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "jpeg" : ext;
  const data = fs.readFileSync(imagePath);
  return `data:image/${mime};base64,${data.toString("base64")}`;
}

/** Step 1: Use GPT-4o vision to analyze all betting slip images and extract bets */
async function analyzeImages(
  model: ChatOpenAI,
  posts: SamplePost[]
): Promise<string> {
  const template = loadPrompt(ANALYSIS_PROMPT_PATH);

  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: template }];

  for (let i = 0; i < posts.length; i++) {
    contentParts.push({
      type: "text",
      text: `\n--- Sample ${i + 1} (text) ---\n${posts[i].text}`,
    });
    for (const img of posts[i].images) {
      contentParts.push({
        type: "image_url",
        image_url: { url: imageToBase64DataUrl(img) },
      });
    }
  }

  const response = await model.invoke([new HumanMessage({ content: contentParts })]);
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

/** Step 2: LLM generates an optimized bet slip as structured JSON */
async function optimizeBets(
  model: ChatOpenAI,
  analysis: string
): Promise<BetSlip> {
  const template = loadPrompt(OPTIMIZER_PROMPT_PATH);
  const prompt = template.replace("{analysis}", analysis);

  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const slip = JSON.parse(cleaned) as BetSlip;

  // Force totalOdd to be the actual product of individual odds (LLM often hallucinates this)
  slip.totalOdd = parseFloat(
    slip.bets.reduce((acc, b) => acc * b.odd, 1).toFixed(2)
  );

  // Cap totalOdd at 35 by removing the highest-odd bet until under the limit
  while (slip.totalOdd > 35 && slip.bets.length > 1) {
    let maxIdx = 0;
    for (let i = 1; i < slip.bets.length; i++) {
      if (slip.bets[i].odd > slip.bets[maxIdx].odd) maxIdx = i;
    }
    const removed = slip.bets.splice(maxIdx, 1)[0];
    console.log(`  ⚠️  Quota ${slip.totalOdd} > 35 — rimossa: ${removed.homeTeam} vs ${removed.awayTeam} (${removed.odd})`);
    slip.totalOdd = parseFloat(
      slip.bets.reduce((acc, b) => acc * b.odd, 1).toFixed(2)
    );
  }

  return slip;
}

/** Step 3: Generate caption text based on analysis + sample texts */
function formatBetSlipForPrompt(slip: BetSlip): string {
  const lines = [`Schedina: ${slip.title}`, ""];
  slip.bets.forEach((bet, i) => {
    lines.push(`${i + 1}. ${bet.homeTeam} vs ${bet.awayTeam} → ${bet.betType} @ ${bet.odd.toFixed(2)}`);
  });
  lines.push("", `Quota totale: ${slip.totalOdd.toFixed(2)}`);
  return lines.join("\n");
}

async function generateText(
  model: ChatOpenAI,
  topic: string,
  betSlip: BetSlip,
  sampleTexts: string[]
): Promise<string> {
  const template = loadPrompt(TEXT_PROMPT_PATH);
  const formattedSamples = sampleTexts
    .map((t, i) => `--- Testo ${i + 1} ---\n${t}`)
    .join("\n\n");

  const prompt = template
    .replace("{topic}", topic)
    .replace("{bet_slip}", formatBetSlipForPrompt(betSlip))
    .replace("{sample_texts}", formattedSamples);

  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw = typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);

  // Strip any "--- Testo ---" / "-- Testo del post --" header the LLM may prepend
  return raw.replace(/^-{2,}\s*testo[^\n]*-{2,}\s*\n+/i, "").trimStart();
}

export async function llmGeneratorNode(
  state: WorkflowStateType
): Promise<Partial<WorkflowStateType>> {
  const { inputPosts, topic } = state;

  if (inputPosts.length === 0) {
    throw new Error("No input posts provided to LLM generator node");
  }

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.7,
  });

  // Step 1: Analyze images to extract bets
  console.log("🔍 Analyzing betting slip images...");
  const analysis = await analyzeImages(model, inputPosts);
  console.log("✅ Image analysis complete\n");
  console.log("--- Analysis ---\n" + analysis + "\n--- End Analysis ---\n");

  // Step 2: Optimize bets into a new slip (JSON)
  console.log("🧠 Optimizing bets...");
  const betSlip = await optimizeBets(model, analysis);
  console.log(`✅ Optimized slip: ${betSlip.title} (${betSlip.bets.length} events, Q.${betSlip.totalOdd})\n`);

  // Step 3: Render bet slip image with Puppeteer
  console.log("🎨 Rendering betting slip image...");
  const imageBuffer = await renderBetSlipImage(betSlip);
  const imageBase64 = imageBuffer.toString("base64");
  console.log("✅ Image rendered\n");

  // Step 4: Generate caption text based on the optimized slip
  console.log("✍️  Generating post text...");
  const sampleTexts = inputPosts.map((p) => p.text);
  const generatedText = await generateText(model, topic, betSlip, sampleTexts);
  console.log("✅ Text generated\n");

  return {
    generatedPost: {
      imageBase64,
      text: generatedText,
    },
  };
}

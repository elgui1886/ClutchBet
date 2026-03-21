import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowStateType } from "../state.js";

const PROMPT_TEMPLATE_PATH = path.resolve("prompts", "post-generator.md");

function loadPromptTemplate(): string {
  return fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
}

function buildPrompt(topic: string, posts: string[]): string {
  const template = loadPromptTemplate();
  const formattedPosts = posts
    .map((post, i) => `--- Post ${i + 1} ---\n${post}`)
    .join("\n\n");

  return template
    .replace("{topic}", topic)
    .replace("{posts}", formattedPosts);
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
    temperature: 0.8,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
    },
  });

  const prompt = buildPrompt(topic, inputPosts);
  const response = await model.invoke([new HumanMessage(prompt)]);

  const generatedPost =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  console.log("\n✅ Post generated successfully\n");

  return { generatedPost };
}

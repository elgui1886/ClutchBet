import { ChatOpenAI } from "@langchain/openai";

export function createModel(options?: { temperature?: number }): ChatOpenAI {
  return new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: options?.temperature ?? 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });
}

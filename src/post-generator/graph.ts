import { StateGraph } from "@langchain/langgraph";
import { WorkflowState } from "./state.js";
import { scraperNode } from "./nodes/scraper.js";
import { llmGeneratorNode } from "./nodes/llm-generator.js";

export function buildGraph() {
  const graph = new StateGraph(WorkflowState)
    .addNode("scraper", scraperNode)
    .addNode("llm_generator", llmGeneratorNode)
    .addEdge("__start__", "scraper")
    .addConditionalEdges("scraper", (state) =>
      state.inputPosts.length === 0 ? "__end__" : "llm_generator"
    )
    .addEdge("llm_generator", "__end__");

  return graph.compile();
}

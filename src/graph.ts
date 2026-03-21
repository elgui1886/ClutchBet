import { StateGraph } from "@langchain/langgraph";
import { WorkflowState } from "./state.js";
import { llmGeneratorNode } from "./nodes/llm-generator.js";

export function buildGraph() {
  const graph = new StateGraph(WorkflowState)
    .addNode("llm_generator", llmGeneratorNode)
    .addEdge("__start__", "llm_generator")
    .addEdge("llm_generator", "__end__");

  return graph.compile();
}

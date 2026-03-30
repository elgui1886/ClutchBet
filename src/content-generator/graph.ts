import { StateGraph } from "@langchain/langgraph";
import { ContentState } from "./state.js";
import { schedulerNode } from "./nodes/scheduler.js";
import { dataFetcherNode } from "./nodes/data-fetcher.js";
import { contentWriterNode } from "./nodes/content-writer.js";
import { reviewerNode } from "./nodes/reviewer.js";
import { publisherNode } from "./nodes/publisher.js";

export function buildContentGraph() {
  const graph = new StateGraph(ContentState)
    .addNode("scheduler", schedulerNode)
    .addNode("data_fetcher", dataFetcherNode)
    .addNode("content_writer", contentWriterNode)
    .addNode("reviewer", reviewerNode)
    .addNode("publisher", publisherNode)
    .addEdge("__start__", "scheduler")
    .addConditionalEdges("scheduler", (state) =>
      state.scheduledFormats.length === 0 ? "__end__" : "data_fetcher"
    )
    .addEdge("data_fetcher", "content_writer")
    .addEdge("content_writer", "reviewer")
    .addConditionalEdges("reviewer", (state) => {
      const hasApproved = state.contentItems.some((item) => item.approved);
      return hasApproved ? "publisher" : "__end__";
    })
    .addEdge("publisher", "__end__");

  return graph.compile();
}

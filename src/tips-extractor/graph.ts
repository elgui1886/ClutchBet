import { StateGraph } from "@langchain/langgraph";
import { TipsExtractorState } from "./state.js";
import { historyScraperNode } from "./nodes/history-scraper.js";
import { postAnalyzerNode } from "./nodes/post-analyzer.js";
import { dbWriterNode } from "./nodes/db-writer.js";

export function buildTipsExtractorGraph() {
  const graph = new StateGraph(TipsExtractorState)
    .addNode("history_scraper", historyScraperNode)
    .addNode("post_analyzer", postAnalyzerNode)
    .addNode("db_writer", dbWriterNode)
    .addEdge("__start__", "history_scraper")
    .addConditionalEdges("history_scraper", (state) =>
      state.rawPosts.length === 0 ? "__end__" : "post_analyzer"
    )
    .addEdge("post_analyzer", "db_writer")
    .addEdge("db_writer", "__end__");

  return graph.compile();
}

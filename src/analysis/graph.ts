import { StateGraph } from "@langchain/langgraph";
import { AnalysisState } from "./state.js";
import { historyScraperNode } from "./nodes/history-scraper.js";
import { channelAnalyzerNode } from "./nodes/channel-analyzer.js";
import { reportWriterNode } from "./nodes/report-writer.js";

export function buildAnalysisGraph() {
  const graph = new StateGraph(AnalysisState)
    .addNode("history_scraper", historyScraperNode)
    .addNode("channel_analyzer", channelAnalyzerNode)
    .addNode("report_writer", reportWriterNode)
    .addEdge("__start__", "history_scraper")
    .addConditionalEdges("history_scraper", (state) =>
      state.rawPosts.length === 0 ? "__end__" : "channel_analyzer"
    )
    .addEdge("channel_analyzer", "report_writer")
    .addEdge("report_writer", "__end__");

  return graph.compile();
}

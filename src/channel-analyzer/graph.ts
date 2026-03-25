import { StateGraph } from "@langchain/langgraph";
import { AnalysisState } from "./state.js";
import { channelReaderNode } from "./nodes/channel-reader.js";
import { chunkSplitterNode } from "./nodes/chunk-splitter.js";
import { chunkAnalyzerNode } from "./nodes/chunk-analyzer.js";
import { analysisSynthesizerNode } from "./nodes/analysis-synthesizer.js";

export function buildAnalysisGraph() {
  const graph = new StateGraph(AnalysisState)
    .addNode("channel_reader", channelReaderNode)
    .addNode("chunk_splitter", chunkSplitterNode)
    .addNode("chunk_analyzer", chunkAnalyzerNode)
    .addNode("synthesizer", analysisSynthesizerNode)
    .addEdge("__start__", "channel_reader")
    .addEdge("channel_reader", "chunk_splitter")
    .addEdge("chunk_splitter", "chunk_analyzer")
    .addConditionalEdges("chunk_analyzer", (state) =>
      state.currentChunkIndex < state.chunks.length
        ? "chunk_analyzer"
        : "synthesizer"
    )
    .addEdge("synthesizer", "__end__");

  return graph.compile();
}

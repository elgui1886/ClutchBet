import type { AnalysisStateType } from "../state.js";
import type { ChannelPost } from "../state.js";

const CHUNK_SIZE = 20;

export async function chunkSplitterNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { posts } = state;

  const chunks: ChannelPost[][] = [];
  for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
    chunks.push(posts.slice(i, i + CHUNK_SIZE));
  }

  console.log(`🔀 Split ${posts.length} posts into ${chunks.length} chunk(s) of ~${CHUNK_SIZE}`);

  return {
    chunks,
    currentChunkIndex: 0,
    chunkAnalyses: [],
  };
}

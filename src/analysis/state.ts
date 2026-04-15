import { Annotation } from "@langchain/langgraph";
import type { RawPost } from "../shared/channel-scraper.js";

export type { RawPost };

export const AnalysisState = Annotation.Root({
  /** Channel identifier (any supported format) */
  channel:         Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  /** Human-readable channel title (fetched from Telegram) */
  channelTitle:    Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  /** How many months of history to fetch */
  timeRangeMonths: Annotation<number>({ reducer: (_prev, next) => next, default: () => 3 }),
  /** All posts scraped from the channel */
  rawPosts:        Annotation<RawPost[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** Post batches grouped as text chunks for LLM processing */
  chunks:          Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** Partial analysis summaries, one per chunk */
  chunkSummaries:  Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** Final analysis document (Markdown) */
  analysisDocument: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
});

export type AnalysisStateType = typeof AnalysisState.State;

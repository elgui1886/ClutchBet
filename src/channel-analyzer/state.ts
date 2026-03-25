import { Annotation } from "@langchain/langgraph";

/** A single post collected from a Telegram channel */
export interface ChannelPost {
  /** Telegram message ID */
  id: number;
  /** Unix timestamp of the message */
  date: number;
  /** Text content of the post */
  text: string;
  /** Absolute paths to downloaded images (empty if no photo) */
  imagePaths: string[];
  /** Type of media attached */
  mediaType: "photo" | "video" | "text" | "other";
}

export const AnalysisState = Annotation.Root({
  channelId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  timeRangeMonths: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 3,
  }),
  posts: Annotation<ChannelPost[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  chunks: Annotation<ChannelPost[][]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  chunkAnalyses: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentChunkIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  finalAnalysis: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

export type AnalysisStateType = typeof AnalysisState.State;

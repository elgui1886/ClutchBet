import { Annotation } from "@langchain/langgraph";
import type { RawPost } from "../shared/channel-scraper.js";

export type { RawPost };

export interface LLMSelection {
  sport: string | null;
  competition: string | null;
  event: string | null;
  timestamp: string | null;
  market: string | null;
  outcome: string | null;
  odds: number | null;
}

export interface AnalyzedPost {
  rawPost: RawPost;
  postType: "tips_new" | "tips_update" | "interaction";
  isTips: boolean;
  tipsFirstEventTimestamp: string | null;
  tipsEventCount: number | null;
  tipsTotalOdds: number | null;
  tipsTopic: string | null;
  selections: LLMSelection[];
}

export const TipsExtractorState = Annotation.Root({
  channel:      Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  channelTitle: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  postLimit:    Annotation<number>({ reducer: (_prev, next) => next, default: () => 100 }),
  rawPosts:        Annotation<RawPost[]>({ reducer: (_prev, next) => next, default: () => [] }),
  analyzedPosts:   Annotation<AnalyzedPost[]>({ reducer: (_prev, next) => next, default: () => [] }),
});

export type TipsExtractorStateType = typeof TipsExtractorState.State;

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

/** A single tip/giocata within a post (a post may contain multiple tips) */
export interface LLMTip {
  topic: string | null;
  total_odds: number | null;
  selections: LLMSelection[];
}

/** A single analyzed tip with its selections */
export interface AnalyzedTip {
  topic: string | null;
  totalOdds: number | null;
  selectionsCount: number;
  selections: LLMSelection[];
}

export interface AnalyzedPost {
  rawPost: RawPost;
  postType: "tips_new" | "tips_update" | "interaction";
  isTips: boolean;
  tipsFirstEventTimestamp: string | null;
  /** Number of distinct tips (giocate) in this post */
  tipsEventCount: number | null;
  tips: AnalyzedTip[];
}

export const TipsExtractorState = Annotation.Root({
  channel:      Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  channelTitle: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  postLimit:    Annotation<number>({ reducer: (_prev, next) => next, default: () => 100 }),
  rawPosts:        Annotation<RawPost[]>({ reducer: (_prev, next) => next, default: () => [] }),
  analyzedPosts:   Annotation<AnalyzedPost[]>({ reducer: (_prev, next) => next, default: () => [] }),
});

export type TipsExtractorStateType = typeof TipsExtractorState.State;

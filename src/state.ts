import { Annotation } from "@langchain/langgraph";

/**
 * Shared state flowing between nodes in the LangGraph workflow.
 *
 * - inputPosts: raw posts collected (from files or Telegram scraper)
 * - topic: the topic/theme to focus on
 * - generatedPost: the post produced by the LLM
 * - publishResult: outcome of the publishing step
 */
export const WorkflowState = Annotation.Root({
  inputPosts: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  topic: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  generatedPost: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  publishResult: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

export type WorkflowStateType = typeof WorkflowState.State;

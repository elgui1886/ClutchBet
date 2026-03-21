import { Annotation } from "@langchain/langgraph";

/** A single sample post: one or more images + accompanying text */
export interface SamplePost {
  /** Absolute paths to the image files (jpeg, png, etc.) */
  images: string[];
  /** The text content of the post */
  text: string;
}

/** Output of the LLM: generated image (base64) + caption text */
export interface GeneratedPost {
  /** Base64-encoded generated image (betting slip) */
  imageBase64: string;
  /** Generated caption/text for the post */
  text: string;
}

export const WorkflowState = Annotation.Root({
  inputPosts: Annotation<SamplePost[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  topic: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  generatedPost: Annotation<GeneratedPost | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  publishResult: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

export type WorkflowStateType = typeof WorkflowState.State;

export interface PromptOptions {
  /** The text of the prompt (template). */
  readonly prompt?: string;
  /** Paths to markdown files containing the prompt text (relative to the declaring file or absolute). */
  readonly promptUrls?: readonly string[];
}

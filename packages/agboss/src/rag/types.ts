import type { RagSearchResult } from "../dto/standard/framework.js";

/** What a knowledge base found for a query: its search results (each cited as `[source]`). */
export interface RagRetrieval {
  readonly results: readonly RagSearchResult[];
  /** What this retrieval cost (embeddings, a search API); 0 or absent when free. */
  readonly costUsd?: number;
}

export interface IndexReport {
  readonly documents: number;
  readonly chunks: number;
  /** Documents left as they were (unchanged since the last index). */
  readonly skipped: number;
  readonly costUsd?: number;
}

/**
 * The contract of a knowledge base. Implement it with any embeddings and storage; the core does the
 * wiring (tool or context), cost reporting and tracing.
 */
export interface RagConnector {
  retrieve(
    query: string,
    options: { readonly topK: number; readonly signal: AbortSignal },
  ): Promise<RagRetrieval>;
  /** Optional: build or update the index (`npm run rag:index`). */
  index?(): Promise<IndexReport>;
}

/** A knowledge base as the core runs it in context mode (retrieved before the agent's loop). */
export interface KnowledgeSource {
  readonly name: string;
  readonly topK: number;
  readonly retrieve: RagConnector["retrieve"];
}

/** How an agent gets the search results: it calls `search_<name>` itself, or they come before the task. */
export type RagMode = "tool" | "context";

import "../polyfills/symbol-metadata.js";

/** Knowledge bases (RAG): the connector contract and the reference implementation (Wiki → Knowledge bases). */
export { Rag } from "../components/decorators.js";
export type { IndexReport, KnowledgeSource, RagConnector, RagMode, RagRetrieval } from "./types.js";
export { SqliteFtsConnector, type FtsOptions } from "./sqlite-fts.js";

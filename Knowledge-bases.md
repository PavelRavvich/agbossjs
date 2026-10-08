# Knowledge bases (RAG)

The core fixes a **contract**, not a technology: a knowledge base is any class implementing
`RagConnector` — embeddings or full-text, local or an API, SQLite or a vector DB. The core wires it
to agents, reports its cost and traces it. Decision: [ADR-0010](ADR-0010-RAG-as-a-contract).

```ts
interface RagConnector {
  retrieve(
    query: string,
    options: { k: number; signal: AbortSignal },
  ): Promise<RagRetrieval>;
  index?(): Promise<IndexReport>; // optional: build / update the index
}
interface RagRetrieval {
  results: RagSearchResult[]; // RagSearchResult = { text, source, score? } (graphcompose/dto)
  costUsd?: number;
}
// `source` is what the replyWith cites as [source]
```

## A knowledge base

```ts
// rag/company-docs.rag.ts — `k` (search results per retrieval) is required; there is no default
@Rag({
  name: "company_docs",
  description: "Nimbus Labs docs: onboarding, product, team",
  k: 4,
  deps: [DOCS_INDEX],
})
export class CompanyDocs extends SqliteFtsConnector {}
```

Dependencies come through the constructor, like any [component](Components). Swap the
implementation in this one file — nothing else changes.

## Binding — `mode` is required

```ts
@Agent({ …, rag: [{ use: CompanyDocs, mode: "tool" }] })     // the agent calls search_company_docs(query)
@Agent({ …, rag: [{ use: CompanyDocs, mode: "context" }] })  // the core puts top-k before the task
```

| Mode      | What happens                                                                                   | On error                         |
| --------- | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| `tool`    | a read tool `search_<name>` returning `{ results }`; the agent decides when and what to search  | returned to the model (any tool) |
| `context` | before the agent's loop the core retrieves `k` results for the task, as `Knowledge (<name>):` | the turn goes on without them    |

Both modes ask the model to cite `[source]`. Omitting `k`, `mode` or `retrieve` is a compile error.

## Costs and traces

Retrieval is billed to `rag:<name>` — FinOps category **`retrieval`**; context retrieval is a named
span `rag:<name>` in Langfuse, tool mode is traced as a tool.

## Index

```bash
npm run rag:index      # [--kb company_docs]
# company_docs: 3 documents, 5 chunks, 0 unchanged · $0.000000
```

## The reference implementation — `SqliteFtsConnector`

SQLite FTS5 (built into Node's `node:sqlite`), ranked by BM25 — no dependencies, no cost. `index()`
splits Markdown at headings and paragraphs (≤ 800 characters) and skips files whose content hash did
not change; the index is built on first use when it is empty. It finds words, not meanings (no
synonyms): for semantic search write another connector (e.g. `sqlite-vec` + an embeddings model).

`npm run describe` shows each agent's bases: `rag: company_docs (tool, k 4)`.

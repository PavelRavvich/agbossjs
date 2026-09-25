# ADR-0010 — RAG as a contract, implementations by the developer

- **Status:** Accepted
- **Issue:** #88

## Context

Agents could only read whole files (MCP) or call APIs. Every project embeds and stores documents
differently, so a built-in embeddings model or vector store would be the wrong default.

## Decision

- The core defines `RagConnector` (`retrieve`, optional `index`); a `@Rag` class implements it
  (`k` required); agents bind it with a required `mode` — `tool` or `context`.
- The core does the wiring, cost reporting (category `retrieval`) and tracing; context retrieval
  fails open.
- The reference implementation is SQLite FTS5 (BM25): no dependencies, no cost, deterministic in tests.

## Consequences

- Semantic search is another connector under the same contract; swapping touches one file.
- The reference finds words, not synonyms.

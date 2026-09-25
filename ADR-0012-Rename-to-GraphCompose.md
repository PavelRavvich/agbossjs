# ADR-0012 — Rename to GraphCompose

- **Status:** Accepted (renames graphInject from ADR-0011)
- **Issue:** #101

## Decision
- The framework is **GraphCompose**: npm package `graphcompose`, command `graphcompose`, short `gc`;
  the repository `graphcompose` (GitHub redirects the old `langgraph-ts-template` links).
- Pre-release, so the rename is cheap now; ADRs keep the names they were written with.

## Consequences
- `gc` is also the oh-my-zsh git plugin's alias for `git commit`: in such shells a globally installed `gc`
  is shadowed — `npx gc` in a project always works.

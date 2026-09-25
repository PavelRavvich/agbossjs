# ADR-0009 — Angular-style components with constructor injection

- **Status:** Accepted (replaces config-based wiring: `agents.config.ts`, tool catalog, `defineBundle`)
- **Issue:** #87

## Context

Adding a tool, an agent or an MCP server touched several places (catalog, config entry, a type list);
the structure of a bundle was not visible from its files.

## Decision

- Components are annotated classes, one per file, in folders by kind: `@Tool`, `@Agent`,
  `@McpServer` / `@McpTool`, `@Injectable`; a `@Bundle` module lists agents and servers **by class
  reference** — no scanning, no string names, links checked by the compiler.
- Settings in decorators; behaviour through interfaces (`ToolHandler`); prompts in `*.prompt.md`
  next to the agent.
- Dependencies through the **constructor**, declared in `deps` and checked by the compiler against the
  constructor's parameters; the graph and creation order are resolved once at assembly. Chosen over
  `inject()` (hidden dependencies, injection context, harder tests) and a single context object.
- `@Bundle` assembles into the existing bundle config, so the core, profiles, `describe` and Studio
  are unchanged. One style everywhere: the previous way was removed.

## Consequences

- Tools and agents are classes; tests construct tools with `new` and fakes.
- Standard decorators give no parameter-type metadata, so `deps` repeats the constructor's types
  once — the compiler keeps them in sync.
- `Symbol.metadata` is not available at runtime on Node 26: metadata lives in the components'
  own registry.

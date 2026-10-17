# Changelog

Breaking changes and notable additions, newest first. The API reports
(`packages/agboss/api/*.api.md`) hold the exact public surface of each entry.

## Unreleased — the flow as paths (#272, #270, #269)

- **The flow is a list of paths** ([Workflow](Workflow), [ADR-0019](ADR-0019-Flow-as-paths-with-path-scope)):
  `start(S).returns(Dto).toRouter(R).chooseOne(route(A)…)`, `.toAgent` / `.toAction` / `.toFinish`,
  `.switch(caseOf(…))`, `.onError(E, <side path>)`; own paths `agent(X)…` / `router(R)…` /
  `action(A)…` for shared nodes. Removed: `from(…).next(…)`, `from(R).routes()`, `chain`, `node`,
  `catchError` / `compensateWith`, `nextParallel` / `join`, `batchParallel`, `joinQuorum`,
  `@QuorumRouter`, `parallel(…)` / `optional(…)` route targets, `Self`, nested `@Workflow` nodes,
  sagas and `compensate`, the `agboss/concurrency` entry. Parallel launches return in #273, child
  workflows in #263, code routers in #280.
- **Generated types**: `agboss check` writes `.agboss/types.d.ts` (git-ignored) — what types the
  paths, `InputOf<X>` / `OutputOf<X>` and `app.execute(Start, input)`. A generated project runs it on
  install (`npm run types`); `declare readonly input` on a start is no longer needed.
- **Typed data on paths** ([Path scope](Path-scope)): `@Agent` / `@Action` / `@Router` /
  `@WorkflowFinish` take `input` fields and `output` shapes; wrappers `listOf`, `oneOf`, `optional`,
  `variant`, `isVariant` (`agboss/dto`). Agents read an input message after static instructions and
  answer a structured `output` through answer tools; `{{item}}` and `{{input.…}}` in instructions are
  gone (`[prompt.input-in-instructions]`).
- **Names**: every component `name` ends with its kind (`main-router`, `scout-agent`,
  `chat-workflow-start`, `charge-action`, `job-scout-workflow`) and is unique in the application;
  DTO classes on paths end with `Dto` — the standard DTOs are renamed (`WorkflowStartText` →
  `WorkflowStartTextDto`, `Money` → `MoneyDto`, …, [Standard DTOs](Standard-DTOs)). LangGraph node ids
  are the names (no `<kind>.` prefix).
- `@WorkflowAction` → `@Action`, `execute(input)` with its fields from the path's scope
  (`ActionHandler<Self>`). Actions have no context until #280's `ExecutionContext` (#272 S16): `ctx.run`,
  `ctx.idempotencyKey` and `ctx.executionContext` are gone from actions (tools keep `ctx`); derive an
  idempotency key from the action's input.
- **Limits**: `@Workflow({ maxSteps })` replaces `limits.perRun.steps`; `maxVisits` on routers and
  agents (`VisitsLimitExceededError`, catchable with `.onError`); money stays in `settings()`.
- **Results**: `ExecutionStatus.Finished | Paused`; `result.finish` is `{ name }`; `{ record: true }`
  adds the execution record. The thread's history keeps finished executions as
  `start <name>: <input>` / `finish <name>: <output>`.
- **Enums instead of strings** (#269): `Reasoning.…` instead of `thinking` strings on components,
  `RagMode.Tool | Context`, `ModelKind`, `ProviderSort`, `ImageDetail`, `ExecutionStatus`.
- `defaults.router` is `{ model }` (no `kind`); a `@Router` takes `decidedBy: DecidedBy.Model` and a
  required `input`.
- job-scout: one path per turn, names with their kinds, profiles and golden sets under
  `job-scout-workflow/` ([Example](Example)).

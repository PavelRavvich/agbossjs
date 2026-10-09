# Testing — `graphcompose/testing`

Test a workflow without models and without the network, from its first day: the real container,
components and graph rules, with **everything external replaced automatically**. Vitest (≥ 3.2) is an
optional peer dependency.

```ts
// vitest.config.ts — one line registers the matchers
export default defineConfig({ test: { setupFiles: ["graphcompose/testing/setup"] } });
```

```ts
import { replyWith, callTool, routeTo, testWith } from "graphcompose/testing";
import { expect } from "vitest";

const test = testWith(JobScout);

test("saving waits for approval; after it the turn ends (#100)", async ({ app, mockLlm, mcpOf }) => {
  mockLlm(MainRouter).thenReturn(routeTo(Shortlist));
  mockLlm(Shortlist).thenReturn(callTool(SaveShortlist, { jobs: [job] }), replyWith("Saved 1 job."));
  mcpOf(ShortlistServer).thenReturn({
    read_text_file: () => Promise.reject(new Error("ENOENT")),
    write_file: () => Promise.resolve({ content: "ok" }),
  });

  const paused = await app.run(ChatWorkflowStart, { text: "save the first job" });
  const done = await app.resume(paused.thread, { approved: true, by: "dana" });

  expect(paused).toHavePausedAt(Shortlist);
  expect(done).toFinishWith(ChatWorkflowFinish, { text: "Saved 1 job." });
  expect(mockLlm(MainRouter).requests).toHaveLength(1);
});
```

Components are referenced **by class** everywhere; strings only for data.

## `testWith(Workflow, { real?, allowNetwork? })`

A Vitest `test` whose fixtures are:

| Fixture   | What it is                                                                                 |
| --------- | ------------------------------------------------------------------------------------------ |
| `app`     | the workflow's [App](App) (`run`, `resume`, `close`) — built on first use, so `mockOf` in the test body takes effect; plus `app.clock` and slices |
| `mockLlm` | the script of an agent or a router: `mockLlm(Scout).thenReturn(…)`                            |
| `mockOf`  | a typed mock injected instead of a component                                               |
| `mcpOf`   | the stub of an MCP server                                                                  |
| `recoverApp` | `await recoverApp()` closes the current app (its `onStop` hooks run, as on a real stop) and returns a new one over the same test state (checkpoints, ledger, clock, ids); the closed app fails every call with `test.app-closed` |

The workflow is assembled when the test starts: an assembly error fails the test before it runs.

### Everything external is replaced

- **Models** → scripted (the model gateway is replaced). An agent or router without a script is a
  blocked live call. Guards nobody scripted **pass**; conversation compaction nobody scripted writes a
  fixed summary.
- **MCP servers** → stubs: `mcpOf(Server).thenReturn({ <server tool>: handler })`; `.calls` lists what
  the server got. A server tool without a handler fails the test with the server's and the tool's
  name. `real: [Server]` connects that server for real (an integration test).
- **Network** → blocked: any `fetch` or `node:http(s)` request to a host not in `allowNetwork` fails
  before it leaves the process. `allowNetwork: ["localhost"]` covers every loopback address
  (`127.0.0.1`, `::1`).

A blocked call fails with **`test.live-call-blocked`** and a message naming the class, the server
tool or the host — even when the run swallowed it (a tool error the agent read): the call that ran
it (`app.run`, `app.resume`, a slice) throws it.

## Scripted models

```ts
mockLlm(Scout).thenReturn(callTool(GreenhouseJobs, { query: "TypeScript" }), replyWith("3 jobs found"));
mockLlm(MainRouter).thenReturn(routeTo(Scout), routeTo(ChatWorkflowFinish));
mockLlm(Writer).thenReturn(replyWith("first")).thenReturnAlways(replyWith("again"));
mockLlm(Reviewer).thenReturn(failWith(ModelFailure.Timeout));
```

| Turn                                              | Meaning                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `replyWith(text, { cost?, truncated? })`             | the agent's model answers; `cost: usd(0.002)` is priced as output tokens       |
| `callTool(Tool, args)`                            | the agent's model calls a tool — `args` typed by the tool's input DTO          |
| `routeTo(Target, { reason?, confidence?, cost? })` | the router chooses a route: a node class, a named node, or `Self`              |
| `failWith(ModelFailure.Timeout \| RateLimited \| ServerError \| NetworkError)` (the same enum as `graphcompose/models`) | the call fails: an agent fails the run at the agent, a router with `router.failed` |

- **By position, never by call order across components:** a component's n-th model call gets its
  n-th turn, counted over the whole test (every run and every app of it). LangGraph never repeats a
  checkpointed call, so a run resumed after `recoverApp()` continues the same script — "a paused run survives a restart".
- A script shorter than the run fails with `test.script-exhausted`
  (`script exhausted for Writer: 1 turn scripted, asked for #2`) — or end it with `.thenReturnAlways(turn)`.
- `routeTo(X)` for a node that is not among the router's routes fails with `test.not-a-route`; an
  agent scripted with `routeTo` or a router with `replyWith` fails with `test.wrong-script`.

### What a component sent its model

`mockLlm(X).requests` (every request, in order), `.onlyRequest` (fails unless exactly one),
`.lastRequest`, `.toolCalls`. An agent's request is `{ kind: "chat", system, input, messages }`
(`messages`: `{ role, text }` — tool results have role `tool`); a router's is
`{ kind: "decision", input, options, instructions }`.

## `mockOf(Class)`

A typed mock (`vi.fn()` per method), injected instead of the class; inside the test `mockOf(X)`
returns the same instance the app uses:

```ts
mockOf(OrderBook).statusOf.mockResolvedValue("order lost");
// … run …
expect(mockOf(OrderBook).statusOf.mock.calls).toEqual([["7"]]);
```

Call it before the first `app.run` (after it is a clear error). A class the workflow does not use
(not a provider, a tool or a knowledge base of it) is an error too. Mocks have no lifecycle hooks.

## Slices

One component of the real app on its own:

- `app.tool(X).invoke(input)` — the tool with its real (or mocked) dependencies → `ToolResult`;
- `app.router(X).routeTo(text)` → the node it chooses (`Self` for `self`);
- `app.agent(X).replyWith(task)` → its replyWith (its model, prompt and tools; no flow, no approval pause).

## Matchers

| Matcher                                          | On                       | Passes when                                          |
| ------------------------------------------------ | ------------------------ | ---------------------------------------------------- |
| `toHaveTraversed([Start, Router, Agent, …])`        | a run result             | the visited nodes are exactly these, in order        |
| `toFinishWith(Finish, data?)`                    | a run result             | it finished there (with that output)                 |
| `toHavePausedAt(Agent)`                          | a run result             | it waits for a human in that agent                   |
| `toFailWith({ code?, node? })`                   | an error (`.rejects`)    | a code along its causes (`router.failed`, `limits.perDay.cost`, `graph.dead-end`, `test.…`) and the node it names |
| `toHaveCalledTools([Tool, …])`                   | `mockLlm(Agent)`         | its model called exactly these tools, in order       |
| `toHaveReceivedRequest({ input?, system?, … })`    | `mockLlm(X)`             | some request has these parts (strings as substrings) |

Failure messages name the classes: `expected the path ChatStart → MainRouter → Support, it was …`.

## Lifecycle and isolation

- Real components get `onStart` when the app is built and `onStop` after the test — also when the
  test failed ([App → Lifecycle hooks](App#lifecycle-hooks)).
- Per test: its own checkpoints, spend ledger, Terns and paused runs (in memory), deterministic ids
  (`thread-1`, `run-1`, …) and a clock fixed at the start. Two tests — even in parallel, with the same
  thread id — never see each other.
- `app.clock.advance("25h")` moves the time (units `ms`, `s`, `m`, `h`, `d`): the per-day limit
  (`limits.perDay.cost`) starts a new UTC day.

## Three kinds of tests

`gc create` sets up three Vitest projects by file name — empty ones pass:

| Project       | Files                     | Models                                   |
| ------------- | ------------------------- | ---------------------------------------- |
| `unit`        | `*.test.ts`               | none — scripts and fakes                 |
| `integration` | `*.integration.test.ts`   | recorded answers (#124), real MCP servers |
| `suites`      | `*.suite.test.ts`         | real models, budget-capped, scheduled    |

`npm test` runs unit + integration, `npm run test:suites` the suites. A new project's workflow test
(`src/<workflow>/<workflow>.workflow.test.ts`) scripts the main router and the first agent.

## Compile-time tests

Type mistakes are tested too: a `*.test.ts` line marked `// @ts-expect-error — <reason>` must stay a
compile error — `tsc` (in `make check`) fails when such a line compiles. One file per decorator family:

```ts
// @ts-expect-error — orderId is a string in the tool's input DTO
callTool(OrderStatus, { orderId: 42 });
```

What decorator mistakes look like in the compiler's output:

| Code   | Message (shortened)                                               | Typical cause                                              |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| TS1238 | Unable to resolve signature of class decorator …                  | `@Tool({ deps })` does not fit the constructor (order, type, count) |
| TS1240 | Unable to resolve signature of property decorator …               | a DTO field decorator on a field of another type (`@Text()` on a number) |
| TS1270 | Decorator function return type '…' is not assignable to type '…' | the class does not implement what its decorator requires (`ToolHandler`, `WorkflowDefinition`) |

Examples in the framework: `tests/components/compile-time.test.ts`, `tests/dto/types.test.ts`,
`tests/testing/types.test.ts`.

## Lower level

Unit tests of a single class stay plain: `toolOf(new Tool(fakes))`, `mcpServerStub(Server, handlers)`,
fakes from `@langchain/core/utils/testing`.


## Dynamic Mocking with `.thenAnswer()`

For complex scenarios, use `.thenAnswer()` instead of static `.thenReturn()` to evaluate incoming requests on the fly and return dynamic responses using strict TypeScript classes:

```ts
import { mockLlm, callTool, replyWith, routeTo } from "graphcompose/testing";
import { SupportAgent } from "./support.agent";
import { MainRouter } from "./main.router";
import { MyTool } from "./my-tool";

// Dynamic LLM mocking for agents
mockLlm(SupportAgent).thenAnswer((req) => {
  if (req.input.includes("issue")) {
    return callTool(MyTool, { action: "fix" });
  }
  return replyWith("All good!");
});

// Dynamic LLM mocking for routers
mockLlm(MainRouter).thenAnswer((req) => {
  return routeTo(SupportAgent);
});
```

### Dependency Injection Mocking

For tool and provider dependencies, use SpringBoot-like DI mocking:

```ts
import { mockOf } from "graphcompose/testing";
import { MyTool } from "./my-tool";

mockOf(MyTool).execute.mockResolvedValue({ success: true });
```

### Matchers
Assert on component behaviors using custom test matchers:
```ts
// Asserting a tool was called by an agent
expect(mockLlm(SupportAgent)).toHaveCalledTools([MyTool]);
```

## Blind Spots (Limitations)

When testing with `graphcompose`, be aware of the following framework limitations:
1. **Subgraphs are executed fully**: You cannot easily mock out an entire subgraph; testing treats them as fully executable units.
2. **Dependencies built outside DI**: If your code relies on functions like raw `fetch` outside of the DI container, they will throw network errors (due to blocked live calls) and cannot be mocked via `mockOf`. Always wrap side-effects in injectable classes.
3. **Static graph topology isn't tested natively**: This is black-box testing. The static structure of your graph isn't natively verified aside from its dynamic runtime execution path.


## VCR / Snapshots

The testing toolkit supports recording and replaying model interactions using VCR-style testing.

To enable VCR mode in your tests, pass a `vcr` configuration to `testWith`:

```typescript
import { testWith } from "graphcompose/testing";
import { VCRMode } from "graphcompose/testing/vcr";

it("should negotiate a job brief", async () => {
  const { app } = await testWith(JobScoutWorkflow, {
    vcr: {
      cassetteName: "negotiate-job-brief",
      mode: process.env.CI ? VCRMode.REPLAY : VCRMode.AUTO
    }
  });

  // the models will be recorded to __snapshots__/negotiate-job-brief.cassette.json
  const state = await app.execute({ task: "Find me a job in AI" });
});
```

`VCRMode.AUTO` will record new cassettes if they don't exist and replay them if they do.
`VCRMode.RECORD` will always make network requests and record.
`VCRMode.REPLAY` requires the cassette to exist and throws an error on mismatch or missing cassette.

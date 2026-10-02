# CLI — `graphcompose` / `gc`

`gc help` lists every command; `gc help <command>` shows its options.

## Create and generate (Angular-like)

```bash
npx gc create support-desk          # alias: gc c — asks for the structure, writes the project, runs npm install
cd support-desk && cp .env.example .env && npm run chat
```

The questionnaire asks only for the structure: the agents (name + role), each agent's tools, an MCP
server (none / filesystem / own command), a knowledge base (none / notes in a folder). Models (Kimi),
the Jev main router, the 8 192-token ceiling, limits and guards get defaults written into the code. Every
answer has a flag, for scripts and CI:

```bash
gc c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" \
  --tools "answerer:search_orders" --mcp filesystem:/path/to/docs --rag notes --skip-install
```

The skeleton runs at once: tools return a marked placeholder (`TODO`), prompts are drafted from the roles,
every tool has a test (`toolOf(new XTool())`) and the workflow has one on `testWith`
(`src/<workflow>/<workflow>.workflow.test.ts`: the main router and the first agent by script — it runs
offline, [Testing](Testing)). Files follow the [conventions](Components#file-conventions): `*.agent.ts` + `*.prompt.md`, `*.tool.ts` + `*.tool.test.ts`, `*.server.ts` + `*.mcp.ts`, `*.rag.ts`, and the flow's `workflow-starts/text.workflow-start.ts` (`TextWorkflowStart`), `routers/main.router.ts`, `workflow-finishes/text.workflow-finish.ts` (`TextWorkflowFinish`), both named `text`; a text-only MCP server tool replies with `PlainText`. The workflow is a star — `from(TextWorkflowStart).to(MainRouter)`, `from(MainRouter).choose(…agents, TextWorkflowFinish)`, `from(…agents).to(MainRouter)` — with limits in `settings()` ([Workflow](Workflow)). `npm run check` = types + `npm test`. `vitest.config.ts` has three projects by file name — `unit`
(`*.test.ts`), `integration` (`*.integration.test.ts`), `suites` (`*.suite.test.ts`, real models); empty
ones pass. `npm test` runs unit + integration, `npm run test:suites` the suites.

```bash
gc g agent billing   --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
gc g router escalation --workflow src/support-desk/support-desk.workflow.ts                # routers/escalation.router.ts
gc g tool refund     --workflow src/support-desk/support-desk.workflow.ts --agent billing
gc g mcp tickets     --workflow … --command tickets-mcp --tool search --agent billing   # or --dir <folder>
gc g rag policies    --workflow … --folder policies --agent billing
gc g workflow onboarding                                        # a second workflow + npm scripts chat:onboarding, …
```

Each part is **wired** (the TypeScript Compiler API edits the `@Agent` / `@Workflow` / `@Router` arrays,
the flow and imports): a new agent joins the star — a `route(BillingAgent, "Handles invoices")` in
`routers/main.router.ts`, and `BillingAgent` in both `choose(…)` and `from(…).to(MainRouter)`. A new
router gets the answer route only and is **not** put into the flow — where it sits is your choice.
Nothing existing is overwritten — a clash or an unexpected file shape is an error, and nothing is written.

## Run, inspect, evaluate

| Command                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `gc chat --workflow <path>`       | interactive chat (`--thread`, `--profile`), on [`app`](App)                  |
| `gc run --workflow <path> "task"` | one task, the answer to stdout, on [`app`](App)                              |
| `gc describe --workflow <path>`   | agents, tools, dependencies, knowledge bases, settings, config hash — no key |
| `gc check --models --workflow <path>` | every model setting against what its model supports — all problems at once, exit 1 on any; no key ([Model providers](Model-providers#fail-fast-settings-must-fit-their-models)) |
| `gc eval` / `gc replay`           | score recent runs with Jev / re-run a prompt version                         |
| `gc golden add --name <n>`        | recent real tasks as a golden set                                            |
| `gc compare --profiles base,<p>`  | profiles side by side ([Profiles and comparisons](Profiles-and-comparisons)) |
| `gc rag:index`                    | build / update knowledge-base indexes ([Knowledge bases](Knowledge-bases))   |

`gc chat` and `gc run` build the workflow with `createApp` (the profile applied), send the text to its
text start (`app.textStart`), ask in the terminal when a run pauses for approval and continue it with
`app.resume(thread, decision)`, and close the app (components' `onStop`, MCP servers) at the end.

Note: `gc` is also the oh-my-zsh git plugin's alias for `git commit` — `npx gc` in a project always works.

## "Star us on GitHub" line

An interactive call ends with one line on **stderr**, after the command's own output (also when the
command fails; the exit code is unchanged):

```
⭐ Like GraphCompose? Star us on GitHub: https://github.com/PavelRavvich/graphcompose
```

It is never written to stdout, and it is hidden when stderr is not a terminal (pipes, scripts), `CI`
is set, `--json` or `--quiet` is passed, or `GRAPHCOMPOSE_NO_STAR=1`. `gc help` lists the variable.

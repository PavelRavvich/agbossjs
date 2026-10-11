# CLI — `agboss` / `agboss`

`agboss help` lists every command; `agboss help <command>` shows its options.

## Create and generate (Angular-like)

```bash
npx agboss create support-desk          # alias: agboss c — asks for the structure, writes the project, runs npm install
cd support-desk && cp .env.example .env && npm run chat
```

The questionnaire asks only for the structure: the agents (name + role), each agent's tools, an MCP
server (none / filesystem / own command), a knowledge base (none / notes in a folder). Models (Kimi),
the Jev main router, the 8 192-token ceiling, limits and guards get defaults written into the code. Every
answer has a flag, for scripts and CI:

```bash
agboss c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" \
  --tools "answerer:search_orders" --mcp filesystem:/path/to/docs --rag notes --skip-install
```

The skeleton runs at once: tools return a marked placeholder (`TODO`), prompts are drafted from the roles,
every tool has a test (`toolOf(new XTool())`) and the workflow has one on `testWith`
(`src/<workflow>/<workflow>.workflow.test.ts`: the main router and the first agent by script — it runs
offline, [Testing](Testing)). Files follow the [conventions](Components#file-conventions): `*.agent.ts` + `*.prompt.md`, `*.tool.ts` + `*.tool.test.ts`, `*.server.ts` + `*.mcp.ts`, `*.rag.ts`, and the flow's `workflow-starts/text.workflow-start.ts` (`TextWorkflowStart`), `routers/main.router.ts`, `workflow-finishes/text.workflow-finish.ts` (`TextWorkflowFinish`), both named `text`; a text-only MCP server tool replies with `PlainText`. The workflow is a star — `from(TextWorkflowStart).next(MainRouter)`, `from(MainRouter).routes()` (the targets are the router's `routes`: every agent and `TextWorkflowFinish`), `from(…agents).next(MainRouter)` — with limits in `settings()` ([Workflow](Workflow)). The environments go to `environments/` (`environment.ts`, `dev` and `staging`). `npm run check` = types + `npm test`. `vitest.config.ts` has three projects by file name — `unit`
(`*.test.ts`), `integration` (`*.integration.test.ts`), `suites` (`*.suite.test.ts`, real models); empty
ones pass. `npm test` runs unit + integration, the `test:suites` script the suites.

```bash
agboss g agent billing   --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
agboss g router escalation --workflow src/support-desk/support-desk.workflow.ts                # routers/escalation.router.ts
agboss g tool refund     --workflow src/support-desk/support-desk.workflow.ts --agent billing
agboss g mcp tickets     --workflow … --command tickets-mcp --tool search --agent billing   # or --dir <folder>
agboss g rag policies    --workflow … --folder policies --agent billing
agboss g workflow onboarding                                        # a second workflow + npm scripts chat:onboarding, …
```

Each part is **wired** (the TypeScript Compiler API edits the `@Agent` / `@Workflow` / `@Router` arrays,
the flow and imports): a new agent joins the star — a route `{ prompt: "Handles invoices", target: BillingAgent }` in
`routers/main.router.ts`'s `routes`, and `BillingAgent` in `from(…).next(MainRouter)`. A new
router gets the answer route only and is **not** put into the flow — where it sits is your choice.
Nothing existing is overwritten — a clash or an unexpected file shape is an error, and nothing is
written; `--force` regenerates the files and keeps the existing wiring. `agboss g openapi <name> --url <spec>`
writes one tool per OpenAPI 3 operation (DTOs, a client in `services/`, tests), wired into `--agent`.

## Run, inspect, evaluate

| Command                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `agboss chat --workflow <path>`       | interactive chat (`--thread`, `--profile`, `--env`), on [`app`](App)         |
| `agboss run --workflow <path> "task"` | one task, the answer to stdout, on [`app`](App)                              |
| `agboss describe --workflow <path>`   | agents, tools, dependencies, knowledge bases, settings, config hash — no key |
| `agboss check --models --workflow <path>` | every model setting against what its model supports — all problems at once, exit 1 on any; no key ([Model providers](Model-providers#fail-fast-settings-must-fit-their-models)) |
| `agboss eval` / `agboss replay`           | score recent runs with Jev / re-run a prompt version                         |
| `agboss golden add --name <n>`        | recent real tasks as a golden set                                            |
| `agboss compare --profiles base,<p>`  | profiles side by side ([Profiles and comparisons](Profiles-and-comparisons)) |
| `agboss rag:index`                    | build / update knowledge-base indexes ([Knowledge bases](Knowledge-bases))   |

`agboss chat` and `agboss run` build the workflow with `createApp` (the profile applied), send the text to its
text start (`app.textStart`), ask in the terminal when a run pauses for approval and continue it with
`app.resume(thread, decision)`, and close the app (components' `onStop`, MCP servers) at the end.

`agboss migrate imports [<path>…]` rewrites imports of the deprecated entries to the current ones (the list:
`agboss help migrate`).

Note: `agboss` is also the oh-my-zsh git plugin's alias for `git commit` — `npx agboss` in a project always works.

## "Star us on GitHub" line

An interactive call ends with one line on **stderr**, after the command's own output (also when the
command fails; the exit code is unchanged):

```
⭐ Like AGBoss? Star us on GitHub: https://github.com/PavelRavvich/agboss
```

It is never written to stdout, and it is hidden when stderr is not a terminal (pipes, scripts), `CI`
is set, `--json` or `--quiet` is passed, or `AGBOSS_NO_STAR=1`. `agboss help` lists the variable.

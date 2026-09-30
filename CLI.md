# CLI — `graphcompose` / `gc`

`gc help` lists every command; `gc help <command>` shows its options.

## Create and generate (Angular-like)

```bash
npx gc create support-desk          # alias: gc c — asks for the structure, writes the project, runs npm install
cd support-desk && cp .env.example .env && npm run chat
```

The questionnaire asks only for the structure: the agents (name + role), each agent's tools, an MCP
server (none / filesystem / own command), a knowledge base (none / notes in a folder). Models (Kimi),
the Jev router, the 8 192-token ceiling, budget and guards get defaults written into the code. Every
answer has a flag, for scripts and CI:

```bash
gc c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" \
  --tools "answerer:search_orders" --mcp filesystem:/path/to/docs --rag notes --skip-install
```

The skeleton runs at once: tools return a marked placeholder (`TODO`), prompts are drafted from the roles,
every tool has a test (`toolOf(new XTool())`). Files follow the [conventions](Components#file-conventions): `*.agent.ts` + `*.prompt.md`, `*.tool.ts` + `*.tool.test.ts`, `*.server.ts` + `*.mcp.ts`, `*.rag.ts`. `npm run check` = types + tests.

```bash
gc g agent billing   --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
gc g tool refund     --workflow src/support-desk/support-desk.workflow.ts --agent billing
gc g mcp tickets     --workflow … --command tickets-mcp --tool search --agent billing   # or --dir <folder>
gc g rag policies    --workflow … --folder policies --agent billing
gc g workflow onboarding                                        # a second workflow + npm scripts chat:onboarding, …
```

Each part is **wired** (the TypeScript Compiler API edits the `@Agent` / `@Workflow` arrays and imports);
nothing existing is overwritten — a clash or an unexpected file shape is an error, and nothing is written.

## Run, inspect, evaluate

| Command                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `gc chat --workflow <path>`       | interactive chat (`--thread`, `--profile`)                                   |
| `gc run --workflow <path> "task"` | one task, the answer to stdout                                               |
| `gc describe --workflow <path>`   | agents, tools, dependencies, knowledge bases, settings — no API key          |
| `gc eval` / `gc replay`           | score recent runs with Jev / re-run a prompt version                         |
| `gc golden add --name <n>`        | recent real tasks as a golden set                                            |
| `gc compare --profiles base,<p>`  | profiles side by side ([Profiles and comparisons](Profiles-and-comparisons)) |
| `gc rag:index`                    | build / update knowledge-base indexes ([Knowledge bases](Knowledge-bases))   |

Note: `gc` is also the oh-my-zsh git plugin's alias for `git commit` — `npx gc` in a project always works.

## "Star us on GitHub" line

An interactive call ends with one line on **stderr**, after the command's own output (also when the
command fails; the exit code is unchanged):

```
⭐ Like GraphCompose? Star us on GitHub: https://github.com/PavelRavvich/graphcompose
```

It is never written to stdout, and it is hidden when stderr is not a terminal (pipes, scripts), `CI`
is set, `--json` or `--quiet` is passed, or `GRAPHCOMPOSE_NO_STAR=1`. `gc help` lists the variable.

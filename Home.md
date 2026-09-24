# langgraph-ts-template

Config-driven multi-agent LangGraph (TypeScript). This wiki is the **current-state reference**.

| Page                           | What it answers                                           |
| ------------------------------ | --------------------------------------------------------- |
| [Architecture](Architecture)   | Graph, modules, dependency rules                          |
| [Configuration](Configuration) | Every field of `agents.config.ts` and its defaults        |
| [Routers](Routers)             | Router contract, Jev vs LLM, testing routers in isolation |
| [FinOps](FinOps)               | Cost accounting, per-run and daily caps, reports          |
| [Decisions (ADR)](ADR)         | Why things are the way they are                           |

## Where things live

| Kind of knowledge                                       | Place                                    |
| ------------------------------------------------------- | ---------------------------------------- |
| Work items, discussion, **specs, implementation plans** | GitHub Issues of the repo                |
| How the system works **now**                            | this Wiki                                |
| Why a significant decision was made                     | Wiki pages `ADR-NNNN-…`                  |
| Rules for code, tests, FinOps · process                 | `QUALITY.md` · `WORKFLOW.md` in the repo |
| The truth                                               | the code                                 |

No specs, plans or docs as files in the repository.

# Example: job-scout

`examples/job-scout/` — the only example, a separate package that depends on `graphinject` exactly
like an outside project (only its public API; ESLint-enforced). Resume from disk → a proposed search
brief → Greenhouse jobs ranked by Jev, in a chat.

```bash
npm install && npm run build          # repo root
cd examples/job-scout
npm run chat                          # "my resume src/sample-resume.md" → brief → "ok" → ranked jobs
npm run describe                      # agents, tools, dependencies — no API key
```

## Flow

1. **profiler** reads the resume (`read_resume`: PDF, Markdown, text; a slightly mangled path is
   resolved in the same folder) and proposes a search brief from it — where, roles, deal-breakers,
   count, boards. Reply `ok` or say what to change.
2. **scout** calls `greenhouse_jobs` once per brief: public Greenhouse boards, hard filters (place,
   excluded / required title words), then Jev rates every remaining job against the brief
   (`JobFitJudge`, cheap, cached); the best come back with links, fit %, matched skills.

Two turns cost about $0.01–0.02.

## Components

```
src/job-scout.workflow.ts        @Workflow — settings, agents, providers (JobFitJudge, JOB_SEARCH)
src/agents/profiler.ts, scout.ts @Agent + profiler.prompt.md, scout.prompt.md ({{boards}}, {{knownPlaces}})
src/tools/read-resume.ts         @Tool
src/tools/greenhouse-jobs.ts     @Tool ← JobFitJudge (ROUTER_FACTORY), JOB_SEARCH
src/fit.ts                       @Injectable JobFitJudge — Jev per job
src/search.config.ts             boards and places (JOB_SEARCH); `npm run probe -- --place israel <token…>`
```

A shortlist saved over MCP with approval and company notes as a knowledge base come with #92.

## Profiles and comparisons

`profiles/job-scout/scout-low-thinking.yaml`, golden set `golden/job-scout/core.yaml`:

```bash
npm run compare -- --profiles base,scout-low-thinking --golden core
```

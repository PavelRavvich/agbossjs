# Example: job-scout

`examples/job-scout/` — the only example, a separate package that depends on `graphcompose` exactly
like an outside project (only its public API; ESLint-enforced). Resume from disk → a proposed search
brief → Greenhouse jobs ranked by Jev → explained with the user's company notes → the chosen ones saved to a
shortlist, after the user approves the write.

```bash
npm install && npm run build          # repo root
cd examples/job-scout
npm run chat                          # "my resume src/data/sample-resume.md" → brief → "ok" → ranked jobs
npm run describe                      # agents, tools, dependencies — no API key
```

## Flow

1. **profiler** reads the resume (`read_resume`: PDF, Markdown, text) and proposes a search brief — where,
   roles, deal-breakers, count, boards. Reply `ok` or say what to change.
2. **scout** calls `greenhouse_jobs` once per brief: public Greenhouse boards, hard filters, then Jev rates
   every remaining job (`JobFitJudge`); the replyWith is always a numbered list with links, then "why the top
   matches" from the user's **company notes** (`search_company_notes`, cited as `[file]`). Ask "why is
   Fireblocks a fit?" — the replyWith cites `[fireblocks.md]`.
3. **shortlist** saves the jobs the user names ("save 1 and 2") to `~/job-scout/shortlist.md` through the
   official filesystem MCP server — the write **waits for the user's approval** (`approve? [y/N]`); rejected →
   nothing written. "What is on my shortlist?" lists it.

A search turn costs about $0.02; the others well under a cent.

## Components — every kind, by file convention

```
src/job-scout.workflow.ts           @Workflow — settings, agents, MCP, providers, needsApproval
src/agents/*.agent.ts + *.prompt.md @Agent profiler | scout | shortlist (prompts found by convention)
src/tools/read-resume.tool.ts       @Tool ← ResumeReader
src/tools/greenhouse-jobs.tool.ts   @Tool ← JobFitJudge, JOB_SEARCH, GreenhouseBoards
src/mcp/shortlist.server.ts         @McpServer (filesystem, only ~/job-scout/; read_text_file, write_file)
src/mcp/save-shortlist.mcp.ts       @McpTool — adds the chosen jobs, skips links already there (waits for approval)
src/mcp/read-shortlist.mcp.ts       @McpTool — the shortlist as saved
src/services/                       greenhouse-boards (HTTP), resume-reader (files, PDF), job-fit (Jev) — @Injectable
src/rag/company-notes.rag.ts        @Rag company_notes (SQLite FTS5, k 3, tool mode) over notes/companies/
src/config/                         search.config.ts (boards, places), settings, paths, prompt variables
src/scripts/probe-boards.ts         `npm run probe -- --place israel <token…>`
src/data/sample-resume.md
```

`notes/companies/*.md` are **samples** (Fireblocks, JFrog, Similarweb, AppsFlyer, Taboola) — replace them
with what you know; `npm run rag:index` re-indexes. Every agent has an output ceiling, and the workflow
avoids the OpenRouter provider Inceptron for `kimi-k2.6` (it loops on tool-call arguments — #97).

## Profiles and comparisons

`profiles/job-scout/scout-low-thinking.yaml`, golden set `golden/job-scout/core.yaml`:

```bash
npm run compare -- --profiles base,scout-low-thinking --golden core
```

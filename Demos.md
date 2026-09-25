# Demos

Demos to try the whole core by hand — chat, one-shot CLI and LangGraph Studio. One folder each in
`src/demos/`; configs and Studio graphs are named after the demo.

| Config                       | What it shows                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `company-assistant`          | a new joiner's helper at a fictional company: Jev routes between `researcher` (company docs over **MCP**, time, **paid** exchange-rate tool), `notes` (read / **write** tools) and `coder` (**review** pass) |
| `company-assistant-approval` | the same with the **pause seam**: writing a note waits for your `y/N`                                                                                                                                        |
| `job-scout`                  | reads your **resume from disk**, interviews you, then searches **Greenhouse** job boards and ranks every job with **Jev inside a tool**                                                                      |

All of them: guards, threads and history, turn financials under every answer, Terns and eval.

## Chat

```bash
npm run chat -- --config company-assistant
npm run chat -- --config job-scout
```

| Key                               | Does                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `\` + Enter                       | continue the message on a new line (like Claude Code)    |
| Esc (or Ctrl+C) while a turn runs | interrupt it — the chat prints `interrupted` and goes on |
| `/new`                            | new conversation                                         |
| `/exit`, Ctrl+D                   | quit                                                     |

While a turn runs you see `⠋ thinking · esc to interrupt… 3.2s`.
Under each answer: route, stop reason, cost by category and the call-by-call trace.

## company-assistant

Docs of the fictional Nimbus Labs are in `src/demos/company-assistant/docs`; notes go to
`~/.langgraph-agents/company-assistant-notes.json`.

```
you › Who should I ask about the forecasting model?
agent › Marco Rossi — the data scientist.            (researcher, docs over MCP)
you › Save a note to ping him on Monday about it
agent › Saved: ping Marco Rossi on Monday about …    (notes; "him" comes from the thread)
you › How much does the Pro plan cost in shekels?    (docs + paid exchange-rate tool)
you › Write a TypeScript debounce function with tests  (coder; maybe coder → coder (pass 2))
```

With `company-assistant-approval` the chat asks `y/N` before a note is written.

## job-scout

```
you › my resume ~/Documents/CV/cv.pdf
agent › Profile: Senior Backend Engineer, 10 years, Java / Kotlin … Skills: …
        1. Where? (default: Israel)  2. Roles?  3. Deal-breakers?  4. How many? (20)  5. Companies?
you › ok, only Israel, no team-lead roles, I don't speak Hebrew, give me 20
agent › 1. Senior Software Engineer II, Core Engineering — Forter, Tel Aviv — fit — skills — link …
```

- `profiler` reads the resume (`.pdf`, `.md`, `.txt`), never repeats contact details, asks where,
  which roles, deal-breakers, how many, which companies — with defaults taken from the resume.
- `scout` calls `greenhouse_jobs` once per brief: 38 boards with live Israeli jobs (probed from
  ~140 Israeli tech and global companies), hard filters (location — a country matches its cities;
  `titleMustInclude` such as Senior; `excludeTitleWords` such as Lead, Manager), then **Jev rates
  every remaining job** against what you want. ~180 jobs take ~15 s and ~$0.008; boards and
  ratings are cached for the session. The scout itself runs without thinking — ranking is Jev's job.
- `fit%` is relative: Jev ranks well but its probabilities are compressed, so the order matters.
- A sample resume: `src/demos/job-scout/sample-resume.md`.

Greenhouse has no global search — every company has its own board.

### Point job-scout at another country

job-scout has no built-in country: boards and places live in
`src/demos/job-scout/search.config.ts` (validated). The shipped config is an example — Israeli tech
and global companies with Israeli R&D.

```ts
boards: { acme: "Acme", globex: "Globex" },          // Greenhouse token → company name
places: { germany: ["Germany", "Berlin", "Munich", "Hamburg"] },  // a place → words in job locations
```

Find which companies have live jobs there (bring candidate tokens — the part after
`boards.greenhouse.io/`):

```bash
npm run job-scout:probe -- --place germany acme globex initech
```

It prints jobs per board, how many are in the place, failures, and lines to paste into `boards`.
A place not in `places` is matched literally.

## Studio

```bash
npm run studio
```

Open <https://smith.langchain.com/studio/?baseUrl=http://localhost:2024> (free LangSmith login).
Graphs: `agents` (the project's own), `company-assistant`, `company-assistant-approval`,
`job-scout`. Send `{"task": "…"}` and watch the steps. Studio runs the graph only; spend ledger
and Terns are written by the CLI and chat.

## Remove them

Delete `src/demos/`, the demos import line in `src/bundles.ts` and the demo graphs in
`langgraph.json`; `npm uninstall @modelcontextprotocol/server-filesystem unpdf`.

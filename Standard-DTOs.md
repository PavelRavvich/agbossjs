# Standard DTOs

Ready-made DTOs in `graphcompose/dto` — use them instead of writing the same shape again. They are
plain classes like your own ([Components → DTOs](Components#dtos)); every field has a `prompt`.

```ts
import { Money, NoInput, PlainText } from "graphcompose/dto";
```

## Names: the hierarchy rule (#141)

- **A DTO that belongs to a component kind starts with that kind**: `WorkflowStart…`,
  `WorkflowFinish…`, `WorkflowPause…`, `ToolCallApproval…`, `Rag…`.
- **Paired concepts get paired names**: start / finish, question / replyWith, ask / decision.
- **Nothing "chat", "user", "human" or "person"** in framework names, prompts or comments: a workflow
  may be a CI pipeline, a pause or an approval may be answered by a system.

## For the framework's own parts

| DTO                        | Fields                                                     | Used for                                                          |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `WorkflowStartText`        | `text` (non-empty), `author?` (sensitive)                  | the text a run starts with — input of a text `@WorkflowStart`     |
| `WorkflowFinishText`       | `text`                                                     | the text a run finishes with — output of a text `@WorkflowFinish` |
| `WorkflowPauseQuestion`    | `question`, `options?` (≤ 6)                               | what a workflow pause asks outside the run — a person or a system |
| `WorkflowPauseAnswer`      | `replyWith`                                                   | the replyWith to that question                                       |
| `ToolCallApprovalAsk`      | `callId`, `tool`, `arguments` (any JSON object), `summary` | a tool call waiting for approval — one call per pause             |
| `ToolCallApprovalDecision` | `approved`, `by` (who or what decided), `reason?`          | the decision on that call — what `resumeAgent` takes ([Pause seam](Pause-seam)) |
| `NoInput`                  | —                                                          | the input of a tool that takes nothing (`{}`)                     |
| `PlainText`                | `text`                                                     | plain text, e.g. a text-only MCP server tool's result             |
| `RagSearchResult`          | `text`, `source`, `score?` (0…1)                           | a piece of text a knowledge base (`@Rag`) found for a query       |

`@WorkflowPause` (#117) will use `WorkflowPauseQuestion` / `WorkflowPauseAnswer`.

Renamed in #141 (old names removed, not aliased): `ChatMessage` → `WorkflowStartText`, `TextAnswer`
→ `WorkflowFinishText` (or `PlainText` for a server tool), `Question` → `WorkflowPauseQuestion`,
`Clarification` → `WorkflowPauseAnswer`, `ApprovalRequest` → `ToolCallApprovalAsk`,
`ApprovalDecision` → `ToolCallApprovalDecision`, `Passage` → `RagSearchResult`, `Citation` →
`RagSourceReference`.

## Common domain shapes

| DTO             | Fields                                                                         | Checked across fields                       |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| `Money`         | `amount` (`DecimalString`, 2 digits: `"19.99"`), `currency` (ISO 4217: `USD`) | —                                           |
| `DateRange`     | `from`, `to` (`Date`: `2026-09-01`), `timeZone?` (IANA)                        | `from` ≤ `to` — days, both ends included    |
| `DateTimeRange` | `from`, `to` (`DateTime` with an offset)                                       | `from` < `to` — moments, offsets respected  |
| `Attachment`    | `name`, `mediaType` (`application/pdf`), `url?`, `content?` (base64)           | exactly one of `url` and `content`          |
| `Address`       | `street`, `city`, `region?`, `postalCode?`, `country` (ISO 3166-1: `IL`)       | —                                           |
| `PersonName`    | `given`, `family?`                                                             | —                                           |
| `ContactInfo`   | `email?`, `phone?` (E.164: `+972521234567`)                                    | at least one of `email` and `phone`         |
| `RagSourceReference` | `title`, `url?`, `quote?` (≤ 300 characters) — where a statement in an replyWith comes from, in a knowledge base | — |

- Money is a **decimal string**, never a float: exact, and readable by people and the model; do
  arithmetic with a decimal library.
- A cross-field violation is the same validation error as any other, with the field and the reason
  (`to: the last day is before the first`).

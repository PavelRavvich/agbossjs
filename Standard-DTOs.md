# Standard DTOs

Ready-made DTOs in `graphcompose/dto` — use them instead of writing the same shape again. They are
plain classes like your own ([Components → DTOs](Components#dtos)); every field has a `prompt`.

```ts
import { Money, NoInput, TextAnswer } from "graphcompose/dto";
```

## For the framework's own parts

| DTO                | Fields                                                    | Used for                                                  |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `ChatMessage`      | `text` (non-empty), `author?` (sensitive)                 | what a user writes into a chat entry                      |
| `TextAnswer`       | `text`                                                    | a plain text answer; a server tool's text result          |
| `Question`         | `question`, `options?` (≤ 6)                              | what an interrupt asks a person                           |
| `Clarification`    | `answer`                                                  | a person's answer to a question                           |
| `ApprovalRequest`  | `callId`, `tool`, `arguments` (any JSON object), `summary` | a tool call waiting for approval — one call per pause     |
| `ApprovalDecision` | `approved`, `by`, `reason?`                               | the person's decision on that call                        |
| `NoInput`          | —                                                         | the input of a tool that takes nothing (`{}`)             |
| `Passage`          | `text`, `source`, `score` (0…1)                           | a piece of knowledge found for an agent                   |

`ApprovalRequest` / `ApprovalDecision` are defined; the pause flow moves to them with #117.

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
| `Citation`      | `title`, `url?`, `quote?` (≤ 300 characters)                                   | —                                           |

- Money is a **decimal string**, never a float: exact, and readable by people and the model; do
  arithmetic with a decimal library.
- A cross-field violation is the same validation error as any other, with the field and the reason
  (`to: the last day is before the first`).

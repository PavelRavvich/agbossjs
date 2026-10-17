# Path scope — what a node reads

Every path carries a **scope**: the values its steps returned so far (#270, [ADR-0019](ADR-0019-Flow-as-paths-with-path-scope)).
Components declare what they read by type (`input: { draft: OfferDraftDto }`) and what they give
(`output: OfferDraftDto`); the flow writes on each edge what was given (`.returns(OfferDraftDto)`).
The same definition is used by the analyser at assembly, by the generated types and by the runtime.

## Slots and writes

- A **slot per shape**: `OfferDraftDto` and `listOf(OfferDraftDto)` are separate slots. A slot holds
  its `latest` value and one value per **tag** (`.returns(OfferDraftDto, { as: "before" })`).
- Writes: a start's `.returns(…)` (its validated input), every `.returns(…)` after a step, and a
  `caseOf(…)` branch (the variant it matched). A write replaces the slot's `latest` (and its tag
  only, when tagged).
- In the checkpoint a slot is plain data — `{ slot, tag, producer: "<name>", variant?: "<DtoClass>",
  value }` — keyed by the DTO's class name, which is unique in the application
  (`[dto.duplicate-name]`); renaming a DTO class changes the workflow's config fingerprint.

## Reads

- A field `name: XDto` reads tag `name` if some path brings that tag, else `latest`;
  `listOf(XDto)` reads the latest list; `optional(XDto)` may be absent. Two fields of one shape must
  each resolve to their own tag (`[flow.ambiguous-field]`).
- Code (actions, finishes with `input`) gets each field as `Produced<T, P>` — `{ value, producer }`,
  `producer` the union of the classes the paths can bring; `isVariant(value, XDto)` narrows a
  `oneOf` value.
- An agent gets them in its **input message**, one block per field in declaration order:
  `### draft (from editor-agent)` and the value as JSON with sorted keys (`### after` and `none`
  for an absent `optional`). The instructions stay static — a field in the instructions as
  `{{input.…}}` fails assembly (`[prompt.input-in-instructions]`).

<!--
```ts file=tags.components.ts
import { Agent, WorkflowFinish, WorkflowStart } from "agboss";
import { Text, about, oneOf, optional } from "agboss/dto";

export class ShortlistDto {
  @Text({ prompt: "the shortlisted candidates" })
  candidates!: string;
}
export class OfferDraftDto {
  @Text({ prompt: "the offer text" })
  text!: string;
}
export class ChangesRequestedDto {
  @Text({ prompt: "what to change" })
  notes!: string;
}
export class DraftApprovedDto {
  @Text({ prompt: "a note for the record", optional: true })
  note?: string;
}
export class DraftChangesDto {
  @Text({ prompt: "what changed" })
  summary!: string;
}
@WorkflowStart({ name: "tagged-offer-workflow-start", description: "A shortlist", input: ShortlistDto })
export class TaggedOfferWorkflowStart {}
@Agent({ name: "first-draft-agent", description: "Drafts the offer", prompt: "Draft the offer.", model: "moonshotai/kimi-k2.6", input: { shortlist: ShortlistDto }, output: OfferDraftDto })
export class FirstDraftAgent {}
@Agent({ name: "draft-review-agent", description: "Reviews the latest draft", prompt: "Review the draft.", model: "moonshotai/kimi-k2.6", input: { draft: OfferDraftDto }, output: about(OfferDraftDto, oneOf(ChangesRequestedDto, DraftApprovedDto)) })
export class DraftReviewAgent {}
@Agent({ name: "draft-editor-agent", description: "Rewrites the draft", prompt: "Rewrite the draft.", model: "moonshotai/kimi-k2.6", input: { draft: OfferDraftDto, changes: ChangesRequestedDto }, output: OfferDraftDto, maxVisits: 2 })
export class DraftEditorAgent {}
@Agent({ name: "compare-agent", description: "Says what the editor changed", prompt: "Compare the drafts.", model: "moonshotai/kimi-k2.6", input: { before: OfferDraftDto, after: optional(OfferDraftDto) }, output: DraftChangesDto })
export class CompareAgent {}
@WorkflowFinish({ name: "draft-changes-workflow-finish", description: "What changed", output: DraftChangesDto })
export class DraftChangesWorkflowFinish {}
```
-->

## Tags: two values of one shape

<!-- snippet-context
import { Workflow, agent, caseOf, start } from "agboss";
import { ChangesRequestedDto, CompareAgent, DraftApprovedDto, DraftChangesDto, DraftChangesWorkflowFinish, DraftEditorAgent, DraftReviewAgent, FirstDraftAgent, OfferDraftDto, ShortlistDto, TaggedOfferWorkflowStart } from "./tags.components.js";
-->

```ts
@Workflow({
  name: "tagged-offer-workflow",
  version: "1.0.0",
  flow: [
    start(TaggedOfferWorkflowStart)
      .returns(ShortlistDto)
      .toAgent(FirstDraftAgent)
      .returns(OfferDraftDto, { as: "before" }) // the first draft, kept under its tag
      .toAgent(DraftReviewAgent), // reads `draft`: the latest OfferDraftDto

    agent(DraftReviewAgent)
      .switch(
        caseOf(ChangesRequestedDto)
          .toAgent(DraftEditorAgent)
          .returns(OfferDraftDto, { as: "after" })
          .toAgent(DraftReviewAgent),
        caseOf(DraftApprovedDto)
          .toAgent(CompareAgent) // input: { before: OfferDraftDto, after: optional(OfferDraftDto) }
          .returns(DraftChangesDto)
          .toFinish(DraftChangesWorkflowFinish),
      ),
  ],
})
export class TaggedOfferWorkflow {}
```

## Outdating: current values only

The latest value of a slot is not always a current one. Every value remembers what its step read
(`builtFrom`, #271): an agent's, action's or router's `input` fields — or, for an agent with `output`
and no `input`, every current value on the path before it. A **new value in a slot outdates
everything built from the slot's older value**, recursively: a job list found for the profile
before the user corrected it, the reviewer's notes about a draft that was rewritten since.

- A field reads only a **current** value and never falls back to an older one. Assembly proves it
  on every path, loops included: a field — required or `optional` — whose value is outdated on some
  path into its node fails with `[input.outdated-on-path]`, naming the path and the step that
  outdated it. `optional(XDto)` covers only paths where `XDto` was never produced; it is not a way
  for an outdated value to slip in.
- `[input.missing-on-path]` counts current values only: an outdated value is not "on the path".
- Outside cycles nothing is written: outdating by provenance works by itself.
- Scope is one execution: results of earlier executions on the thread are never carried over.
- Limits: data from the outside world is not tracked (a tool's price may be stale), and a list is
  outdated as a whole, never item by item.

### `about(TargetDto, shape)`: the direction of a cycle

In a cycle whose classes are built from each other — the writer reads the reviewer's notes, the
reviewer reads the writer's draft — the component that answers states what its answers are about:
first the class, then the shape (a class, `listOf(…)` or `oneOf(…)`). A new draft outdates the
answers about the older one; a new answer never outdates the draft. `about(…)` is a type statement
like `optional(…)`, allowed only in an agent's or an action's `output`; `OutputOf<X>` and the answer
tools are those of the shape.

<!--
```ts file=review.components.ts
import { Agent, WorkflowFinish, WorkflowStart } from "agboss";
import { Text, optional } from "agboss/dto";

export class ArticleRequestDto {
  @Text({ prompt: "what to write about" })
  topic!: string;
}
export class ResearchDto {
  @Text({ prompt: "what the research found" })
  facts!: string;
}
export class DraftDto {
  @Text({ prompt: "the draft" })
  text!: string;
}
export class ApprovalDto {
  @Text({ prompt: "why it is good to publish" })
  reason!: string;
}
export class ArticleChangesDto {
  @Text({ prompt: "what to change" })
  changes!: string;
}
export class ArticleDto {
  @Text({ prompt: "the article, ready to publish" })
  body!: string;
}
@WorkflowStart({ name: "article-workflow-start", description: "What to write about", input: ArticleRequestDto })
export class ArticleWorkflowStart {}
@Agent({ name: "researcher-agent", description: "Researches the subject", prompt: "Research it.", model: "moonshotai/kimi-k2.6", input: { request: ArticleRequestDto }, output: ResearchDto })
export class ResearcherAgent {}
@Agent({ name: "writer-agent", description: "Writes the article, or rewrites it from the notes", prompt: "Write it.", model: "moonshotai/kimi-k2.6", maxVisits: 4, input: { request: ArticleRequestDto, research: ResearchDto, changes: optional(ArticleChangesDto) }, output: DraftDto })
export class WriterAgent {}
@Agent({ name: "publisher-agent", description: "Prepares the approved draft", prompt: "Prepare it.", model: "moonshotai/kimi-k2.6", input: { draft: DraftDto, approval: ApprovalDto }, output: ArticleDto })
export class PublisherAgent {}
@WorkflowFinish({ name: "article-workflow-finish", description: "The article", output: ArticleDto })
export class ArticleWorkflowFinish {}
```
-->

<!-- snippet-context
import { Agent, Workflow, agent, caseOf, start } from "agboss";
import { about, oneOf } from "agboss/dto";
import { ApprovalDto, ArticleChangesDto, ArticleDto, ArticleRequestDto, ArticleWorkflowFinish, ArticleWorkflowStart, DraftDto, PublisherAgent, ResearchDto, ResearcherAgent, WriterAgent } from "./review.components.js";
-->

```ts
@Agent({
  name: "reviewer-agent",
  description: "Approves the draft or asks for changes",
  prompt: "Review the draft.",
  model: "moonshotai/kimi-k2.6",
  maxVisits: 4,
  input: { draft: DraftDto },
  output: about(DraftDto, oneOf(ApprovalDto, ArticleChangesDto)), // the answers are about this draft
})
export class ReviewerAgent {}

@Workflow({
  name: "article-workflow",
  version: "1.0.0",
  flow: [
    start(ArticleWorkflowStart)
      .returns(ArticleRequestDto)
      .toAgent(ResearcherAgent)
      .returns(ResearchDto)
      .toAgent(WriterAgent),

    agent(WriterAgent) // two ways in: the first draft, a rewrite
      .returns(DraftDto)
      .toAgent(ReviewerAgent)
      .switch(
        caseOf(ArticleChangesDto)
          .toAgent(WriterAgent),
        caseOf(ApprovalDto)
          .toAgent(PublisherAgent) // approval: current only while it is about the latest draft
          .returns(ArticleDto)
          .toFinish(ArticleWorkflowFinish),
      ),
  ],
})
export class ArticleWorkflow {}
```

| Step | What happened | Outdated, why |
| --- | --- | --- |
| 2 | writer-agent → Draft#1 | — |
| 3 | reviewer-agent → Changes#1 (about Draft#1) | — |
| 4 | writer-agent → Draft#2 (read Changes#1) | Draft#1: replaced; Changes#1: about Draft#1 |
| 5 | reviewer-agent → Approval#1 (about Draft#2) | — |
| 6 | publisher-agent reads Draft#2 and Approval#1 | — |

The same agents behind a hub router that may send to any of them at any time do not assemble —
an unapproved draft can never be published:

```text
[input.missing-on-path] writer-agent.research (ResearchDto) is not produced on the path article-workflow-start → editor-router → writer-agent
[input.outdated-on-path] publisher-agent.approval (ApprovalDto) is outdated on the path … → reviewer-agent → editor-router → writer-agent → editor-router → publisher-agent (about DraftDto, replaced by writer-agent)
```

- A cycle of classes built from each other with no `about` on any of their producers →
  `[io.ambiguous-cycle]`, the hint naming where to add it: `wrap reviewer-agent's output in
  about(DraftDto, …)`. The same holds for `about(DraftDto, CritiqueDto)` and
  `about(DraftDto, listOf(CritiqueDto))`.
- `about` names a class, never one of two tagged versions: a component reading two values of the
  class in its `about` (fields `before` and `after`) → `[io.ambiguous-about]`. Put both versions
  into one DTO built by a step — `DraftPairDto` with `@Nested(DraftDto) before` and
  `@Nested(DraftDto) after` — and write `about(DraftPairDto, …)`: a new draft outdates the pair
  through `builtFrom`, and the pair outdates the answers about it.

### At run time

The runtime keeps the two channels the analyser reasons about, in the execution's checkpoint:

- **`scope`** holds **current values only** — one `ScopeValueRecord` per slot: `valueId`, `slot`,
  `producer` (a component name), `variant` (for a `oneOf`), `value`, and `builtFrom` (the
  `valueId`s its step read). `valueId` is `${nodeId}:${visitNumber}/${slot}` — `writer-agent:2/DraftDto`,
  `writer-agent:1/DraftDto#before`, `chat-workflow-start:1/WorkflowStartTextDto` — the same in tests
  and after a resume.
- **`outdatedValues`** is append-only: when a write renews a slot, the slot's older value and every
  value built from it, transitively, move there **in the same step**, each as an
  `OutdatedValueRecord` with `outdated: { byValueId, reason }`. `byValueId` is always the **root
  trigger** — the new value that started the cascade, whatever path reached the record (the direct
  cause is the outdated entry of its own `builtFrom`); `reason` is `OutdatedReason.Replaced` (its
  slot got a new value), `AboutReplaced` (it is an answer about a value that was outdated) or
  `BuiltFromReplaced` (it was built from one).

`builtFrom` follows the same rules as the analysis: a step's `input` fields; every current value for
an agent with `output` and no `input`; the producer's own `about(…)` target, even when it does not
read it; never an answer about the class the step writes. After the write a value keeps only the
sources still current — one its own write outdated (the draft a rewrite read) leaves its
`builtFrom`, as in the analysis. The cascade starts from current values
only, tag slots are independent (an untagged rewrite does not outdate what was built from
`#before`), and `about` protects its target directly only — through a third class the target is
outdated like any other value.

Nothing that reads the scope can see an outdated value — input messages, handlers' `input`,
finishes and the thread's history (finished executions' start and finish only) read `scope`, and an
outdated value is not in it. The record keeps them: `app.execute(…, { record: true })` returns both
channels in `result.record` (`scope`, `outdatedValues`; [Testing](Testing#asserting-outdating)),
also after a pause and a resume. Every cascade is one `onValuesOutdated` event
([Observability](Observability#outdated-values)) and one trace entry, "values outdated", under the
step that wrote:

```text
DraftDto#1 outdated: replaced by DraftDto#2 from writer-agent
ArticleChangesDto#1 outdated: about DraftDto#1, replaced by DraftDto#2 from writer-agent
```

The labels `DraftDto#2` are ordinals within a slot. A second execution on a thread starts with its
start input only: its `scope` and `outdatedValues` begin empty.

## Rules

Checked at assembly, all at once (`GraphRuleError`), each message naming the shortest path that
breaks it:

| Code | |
| --- | --- |
| `[input.missing-on-path]` | a required field has no current value on some path into the node |
| `[input.outdated-on-path]` | a field (required or `optional`) whose value is outdated on some path into the node |
| `[io.ambiguous-cycle]` | classes built from each other in a cycle, with no `about(…)` on their producers |
| `[io.ambiguous-about]` | a component reading two values of the class its `about(…)` names |
| `[input.never-produced]` | an `optional` field no path brings |
| `[input.several-on-path]` | a single field where several values arrive |
| `[flow.unused-output]` | a value returned on a path that no node reads (a `caseOf` counts as a read) |
| `[flow.ambiguous-field]` | two fields of one shape that do not resolve to their own tags |
| `[flow.unused-tag]` | a tag no field reads |
| `[flow.returns-mismatch]` | `.returns(…)` that is not what the step gives |
| `[dto.name]`, `[dto.duplicate-name]` | a DTO class on a path that does not end with `Dto`; two DTO classes of one name |

The analyser works on the whole graph to a fixed point, path-sensitively: a node keeps every
reachable state of the scope — per slot absent, current or outdated, who wrote it and what it was
built from — so the correlation between fields survives a merge; `maxVisits` takes no part in the
proof (a graph wrong on any iteration is wrong). The generated
`InputOf<X>` is the exact union of those states projected onto the node's `input` (up to 32 shapes;
above it one flat object, and `agboss check` says so).

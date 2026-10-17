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
import { Text, oneOf, optional } from "agboss/dto";

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
@Agent({ name: "draft-review-agent", description: "Reviews the latest draft", prompt: "Review the draft.", model: "moonshotai/kimi-k2.6", input: { draft: OfferDraftDto }, output: oneOf(ChangesRequestedDto, DraftApprovedDto) })
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

    agent(DraftReviewAgent).switch(
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

## Rules

Checked at assembly, all at once (`GraphRuleError`), each message naming the shortest path that
breaks it:

| Code | |
| --- | --- |
| `[input.missing-on-path]` | a required field is not on every path into the node |
| `[input.never-produced]` | an `optional` field no path brings |
| `[input.several-on-path]` | a single field where several values arrive |
| `[flow.unused-output]` | a value returned on a path that no node reads (a `caseOf` counts as a read) |
| `[flow.ambiguous-field]` | two fields of one shape that do not resolve to their own tags |
| `[flow.unused-tag]` | a tag no field reads |
| `[flow.returns-mismatch]` | `.returns(…)` that is not what the step gives |
| `[dto.name]`, `[dto.duplicate-name]` | a DTO class on a path that does not end with `Dto`; two DTO classes of one name |

The analyser works on the whole graph to a fixed point, path-sensitively: a node keeps every
reachable state of the scope, so the correlation between fields survives a merge. The generated
`InputOf<X>` is the exact union of those states projected onto the node's `input` (up to 32 shapes;
above it one flat object, and `agboss check` says so).

import { Agent } from "../../../src/flow/decorators/agent.js";
import { Workflow } from "../../../src/flow/decorators/workflow.js";
import { WorkflowFinish } from "../../../src/flow/decorators/workflow-finish.js";
import { WorkflowStart } from "../../../src/flow/decorators/workflow-start.js";
import { about, oneOf, optional } from "../../../src/flow/dto-wrappers.js";
import { DraftChangesDto } from "./data-dtos.js";
import { ChangesRequestedDto, DraftApprovedDto, OfferDraftDto, ShortlistDto } from "./dtos.js";
import { agent, caseOf, start } from "./paths.js";

/** #270 — a tag inside a loop: the reviewer reads the latest draft, the comparison takes both. */

@WorkflowStart({
  name: "tagged-offer-workflow-start",
  description: "A shortlist to make an offer from",
  input: ShortlistDto,
})
export class TaggedOfferWorkflowStart {}

@Agent({
  name: "first-draft-agent",
  description: "Drafts the offer",
  prompt: "Draft the offer.",
  model: "moonshotai/kimi-k2.6",
  input: {
    shortlist: ShortlistDto,
  },
  output: OfferDraftDto,
})
export class FirstDraftAgent {}

@Agent({
  name: "draft-review-agent",
  description: "Reviews the latest draft",
  prompt: "Review the draft.",
  model: "moonshotai/kimi-k2.6",
  input: {
    draft: OfferDraftDto,
  },
  output: about(OfferDraftDto, oneOf(ChangesRequestedDto, DraftApprovedDto)), // the answers are about the draft (#271)
})
export class DraftReviewAgent {}

@Agent({
  name: "draft-editor-agent",
  description: "Rewrites the draft",
  prompt: "Rewrite the draft.",
  model: "moonshotai/kimi-k2.6",
  input: {
    draft: OfferDraftDto,
    changes: ChangesRequestedDto,
  },
  output: OfferDraftDto,
  maxVisits: 2,
})
export class DraftEditorAgent {}

@Agent({
  name: "compare-agent",
  description: "Says what the editor changed in the draft",
  prompt: "Compare the drafts.",
  model: "moonshotai/kimi-k2.6",
  input: {
    before: OfferDraftDto,
    after: optional(OfferDraftDto),
  },
  output: DraftChangesDto,
})
export class CompareAgent {}

@WorkflowFinish({
  name: "draft-changes-workflow-finish",
  description: "What changed",
  output: DraftChangesDto,
})
export class DraftChangesWorkflowFinish {}

export const taggedPaths = [
  start(TaggedOfferWorkflowStart)
    .returns(ShortlistDto)
    .toAgent(FirstDraftAgent)
    .returns(OfferDraftDto, { as: "before" })
    .toAgent(DraftReviewAgent),
  agent(DraftReviewAgent)
    .switch(
      caseOf(ChangesRequestedDto)
        .toAgent(DraftEditorAgent)
        .returns(OfferDraftDto, { as: "after" })
        .toAgent(DraftReviewAgent),
      caseOf(DraftApprovedDto)
        .toAgent(CompareAgent)
        .returns(DraftChangesDto)
        .toFinish(DraftChangesWorkflowFinish),
    ),
];

@Workflow({
  name: "tagged-offer-workflow",
  version: "1.0.0",
  flow: taggedPaths,
})
export class TaggedOfferWorkflow {}

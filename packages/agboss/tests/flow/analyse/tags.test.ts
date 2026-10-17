import { describe, expect, it } from "vitest";
import {
  analyseWorkflow,
  checkWorkflow,
  inputShapesOf,
} from "../../../src/flow/analyse/analyse.js";
import { Agent } from "../../../src/flow/decorators/agent.js";
import { Workflow } from "../../../src/flow/decorators/workflow.js";
import { DraftChangesDto } from "../fixtures/data-dtos.js";
import {
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
  ShortlistDto,
} from "../fixtures/dtos.js";
import { EditKitAgent } from "../fixtures/kit.fixture.js";
import { agent, caseOf, start } from "../fixtures/paths.js";
import {
  DraftChangesWorkflowFinish,
  DraftEditorAgent,
  DraftReviewAgent,
  FirstDraftAgent,
  TaggedOfferWorkflow,
  TaggedOfferWorkflowStart,
} from "../fixtures/tags.fixture.js";

/** Two values of one type told apart by tags (#270 AC5): a tag narrows, it does not separate. */

@Agent({
  name: "strict-compare-agent",
  description: "Needs both drafts on every path",
  prompt: "Compare the drafts.",
  model: "moonshotai/kimi-k2.6",
  input: {
    before: OfferDraftDto,
    after: OfferDraftDto,
  },
  output: DraftChangesDto,
})
class StrictCompareAgent {}

const straightLine = (beforeTag: string | undefined, compare: typeof StrictCompareAgent) =>
  start(TaggedOfferWorkflowStart)
    .returns(ShortlistDto)
    .toAgent(FirstDraftAgent)
    .returns(OfferDraftDto, ...(beforeTag === undefined ? [] : [{ as: beforeTag }]))
    .toAgent(EditKitAgent)
    .returns(OfferDraftDto, ...(beforeTag === undefined ? [] : [{ as: "after" }]))
    .toAgent(compare)
    .returns(DraftChangesDto)
    .toFinish(DraftChangesWorkflowFinish);

@Workflow({
  name: "tagged-line-workflow",
  version: "1.0.0",
  flow: [straightLine("before", StrictCompareAgent)],
})
class TaggedLineWorkflow {}

@Workflow({
  name: "untagged-line-workflow",
  version: "1.0.0",
  flow: [straightLine(undefined, StrictCompareAgent)],
})
class UntaggedLineWorkflow {}

@Workflow({
  name: "typo-tag-workflow",
  version: "1.0.0",
  flow: [straightLine("befor", StrictCompareAgent)],
})
class TypoTagWorkflow {}

@Workflow({
  name: "required-after-workflow",
  version: "1.0.0",
  flow: [
    start(TaggedOfferWorkflowStart)
      .returns(ShortlistDto)
      .toAgent(FirstDraftAgent)
      .returns(OfferDraftDto, { as: "before" })
      .toAgent(DraftReviewAgent),
    agent(DraftReviewAgent).switch(
      caseOf(ChangesRequestedDto)
        .toAgent(DraftEditorAgent)
        .returns(OfferDraftDto, { as: "after" })
        .toAgent(DraftReviewAgent),
      caseOf(DraftApprovedDto)
        .toAgent(StrictCompareAgent)
        .returns(DraftChangesDto)
        .toFinish(DraftChangesWorkflowFinish),
    ),
  ],
})
class RequiredAfterWorkflow {}

const present = (name: string, producer: string) => ({
  name,
  isPresent: true,
  producers: [producer],
});

describe("#270 AC5: tags", () => {
  it("two fields of one type are filled from tagged values", () => {
    expect(inputShapesOf(analyseWorkflow(TaggedLineWorkflow), "strict-compare-agent")).toEqual([
      [present("before", "first-draft-agent"), present("after", "edit-kit-agent")],
    ]);
  });

  it("without tags two fields of one type are ambiguous", () => {
    expect(checkWorkflow(UntaggedLineWorkflow).errors).toContainEqual(
      expect.objectContaining({
        code: "flow.ambiguous-field",
        message:
          'untagged-line-workflow: strict-compare-agent has two OfferDraftDto fields (before, after) — tag the values: .returns(OfferDraftDto, { as: "…" })',
      }),
    );
  });

  it("a tagged value also fills an untagged field of its shape, as latest", () => {
    expect(inputShapesOf(analyseWorkflow(TaggedOfferWorkflow), "draft-review-agent")).toEqual([
      [present("draft", "draft-editor-agent")],
      [present("draft", "first-draft-agent")],
    ]);
  });

  it("an overwrite replaces latest and its own tag only: before stays the first draft", () => {
    expect(inputShapesOf(analyseWorkflow(TaggedOfferWorkflow), "compare-agent")).toEqual([
      [present("before", "first-draft-agent"), { name: "after", isPresent: false, producers: [] }],
      [present("before", "first-draft-agent"), present("after", "draft-editor-agent")],
    ]);
  });

  it("a field named like a tag is required only if the tag is on every path into it", () => {
    expect(checkWorkflow(TaggedOfferWorkflow).errors).toEqual([]);
    expect(checkWorkflow(RequiredAfterWorkflow).errors).toEqual([
      expect.objectContaining({
        code: "input.missing-on-path",
        message:
          "required-after-workflow: strict-compare-agent.after (OfferDraftDto) is not produced on the path tagged-offer-workflow-start → first-draft-agent → draft-review-agent → strict-compare-agent",
      }),
    ]);
  });

  it("a tag no field reads fails", () => {
    expect(checkWorkflow(TypoTagWorkflow).errors).toContainEqual(
      expect.objectContaining({
        code: "flow.unused-tag",
        message:
          'typo-tag-workflow: tag "befor" on OfferDraftDto from first-draft-agent is never read by a field named "befor" — rename the tag or the field',
      }),
    );
  });
});

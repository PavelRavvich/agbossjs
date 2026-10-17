import { describe, expect, it } from "vitest";
import { checkWorkflow } from "../../../src/flow/analyse/analyse.js";
import { statesOf } from "../../../src/flow/analyse/dataflow.js";
import { slotOf, SlotStatus, type SlotKey } from "../../../src/flow/analyse/scope.js";
import { Action } from "../../../src/flow/decorators/action.js";
import { Agent } from "../../../src/flow/decorators/agent.js";
import { DecidedBy, Router } from "../../../src/flow/decorators/router.js";
import { Workflow } from "../../../src/flow/decorators/workflow.js";
import { WorkflowFinish } from "../../../src/flow/decorators/workflow-finish.js";
import {
  about,
  listOf,
  oneOf,
  optional,
  type DeclaredOutput,
} from "../../../src/flow/dto-wrappers.js";
import type { ComponentName } from "../../../src/flow/registry.js";
import { DraftChangesDto } from "../fixtures/data-dtos.js";
import { ArticleDto, ArticleRequestDto } from "../fixtures/dtos.js";
import { agent, caseOf, route, start } from "../fixtures/paths.js";
import {
  ApprovalDto,
  CritiqueDto,
  DraftDto,
  DraftPairDto,
  PlanDto,
} from "../fixtures/review-dtos.js";
import {
  PolishWorkflow,
  StoryWorkflow,
  StoryWorkflowFinish,
  StoryWorkflowStart,
} from "../fixtures/review.fixture.js";

/** #271 rule 5 (AC4): the direction of a cycle is written with `about(…)`; S14 (no tag in `about`). */

const errorsOf = (workflow: object, code: string): readonly string[] =>
  checkWorkflow(workflow as never)
    .errors.filter((found) => found.code === code)
    .map((found) => found.message);

const statusesAt = (workflow: object, at: string, of: string): ReadonlySet<SlotStatus> => {
  const { analysis } = checkWorkflow(workflow as never);
  const states = analysis === undefined ? [] : statesOf(analysis.dataflow, at as ComponentName);
  return new Set(states.map((state) => slotOf(state.scope, of as SlotKey).status));
};

// --- a two-class cycle: a writer and a reviewer, the reviewer's output given per test -------

@Agent({
  name: "loop-writer-agent",
  description: "Writes the draft, or rewrites it from the notes",
  prompt: "Write it.",
  model: "moonshotai/kimi-k2.6",
  maxVisits: 3,
  input: { request: ArticleRequestDto, changes: optional(DraftChangesDto) },
  output: DraftDto,
})
class LoopWriterAgent {}

@Agent({
  name: "loop-publisher-agent",
  description: "Publishes the approved draft",
  prompt: "Publish it.",
  model: "moonshotai/kimi-k2.6",
  input: { draft: DraftDto, approval: ApprovalDto },
  output: ArticleDto,
})
class LoopPublisherAgent {}

const reviewLoop = (name: string, output: DeclaredOutput): object => {
  @Agent({
    name: `${name}-reviewer-agent`,
    description: "Approves the draft or asks for changes",
    prompt: "Review it.",
    model: "moonshotai/kimi-k2.6",
    maxVisits: 3,
    input: { draft: DraftDto },
    output,
  })
  class ReviewerAgent {}
  @Workflow({
    name: `${name}-workflow`,
    version: "1.0.0",
    flow: [
      start(StoryWorkflowStart).returns(ArticleRequestDto).toAgent(LoopWriterAgent),
      agent(LoopWriterAgent)
        .returns(DraftDto)
        .toAgent(ReviewerAgent)
        .switch(
          caseOf(DraftChangesDto).toAgent(LoopWriterAgent),
          caseOf(ApprovalDto)
            .toAgent(LoopPublisherAgent)
            .returns(ArticleDto)
            .toFinish(StoryWorkflowFinish),
        ),
    ],
  })
  class ReviewLoopWorkflow {}
  return ReviewLoopWorkflow;
};

describe("#271 AC4: a two-class cycle states its direction with about(…)", () => {
  it("two-class cycle: with about it assembles, and a new draft outdates the older notes", () => {
    const workflow = reviewLoop("about", about(DraftDto, oneOf(ApprovalDto, DraftChangesDto)));

    expect(checkWorkflow(workflow as never)).toMatchObject({ errors: [] });
    expect(statusesAt(workflow, "about-reviewer-agent", "DraftChangesDto")).toEqual(
      new Set([SlotStatus.Absent, SlotStatus.Outdated]),
    );
    expect(statusesAt(workflow, "loop-publisher-agent", "DraftDto")).toEqual(
      new Set([SlotStatus.Current]),
    );
  });

  it("cycle without about — hint: names the producer to wrap; the review loop fixture assembles", () => {
    const workflow = reviewLoop("plain", oneOf(ApprovalDto, DraftChangesDto));

    expect(errorsOf(workflow, "io.ambiguous-cycle")).toEqual([
      "plain-workflow: DraftChangesDto, DraftDto are built from each other in the cycle through " +
        "loop-writer-agent, plain-reviewer-agent — say what the answers are about: wrap " +
        "plain-reviewer-agent's output in about(DraftDto, …)",
    ]);
    expect(checkWorkflow(StoryWorkflow)).toMatchObject({ errors: [] });
  });

  it("about the wrong class does not direct the cycle", () => {
    const workflow = reviewLoop(
      "off",
      about(ArticleRequestDto, oneOf(ApprovalDto, DraftChangesDto)),
    );

    expect(errorsOf(workflow, "io.ambiguous-cycle")).toHaveLength(1);
  });

  it("about(DraftDto, CritiqueDto) and about(DraftDto, listOf(CritiqueDto)) direct a cycle too", () => {
    expect(checkWorkflow(PolishWorkflow)).toMatchObject({ errors: [] });
    expect(statusesAt(PolishWorkflow, "polish-agent", "list:CritiqueDto")).toEqual(
      new Set([SlotStatus.Absent, SlotStatus.Current]),
    );
    expect(statusesAt(PolishWorkflow, "critique-action", "list:CritiqueDto")).toEqual(
      new Set([SlotStatus.Absent, SlotStatus.Outdated]),
    );
    expect(checkWorkflow(critiqueLoop(about(DraftDto, CritiqueDto)) as never)).toMatchObject({
      errors: [],
    });
    expect(errorsOf(critiqueLoop(CritiqueDto), "io.ambiguous-cycle")).toEqual([
      expect.stringContaining("wrap single-critique-action's output in about(DraftDto, …)"),
    ]);
  });
});

// --- one critique, from an action -----------------------------------------------------------

function critiqueLoop(output: DeclaredOutput): object {
  const suffix = output === CritiqueDto ? "plain" : "about";
  @Agent({
    name: `${suffix}-critiqued-writer-agent`,
    description: "Rewrites the draft by the critique",
    prompt: "Rewrite it.",
    model: "moonshotai/kimi-k2.6",
    maxVisits: 3,
    input: { request: ArticleRequestDto, critique: optional(CritiqueDto) },
    output: DraftDto,
  })
  class CritiquedWriterAgent {}
  @Action({
    name: "single-critique-action",
    description: "Critiques",
    input: { draft: DraftDto },
    output,
  })
  class SingleCritiqueAction {
    execute(): Promise<CritiqueDto> {
      return Promise.resolve({ remark: "ok" });
    }
  }
  @WorkflowFinish({
    name: `${suffix}-draft-workflow-finish`,
    description: "The draft",
    output: DraftDto,
  })
  class DraftWorkflowFinish {}
  @Router({
    name: `${suffix}-critique-gate-router`,
    description: "Rewrites or stops",
    decidedBy: DecidedBy.Model,
    model: "typesafe/jev-1.13",
    maxVisits: 3,
    input: { critique: CritiqueDto },
    routes: [
      { target: CritiquedWriterAgent, prompt: "Rewrite" },
      { target: DraftWorkflowFinish, prompt: "Stop and publish the draft" },
    ],
  })
  class CritiqueGateRouter {}
  @Workflow({
    name: `${suffix}-critique-workflow`,
    version: "1.0.0",
    flow: [
      start(StoryWorkflowStart).returns(ArticleRequestDto).toAgent(CritiquedWriterAgent),
      agent(CritiquedWriterAgent)
        .returns(DraftDto)
        .toAction(SingleCritiqueAction)
        .returns(CritiqueDto)
        .toRouter(CritiqueGateRouter)
        .chooseOne(route(CritiquedWriterAgent), route(DraftWorkflowFinish)),
    ],
  })
  class CritiqueWorkflow {}
  return CritiqueWorkflow;
}

// --- a three-class cycle: plan → draft → review → plan ---------------------------------------

@Agent({
  name: "planner-agent",
  description: "Plans the article, again after a review",
  prompt: "Plan it.",
  model: "moonshotai/kimi-k2.6",
  maxVisits: 3,
  input: { request: ArticleRequestDto, notes: optional(DraftChangesDto) },
  output: PlanDto,
})
class PlannerAgent {}

const planLoop = (
  name: string,
  writerOutput: DeclaredOutput,
  reviewerOutput: DeclaredOutput,
): object => {
  @Agent({
    name: `${name}-plan-writer-agent`,
    description: "Writes the draft from the plan",
    prompt: "Write it.",
    model: "moonshotai/kimi-k2.6",
    input: { plan: PlanDto },
    output: writerOutput,
  })
  class PlanWriterAgent {}
  @Agent({
    name: `${name}-plan-reviewer-agent`,
    description: "Approves the draft or sends notes to the planner",
    prompt: "Review it.",
    model: "moonshotai/kimi-k2.6",
    input: { draft: DraftDto },
    output: reviewerOutput,
  })
  class PlanReviewerAgent {}
  @Workflow({
    name: `${name}-plan-workflow`,
    version: "1.0.0",
    flow: [
      start(StoryWorkflowStart).returns(ArticleRequestDto).toAgent(PlannerAgent),
      agent(PlannerAgent)
        .returns(PlanDto)
        .toAgent(PlanWriterAgent)
        .returns(DraftDto)
        .toAgent(PlanReviewerAgent)
        .switch(
          caseOf(DraftChangesDto).toAgent(PlannerAgent),
          caseOf(ApprovalDto)
            .toAgent(LoopPublisherAgent)
            .returns(ArticleDto)
            .toFinish(StoryWorkflowFinish),
        ),
    ],
  })
  class PlanLoopWorkflow {}
  return PlanLoopWorkflow;
};

describe("#271 AC4: a three-class cycle", () => {
  const answers = oneOf(ApprovalDto, DraftChangesDto);

  it("three-class cycle: without about → error with the hint", () => {
    expect(errorsOf(planLoop("plain", DraftDto, answers), "io.ambiguous-cycle")).toEqual([
      "plain-plan-workflow: DraftChangesDto, DraftDto, PlanDto are built from each other in the " +
        "cycle through plain-plan-reviewer-agent, plain-plan-writer-agent, planner-agent — say what " +
        "the answers are about: wrap plain-plan-writer-agent's output in about(PlanDto, …)",
    ]);
  });

  it("three-class cycle: with about outdating is correct on every path", () => {
    const workflow = planLoop("about", DraftDto, about(DraftDto, answers));

    expect(checkWorkflow(workflow as never)).toMatchObject({ errors: [] });
    expect(statusesAt(workflow, "about-plan-writer-agent", "PlanDto")).toEqual(
      new Set([SlotStatus.Current]),
    );
    expect(statusesAt(workflow, "about-plan-writer-agent", "DraftChangesDto")).toEqual(
      new Set([SlotStatus.Absent, SlotStatus.Outdated]),
    );
    expect(statusesAt(workflow, "loop-publisher-agent", "DraftDto")).toEqual(
      new Set([SlotStatus.Current]),
    );
  });

  it("the hint's own fix assembles too", () => {
    const workflow = planLoop("hinted", about(PlanDto, DraftDto), answers);

    expect(errorsOf(workflow, "io.ambiguous-cycle")).toEqual([]);
  });
});

// --- two inputs of the class named in about (S14) ---------------------------------------------

describe("#271 S14: about names a class, never one of two tagged versions", () => {
  const editLoop = (
    name: string,
    input: Record<string, typeof DraftDto | typeof DraftPairDto>,
    target: typeof DraftDto | typeof DraftPairDto,
  ): object => {
    @Agent({
      name: `${name}-diff-reviewer-agent`,
      description: "Reviews the edit",
      prompt: "Review the edit.",
      model: "moonshotai/kimi-k2.6",
      maxVisits: 3,
      input,
      output: about(target, oneOf(ApprovalDto, DraftChangesDto)),
    })
    class DiffReviewerAgent {}
    @Workflow({
      name: `${name}-edit-workflow`,
      version: "1.0.0",
      flow: [
        start(StoryWorkflowStart)
          .returns(ArticleRequestDto)
          .toAgent(LoopWriterAgent)
          .returns(DraftDto, { as: "before" })
          .toAgent(LoopWriterAgent),
        agent(LoopWriterAgent)
          .returns(DraftDto, { as: "after" })
          .toAgent(DiffReviewerAgent)
          .switch(
            caseOf(DraftChangesDto).toAgent(LoopWriterAgent),
            caseOf(ApprovalDto)
              .toAgent(LoopPublisherAgent)
              .returns(ArticleDto)
              .toFinish(StoryWorkflowFinish),
          ),
      ],
    })
    class EditWorkflow {}
    return EditWorkflow;
  };

  it("two inputs of the about class → [io.ambiguous-about] with the pair DTO hint", () => {
    const workflow = editLoop("tagged", { before: DraftDto, after: DraftDto }, DraftDto);

    expect(errorsOf(workflow, "io.ambiguous-about")).toEqual([
      "tagged-edit-workflow: tagged-diff-reviewer-agent reads 2 DraftDto fields (before, after) " +
        "and its output is about(DraftDto, …) — about which one? Put both into one DTO built by a " +
        "step (DraftPairDto with @Nested(DraftDto) fields) and write about(DraftPairDto, …)",
    ]);
  });

  it("DraftPairDto instead of a tag: one input of the about class is not ambiguous", () => {
    const workflow = editLoop("pair", { pair: DraftPairDto }, DraftPairDto);

    expect(errorsOf(workflow, "io.ambiguous-about")).toEqual([]);
  });
});

import { describe, expectTypeOf, it } from "vitest";
import type { FlowPath } from "../../src/flow/ast.js";
import {
  agent,
  action,
  caseOf,
  route,
  router,
  start,
  toAction,
  toAgent,
  toFinish,
  toRouter,
} from "../../src/flow/builder.js";
import { Action } from "../../src/flow/decorators/action.js";
import { Agent, RagMode, type AgentOptions } from "../../src/flow/decorators/agent.js";
import { DecidedBy, Router } from "../../src/flow/decorators/router.js";
import { WorkflowFinish } from "../../src/flow/decorators/workflow-finish.js";
import {
  isVariant,
  listOf,
  oneOf,
  optional,
  variant,
  type Produced,
} from "../../src/flow/dto-wrappers.js";
import type {
  InputOf,
  MissingGeneratedTypes,
  OutputOf,
  ProducerOutputOf,
} from "../../src/flow/generated-types.js";
import type { ActionHandler } from "../../src/flow/handlers.js";
import { Reasoning, ReasoningEffort } from "../../src/models/reasoning.js";
import {
  ChatWorkflowFinish,
  MainRouter,
  ProfilerAgent,
  ScoutAgent,
} from "./fixtures/chat.fixture.js";
import {
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
  OfferSentDto,
  OpeningsDto,
  ProfileDto,
  ResumeMissingDto,
  ReviewDto,
  ShortlistDto,
  UnrelatedDto,
} from "./fixtures/dtos.js";
import {
  BrokenAgent,
  DraftAgent,
  EditorAgent,
  NotifyRecruiterAction,
  OfferSentWorkflowFinish,
  OfferWorkflowStart,
  ReviewerAgent,
  SendOfferAction,
  VisitsLimitExceededError,
} from "./fixtures/offer.fixture.js";
import { reviewerAgentOptions } from "./fixtures/reviewer-agent.options.js";

/**
 * Compile-time checks of the v2 flow (#272 PR 1, S3). Checked by `tsc` (the gate's typecheck), not
 * run by Vitest. Each `@ts-expect-error` is a negative test: tsc fails this file if the line
 * compiles. The types come from the hand-made `fixtures/agboss-types.d.ts` (PR 3 generates them).
 */

/** A component the generated types do not know yet (no brand): every check names the fix. */
@Agent({
  name: "fresh-agent",
  description: "Added after the last agboss check",
  prompt: "Do it.",
  model: "moonshotai/kimi-k2.6",
})
class FreshAgent {}

describe("AC1: a path starts with its source's kind", () => {
  it("a source of the wrong kind does not compile", () => {
    start(OfferWorkflowStart);
    agent(ReviewerAgent);
    router(MainRouter);
    action(SendOfferAction);
    // @ts-expect-error — MainRouter is not an agent
    agent(MainRouter);
    // @ts-expect-error — DraftAgent is not a workflow start
    start(DraftAgent);
    // @ts-expect-error — DraftAgent is not a router
    router(DraftAgent);
    // @ts-expect-error — DraftAgent is not an action
    action(DraftAgent);
    expectTypeOf(start(OfferWorkflowStart)).toExtend<FlowPath>();
  });
});

describe("AC2: transitions name the target's kind", () => {
  it("a target of the wrong kind does not compile", () => {
    const shortlist = start(OfferWorkflowStart).returns(ShortlistDto);
    shortlist.toAgent(DraftAgent);
    // @ts-expect-error — MainRouter is not an agent
    shortlist.toAgent(MainRouter);
    // @ts-expect-error — DraftAgent is not a router
    shortlist.toRouter(DraftAgent);
    // @ts-expect-error — DraftAgent is not an action
    shortlist.toAction(DraftAgent);
    // @ts-expect-error — DraftAgent is not a workflow finish
    shortlist.toFinish(DraftAgent);
    // @ts-expect-error — a route target is an agent, an action, a router or a finish
    route(OfferWorkflowStart);
    expectTypeOf(shortlist).toHaveProperty("toAgent");
  });

  it("returns is checked against output", () => {
    start(OfferWorkflowStart).returns(ShortlistDto);
    // @ts-expect-error — the start's input is ShortlistDto
    start(OfferWorkflowStart).returns(OfferDraftDto);
    const drafted = start(OfferWorkflowStart).returns(ShortlistDto).toAgent(DraftAgent);
    drafted.returns(OfferDraftDto);
    // @ts-expect-error — draft-agent gives OfferDraftDto, not a list of it
    drafted.returns(listOf(OfferDraftDto));
    // @ts-expect-error — draft-agent gives OfferDraftDto
    drafted.returns(ShortlistDto);
    expectTypeOf<ProducerOutputOf<DraftAgent>>().toEqualTypeOf<OfferDraftDto>();
  });

  it("a next node that cannot take what the path carries does not compile", () => {
    const drafted = start(OfferWorkflowStart).returns(ShortlistDto).toAgent(DraftAgent);
    // @ts-expect-error — broken-agent's generated input reports [input.missing-on-path]
    drafted.returns(OfferDraftDto).toAgent(BrokenAgent);
    expectTypeOf<InputOf<BrokenAgent>>().toHaveProperty("__error");
  });
});

describe("S3: before generation every check names the fix", () => {
  it("an unbranded class resolves to the diagnostic type", () => {
    // @ts-expect-error — Missing generated types — run `agboss check`
    agent(FreshAgent);
    // @ts-expect-error — Missing generated types — run `agboss check`
    start(OfferWorkflowStart).returns(ShortlistDto).toAgent(FreshAgent);
    expectTypeOf<InputOf<FreshAgent>>().toEqualTypeOf<MissingGeneratedTypes>();
    expectTypeOf<OutputOf<FreshAgent>>().toEqualTypeOf<MissingGeneratedTypes>();
  });
});

describe("AC15: .returns follows every step with an output and no step without one", () => {
  it("returns required after output, impossible after void action", () => {
    const drafted = start(OfferWorkflowStart).returns(ShortlistDto).toAgent(DraftAgent);
    // @ts-expect-error — draft-agent has an output: .returns(OfferDraftDto) comes first
    drafted.toAgent(ReviewerAgent);
    // @ts-expect-error — a start returns its input first
    start(OfferWorkflowStart).toAgent(DraftAgent);
    const notified = toAction(NotifyRecruiterAction);
    notified.toFinish(OfferSentWorkflowFinish);
    // @ts-expect-error — notify-recruiter-action has no output: nothing to return
    notified.returns(OfferSentDto);
    // @ts-expect-error — one .returns per step
    drafted.returns(OfferDraftDto).returns(OfferDraftDto);
    expectTypeOf(notified).toHaveProperty("toFinish");
  });
});

describe("AC5: switch(caseOf(…)) after a oneOf output", () => {
  it("caseOf outside oneOf does not compile, nor a missing case", () => {
    agent(ReviewerAgent).switch(
      caseOf(ChangesRequestedDto).toAgent(EditorAgent),
      caseOf(DraftApprovedDto).toAction(SendOfferAction),
    );
    agent(ReviewerAgent).switch(
      // @ts-expect-error — OfferSentDto is not an output of reviewer-agent
      caseOf(OfferSentDto).toAction(SendOfferAction),
      caseOf(ChangesRequestedDto).toAgent(EditorAgent),
      caseOf(DraftApprovedDto).toAction(SendOfferAction),
    );
    // @ts-expect-error — the switch is not exhaustive: DraftApprovedDto has no case
    agent(ReviewerAgent).switch(caseOf(ChangesRequestedDto).toAgent(EditorAgent));
    // @ts-expect-error — a oneOf output is branched with .switch, never returned
    agent(ReviewerAgent).returns(ChangesRequestedDto);
    // @ts-expect-error — a single output is returned, not switched
    agent(DraftAgent).switch(caseOf(OfferDraftDto).toAgent(ReviewerAgent));
    expectTypeOf<ProducerOutputOf<ProfilerAgent>>().toEqualTypeOf<ProfileDto | ResumeMissingDto>();
  });
});

describe("AC6: a router continues with chooseOne(route(…)…)", () => {
  it("chooseOne takes routes only", () => {
    router(MainRouter).chooseOne(
      route(ScoutAgent).returns(OpeningsDto).toFinish(ChatWorkflowFinish),
    );
    // @ts-expect-error — chooseOne takes route(…) paths, not caseOf(…)
    router(MainRouter).chooseOne(caseOf(ProfileDto).toRouter(MainRouter));
    // @ts-expect-error — a router gives no value to return
    router(MainRouter).returns(ProfileDto);
    expectTypeOf(router(MainRouter)).toHaveProperty("chooseOne");
  });
});

describe("AC7: .onError stands right after the step that throws", () => {
  it("onError takes a toAction side path and does not follow .returns", () => {
    const edited = agent(EditorAgent).onError(
      VisitsLimitExceededError,
      toAction(NotifyRecruiterAction),
    );
    const returned = edited.returns(OfferDraftDto);
    const sidePath = toAction(NotifyRecruiterAction);
    // @ts-expect-error — .onError comes before the step's .returns, never after it
    returned.onError(VisitsLimitExceededError, sidePath);
    // @ts-expect-error — the side path is toAction(…)…, not a route
    agent(EditorAgent).onError(VisitsLimitExceededError, route(EditorAgent));
    expectTypeOf(edited).toHaveProperty("returns");
  });
});

describe("AC7: a side path starts with any transition, kinds checked", () => {
  it("toAction, toAgent, toRouter and toFinish begin a side path", () => {
    const edited = agent(EditorAgent)
      .onError(VisitsLimitExceededError, toFinish(OfferSentWorkflowFinish))
      .onError(Error, toAgent(DraftAgent).returns(OfferDraftDto).toAgent(ReviewerAgent))
      .onError(
        RangeError,
        toRouter(MainRouter).chooseOne(
          route(ScoutAgent).returns(OpeningsDto).toFinish(ChatWorkflowFinish),
        ),
      );
    // @ts-expect-error — MainRouter is not an agent
    toAgent(MainRouter);
    // @ts-expect-error — DraftAgent is not a router
    toRouter(DraftAgent);
    // @ts-expect-error — DraftAgent is not a workflow finish
    toFinish(DraftAgent);
    // @ts-expect-error — draft-agent has an output: .returns(OfferDraftDto) comes first
    toAgent(DraftAgent).toAgent(ReviewerAgent);
    const finished = toFinish(OfferSentWorkflowFinish);
    // @ts-expect-error — nothing follows a finish
    finished.toAgent(DraftAgent);
    expectTypeOf(edited).toHaveProperty("returns");
  });
});

describe("#270 AC22: wrappers compose one way", () => {
  it("listOf(optional) does not compile; optional(listOf) does", () => {
    expectTypeOf(optional(listOf(OfferDraftDto)).inner.element).toEqualTypeOf<
      typeof OfferDraftDto
    >();
    // @ts-expect-error — a list element is never absent
    listOf(optional(OfferDraftDto));
    // @ts-expect-error — oneOf needs two classes or more
    oneOf(OfferDraftDto);
  });
});

describe("#269 AC1 / AC2: closed sets are enums, reasoning has one form", () => {
  const base = {
    name: "enum-agent",
    description: "Uses the enums",
    prompt: "Do it.",
    model: "moonshotai/kimi-k2.6",
  } as const;

  it("reasoning forms", () => {
    const forms: readonly AgentOptions[] = [
      { ...base, reasoning: Reasoning.off() },
      { ...base, reasoning: Reasoning.on({ effort: ReasoningEffort.High }) },
      { ...base, reasoning: Reasoning.modelDecides() },
    ];
    expectTypeOf(forms).toEqualTypeOf<readonly AgentOptions[]>();
  });

  it("thinking does not exist", () => {
    // @ts-expect-error — `thinking` is removed: reasoning: Reasoning.on({ effort })
    const options: AgentOptions = { ...base, thinking: "low" };
    expectTypeOf(options).toEqualTypeOf<AgentOptions>();
  });

  it("rag mode string does not compile", () => {
    const tool: AgentOptions = { ...base, rag: [{ use: DraftAgent, mode: RagMode.Tool }] };
    // @ts-expect-error — the mode is RagMode.Context, not a string
    const context: AgentOptions = { ...base, rag: [{ use: DraftAgent, mode: "context" }] };
    expectTypeOf([tool, context]).toEqualTypeOf<AgentOptions[]>();
  });
});

describe("AC16: a shared options const keeps its exact types", () => {
  it("satisfies Omit<AgentOptions, name | description>", () => {
    expectTypeOf(reviewerAgentOptions.output).toEqualTypeOf<typeof ReviewDto>();
    const withName = {
      prompt: "Review it.",
      model: "moonshotai/kimi-k2.6",
      // @ts-expect-error — name is set by each class, never in the shared const
      name: "reviewer-agent",
    } satisfies Omit<AgentOptions, "name" | "description">;
    expectTypeOf(withName.prompt).toEqualTypeOf<string>();
  });
});

describe("#270 AC12 / AC23: handlers take InputOf<Self>", () => {
  it("handlers take InputOf<Self>", () => {
    expectTypeOf<InputOf<SendOfferAction>>().toEqualTypeOf<{
      draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent>;
    }>();
    expectTypeOf<ActionHandler<SendOfferAction>["execute"]>().returns.toEqualTypeOf<
      Promise<OfferSentDto>
    >();
    expectTypeOf<ActionHandler<NotifyRecruiterAction>["execute"]>().returns.toEqualTypeOf<
      Promise<void>
    >();
  });

  it("no handler without input", () => {
    // @ts-expect-error — a finish without input has no handler
    @WorkflowFinish({ name: "bad-workflow-finish", description: "Bad", output: OfferSentDto })
    class HandledPassThroughWorkflowFinish {
      finish(): OfferSentDto {
        return { delivered: true };
      }
    }
    expectTypeOf(HandledPassThroughWorkflowFinish).toBeConstructibleWith();
  });

  it("a model router has no route()", () => {
    // @ts-expect-error — a model router's routes are chosen by its model
    @Router({
      name: "coded-router",
      description: "Bad",
      decidedBy: DecidedBy.Model,
      input: { draft: OfferDraftDto },
      routes: [{ target: DraftAgent, prompt: "Draft it" }],
    })
    class CodedRouter {
      route(): string {
        return "draft-agent";
      }
    }
    expectTypeOf(CodedRouter).toBeConstructibleWith();
  });

  it("an action implements execute", () => {
    // @ts-expect-error — an action's class implements ActionHandler: execute(input)
    @Action({ name: "empty-action", description: "Bad" })
    class EmptyAction {}
    expectTypeOf(EmptyAction).toBeConstructibleWith();
  });
});

describe("#270 AC2: variant / isVariant", () => {
  it("variant names a class; isVariant narrows a Produced value", () => {
    const item = {} as Produced<ChangesRequestedDto | DraftApprovedDto, typeof ReviewerAgent>;
    if (isVariant(item, ChangesRequestedDto)) {
      expectTypeOf(item.value).toEqualTypeOf<ChangesRequestedDto>();
    } else {
      expectTypeOf(item.value).toEqualTypeOf<DraftApprovedDto>();
    }
    // @ts-expect-error — the value must fit the class it names
    variant(ChangesRequestedDto, { delivered: true });
    expectTypeOf(variant(UnrelatedDto, { anything: "x" }).anything).toEqualTypeOf<string>();
  });
});

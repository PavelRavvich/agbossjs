import { describe, expect, it } from "vitest";
import { checkWorkflow } from "../../../src/flow/analyse/analyse.js";
import { DecidedBy, Router } from "../../../src/flow/decorators/router.js";
import { Workflow } from "../../../src/flow/decorators/workflow.js";
import { OfferDraftDto, ShortlistDto } from "../fixtures/dtos.js";
import {
  DraftKitAgent,
  DraftKitWorkflowFinish,
  EditKitAgent,
  KitRouter,
  KitWorkflowStart,
  SecondKitWorkflowStart,
  SentKitWorkflowFinish,
} from "../fixtures/kit.fixture.js";
import { route, router, start } from "../fixtures/paths.js";

/** Router rules (#272 AC6, #270, #280): routes as sets, input, model. */

const entry = () => start(SecondKitWorkflowStart).returns(OfferDraftDto).toRouter(KitRouter);
const editAgain = () => route(EditKitAgent).returns(OfferDraftDto).toRouter(KitRouter);

@Workflow({
  name: "reordered-routes-workflow",
  version: "1.0.0",
  flow: [entry(), router(KitRouter).chooseOne(route(DraftKitWorkflowFinish), editAgain())],
})
class ReorderedRoutesWorkflow {}

@Workflow({
  name: "mismatched-routes-workflow",
  version: "1.0.0",
  flow: [entry(), router(KitRouter).chooseOne(editAgain(), route(SentKitWorkflowFinish))],
})
class MismatchedRoutesWorkflow {}

@Workflow({
  name: "duplicate-route-workflow",
  version: "1.0.0",
  flow: [
    entry(),
    router(KitRouter).chooseOne(
      route(DraftKitWorkflowFinish),
      route(DraftKitWorkflowFinish),
      editAgain(),
    ),
  ],
})
class DuplicateRouteWorkflow {}

@Router({
  name: "blind-router",
  description: "Reads nothing, has no model",
  decidedBy: DecidedBy.Model,
  input: {},
  routes: [
    { target: DraftKitWorkflowFinish, prompt: "Stop and send the answer: always" },
    { target: DraftKitWorkflowFinish, prompt: "Stop and send the answer: again" },
  ],
})
class BlindRouter {}

const blindPaths = [
  start(SecondKitWorkflowStart)
    .returns(OfferDraftDto)
    .toRouter(BlindRouter)
    .chooseOne(route(DraftKitWorkflowFinish)),
];

@Workflow({ name: "blind-router-workflow", version: "1.0.0", flow: blindPaths })
class BlindRouterWorkflow {}

@Workflow({
  name: "default-model-workflow",
  version: "1.0.0",
  flow: blindPaths,
  defaults: { router: { model: "typesafe/jev-1.13" } },
})
class DefaultModelWorkflow {}

@Workflow({
  name: "choose-after-agent-workflow",
  version: "1.0.0",
  flow: [
    start(KitWorkflowStart)
      .returns(ShortlistDto)
      .toAgent(DraftKitAgent)
      .chooseOne(route(DraftKitWorkflowFinish)),
  ],
})
class ChooseAfterAgentWorkflow {}

const errorsOf = (workflow: abstract new () => unknown) =>
  checkWorkflow(workflow).errors.map(({ code, message }) => ({ code, message }));

describe("AC6: routes mismatch as sets", () => {
  it("the flow's routes in another order than @Router({ routes }) pass", () => {
    expect(errorsOf(ReorderedRoutesWorkflow)).toEqual([]);
  });

  it("different targets fail, naming the missing and the extra ones", () => {
    expect(errorsOf(MismatchedRoutesWorkflow)).toContainEqual({
      code: "router.routes-mismatch",
      message:
        "mismatched-routes-workflow: kit-router: the flow's routes and @Router({ routes }) differ — not in @Router({ routes }): sent-kit-workflow-finish; missing in .chooseOne(…): draft-kit-workflow-finish",
    });
  });

  it("a target listed twice in the flow fails", () => {
    expect(errorsOf(DuplicateRouteWorkflow)).toEqual([
      {
        code: "router.duplicate-route",
        message:
          "duplicate-route-workflow: kit-router: route(…) to draft-kit-workflow-finish is listed twice in .chooseOne(…) — list each target once",
      },
    ]);
  });
});

describe("AC11: router assembly rules — input and model (#270, #280)", () => {
  it("an empty input, a target listed twice in routes and no model fail", () => {
    expect(errorsOf(BlindRouterWorkflow)).toEqual([
      {
        code: "router.duplicate-route",
        message:
          "blind-router-workflow: blind-router: @Router({ routes }) lists draft-kit-workflow-finish twice — list each target once",
      },
      {
        code: "router.empty-input",
        message:
          "blind-router-workflow: blind-router has an empty input — declare what it chooses by: input: { message: XDto }",
      },
      {
        code: "router.no-model",
        message:
          "blind-router-workflow: blind-router has no model — set model on @Router, or defaults.router.model on the workflow",
      },
    ]);
  });

  it("defaults.router.model gives a router its model", () => {
    expect(errorsOf(DefaultModelWorkflow).map((found) => found.code)).not.toContain(
      "router.no-model",
    );
  });

  it(".chooseOne(…) only follows a router", () => {
    expect(errorsOf(ChooseAfterAgentWorkflow)).toContainEqual({
      code: "graph.choose-from-non-router",
      message:
        "choose-after-agent-workflow: draft-kit-agent is not a router — .chooseOne(…) follows .toRouter(…) or router(…)",
    });
  });
});

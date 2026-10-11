import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ComponentError } from "../../src/components/metadata.js";
import { assembleFlowGraph } from "../../src/graph/build.js";
import { from, Self, type Flow } from "../../src/graph/flow.js";
import { RouterDecisionError } from "../../src/graph/nodes/flow-router.js";
import { Router } from "../../src/graph/router.decorator.js";
import { flowRouterFactory, routerModelOf } from "../../src/graph/router-model.js";
import type { RouterEngine as RoutingStrategy } from "../../src/routers/index.js";
import { fakeChatFactory, fakeGateway, usageRecord } from "../helpers.js";
import { codeReviewFlow } from "./fixtures/code-review.js";
import { scriptedRouter, testRuntime } from "./fixtures/nodes.js";
import { A, B, Done, Gate, Only, Pick, Start } from "./fixtures/rule-nodes.js";

const dir = mkdtempSync(join(tmpdir(), "router-texts-"));
const promptFile = join(dir, "how.prompt.md");
const routeFile = join(dir, "done.route.md");
writeFileSync(promptFile, "﻿\r\n\r\nLook at the review.\r\n  Keep indentation.\r\n\r\n");
writeFileSync(routeFile, "﻿The work is finished.\r\n");

@Router({
  name: "texts",
  description: "Texts from files",

  prompt: "Decide carefully.\n\nLook at the review.\n  Keep indentation.",
  model: "typesafe/jev-1.13",

  routes: [
    { prompt: "Done:\n\nThe work is finished.", target: Done },
    { prompt: "Café work", target: A },
  ],
})
class Texts {}

@Router({
  name: "lost",
  prompt: "",
  description: "Its prompt file is missing",
  model: "typesafe/jev-1.13",
  routes: [{ prompt: "Finished", target: Done }],
})
class Lost {}

const selfFlow: Flow = [
  from(Start).next(Pick),
  from(Pick).routes(),
  from(A, B).next(Gate),
  from(Gate).routes(),
];

async function run(flow: Flow, routers: Readonly<Record<string, RoutingStrategy>>) {
  const { graph } = await assembleFlowGraph(flow, testRuntime(routers));
  return graph.invoke({ task: "do it" });
}

const gate = scriptedRouter("gate", []);

const failingWith = (outcome: Awaited<ReturnType<RoutingStrategy["route"]>>): RoutingStrategy => ({
  name: "pick",
  route: () => Promise.resolve(outcome),
});

describe("AC1: routers", () => {
  it("sends routes sorted by target name with the router's prompt as instructions", async () => {
    const main = scriptedRouter("main", ["explainer"]);

    await run(codeReviewFlow, { main, "review-gate": scriptedRouter("review-gate", []) });

    expect(main.requests[0]?.options).toEqual([
      { name: "coder", description: "Writing code" },
      { name: "explainer", description: "Explaining code" },
    ]);
    expect(main.requests[0]?.instructions).toBe("Pick who handles the message.");
  });

  it("joins prompt then files with one blank line, normalised (BOM, CRLF, edges, NFC)", async () => {
    const texts = scriptedRouter("texts", ["done"]);

    await run([from(Start).next(Texts), from(Texts).routes(), from(A).next(Done)], {
      texts,
    });

    expect(texts.requests[0]?.instructions).toBe(
      "Decide carefully.\n\nLook at the review.\n  Keep indentation.",
    );
    expect(texts.requests[0]?.options).toEqual([
      { name: "a", description: "Café work" },
      { name: "done", description: "Done:\n\nThe work is finished." },
    ]);
  });

  it("Self returns to the agent the router was called after", async () => {
    const state = await run(selfFlow, {
      pick: scriptedRouter("pick", ["b"]),
      gate: scriptedRouter("gate", ["self", "done"]),
    });

    expect(state.path).toEqual(["workflow-start.start", "pick", "b", "gate", "b", "gate", "done"]);
  });

  it("a returned option that is not a route fails the run with router.unknown-route", async () => {
    const error = await run(selfFlow, { pick: scriptedRouter("pick", ["ghost"]), gate }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RouterDecisionError);
    expect(error).toMatchObject({ code: "router.unknown-route", router: "pick" });
  });

  it("an unknown option reported by the routing model is router.unknown-route, with its spend", async () => {
    const usage = usageRecord("router:pick", 0.01);
    const pick = failingWith({
      kind: "failed",
      reason: "unknown route: x",
      unknownOption: "x",
      usage,
    });

    await expect(run(selfFlow, { pick, gate })).rejects.toMatchObject({
      code: "router.unknown-route",
      usage: [usage],
    });
  });

  it("a failed decision call fails the run with router.failed and the model's reason", async () => {
    const pick = failingWith({ kind: "failed", reason: "router error: timeout" });

    await expect(run(selfFlow, { pick, gate })).rejects.toThrow(
      'Router "pick" [router.failed]: router error: timeout',
    );
  });

  @Router({
    name: "chatty",
    description: "Chatty",
    prompt: "Pick.",
    model: "test/router",
    routes: [
      { prompt: "A", target: A },
      { prompt: "Finished", target: Done },
    ],
  })
  class Chatty {}

  describe("AC1: routers through the existing routing strategies", () => {
    const deps = {
      gateway: fakeGateway(fakeChatFactory({ "test/router": ['{"next":"done","reason":"ok"}'] })),
      chatDefaults: { temperature: 0, thinking: "default" as const, cache: false },
      chatModelSettings: (model: string) => ({
        model,
        price: { inputPerMTok: 1, outputPerMTok: 2 },
      }),
    };
    const runtime = testRuntime({}, { routerFor: flowRouterFactory(deps) });

    it("picks Jev for typesafe/jev-* and a chat model otherwise", () => {
      expect(routerModelOf("typesafe/jev-1.13", deps)).toEqual({
        kind: "jev",
        model: "typesafe/jev-1.13",
      });
      expect(routerModelOf("test/router", deps)).toMatchObject({
        kind: "llm",
        model: "test/router",
      });
    });

    it("a router with one route decides without a model call", async () => {
      const flow: Flow = [from(Start).next(A), from(A).next(Only), from(Only).routes()];
      const { graph } = await assembleFlowGraph(flow, runtime);

      const state = await graph.invoke({ task: "go" });

      expect(state.path).toEqual(["workflow-start.start", "a", "only", "done"]);
      expect(state.routeReason).toBe("single option");
    });

    it("a chat-model router decides from the model's JSON and records its usage", async () => {
      const flow: Flow = [from(Start).next(Chatty), from(Chatty).routes(), from(A).next(Done)];
      const { graph } = await assembleFlowGraph(flow, runtime);

      const state = await graph.invoke({ task: "go" });

      expect(state.path).toEqual(["workflow-start.start", "chatty", "done"]);
      expect(state.usage.map((record) => record.caller)).toEqual(["router:chatty"]);
    });
  });
});

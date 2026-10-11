import { Router } from "../../../src/graph/router.decorator.js";
import { Self } from "../../../src/graph/flow.js";
import { testNode } from "./nodes.js";

@testNode("workflow-start", "start")
export class Start {}

@testNode("agent", "a")
export class A {}

@testNode("agent", "b")
export class B {}

@testNode("agent", "other-a")
export class OtherA {}

/** A second class claiming the name "a". */
@testNode("agent", "a")
export class AlsoNamedA {}

@testNode("workflow-finish", "done")
export class Done {}

@testNode("workflow-finish", "other-done")
export class OtherDone {}

/**
 * Not a flow node. A class with members of its own (a tool, a service) is rejected by the compiler;
 * one whose members a node may have too (here a lifecycle hook) only by the assembly (`graph.not-a-node`).
 */
export class SomeTool {
  onStart(): string {
    return "started";
  }
}

const jev = "typesafe/jev-1.13";

@Router({
  name: "pick",
  description: "Picks A or B",
  prompt: "Pick.",
  model: jev,
  routes: [
    { prompt: "A", target: A },
    { prompt: "B", target: B },
  ],
})
export class Pick {}

@Router({
  name: "gate",
  description: "Back or done",
  prompt: "Gate.",
  model: jev,
  maxVisits: 10,
  routes: [
    { prompt: "Again", target: Self },
    { prompt: "Finished", target: Done },
  ],
})
export class Gate {}

@Router({
  name: "only",
  description: "One route",
  prompt: "Only.",
  model: jev,
  routes: [{ prompt: "Finished", target: Done }],
})
export class Only {}

@Router({
  name: "second",
  description: "Done too",
  prompt: "Second.",
  model: jev,
  routes: [
    { prompt: "A", target: A },
    { prompt: "Finished", target: Done },
  ],
})
export class Second {}

@Router({
  name: "mute",
  prompt: "",
  description: "No texts",
  model: jev,
  routes: [
    { prompt: "", target: Done },
    { prompt: "", target: A },
  ],
})
export class Mute {}

/** A router that sends the turn back to A or finishes — no `maxVisits`. */
@Router({
  name: "loop",
  description: "A again or done",
  prompt: "Loop.",
  model: jev,
  routes: [
    { prompt: "A", target: A },
    { prompt: "Finished", target: Done },
  ],
})
export class Loop {}

/** Two routers for one cycle (`Ping → A → Pong → B → Ping`) — no `maxVisits` on either. */
@Router({
  name: "ping",
  description: "A or done",
  prompt: "Ping.",
  model: jev,
  routes: [
    { prompt: "A", target: A },
    { prompt: "Finished", target: Done },
  ],
})
export class Ping {}

@Router({
  name: "pong",
  description: "B or done",
  prompt: "Pong.",
  model: jev,
  routes: [
    { prompt: "B", target: B },
    { prompt: "Finished", target: Done },
  ],
})
export class Pong {}

/** `Gate` without `maxVisits`: `Self` makes it a cycle with the agent before it. */
@Router({
  name: "unbounded-gate",
  description: "Back or done",
  prompt: "Gate.",
  model: jev,
  routes: [
    { prompt: "Again", target: Self },
    { prompt: "Finished", target: Done },
  ],
})
export class UnboundedGate {}

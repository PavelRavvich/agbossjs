import {
  Agent,
  ENV,
  Injectable,
  Workflow,
  from,
  type Environment,
  type OnWorkflowStart,
} from "../../../../src/index.js";
import { TestSettings } from "../../test-flow/star.js";
import { ChatStart, Reply, settingsDefaults } from "../app/settings.workflow.js";

/** An observer — not a tool — that reads the app's environment; created when the app starts. */
@Injectable({ deps: [ENV] })
export class RunLog implements OnWorkflowStart {
  constructor(readonly env: Environment) {}

  onWorkflowStart(): void {
    // a real one would log to `this.env`'s sink
  }
}

/** An agent with no tools: nothing but the observer injects ENV. */
@Agent({
  name: "greeter",
  description: "Greets",
  prompt: "Greet the user.",
  model: "test/greeter",
  price: { inputPerMTok: 1, outputPerMTok: 10 },
})
export class Greeter {}

/** #239: ENV injected only by an observer, and no `environments/` folder next to this file. */
@Workflow({
  name: "observed",
  version: "1.0.0",
  flow: [from(ChatStart).next(Greeter), from(Greeter).next(Reply)],
  defaults: settingsDefaults,
  observers: [RunLog],
})
export class ObservedApp extends TestSettings {}

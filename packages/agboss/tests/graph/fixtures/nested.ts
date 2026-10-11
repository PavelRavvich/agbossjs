import { Agent, Workflow, WorkflowAction } from "../../../src/components/decorators.js";
import { InjectionToken, provide } from "../../../src/components/injection.js";
import { LocalSagaStrategy } from "../../../src/core/saga/local-saga.strategy.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import {
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  MODEL_MAX,
  catchError,
  Tool,
  type ToolHandler,
} from "../../../src/index.js";

/** What the compensating workflow's action did (the saga test reads it). */
export const undone: string[] = [];

const defaults = {
  models: { temperature: 0, maxTokens: MODEL_MAX, thinking: "default", cache: true },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 4 },
  history: { limit: 4 },
} as const;

class Settings implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

/** Registered only by the child workflow: its tools get it from the child's own providers. */
export const GREETING = new InjectionToken<string>("GREETING");

export class GreetQuery {
  @Text() who!: string;
}

export class Greeting {
  @Text() text!: string;
}

@Tool({
  name: "greet",
  description: "Greets someone",
  input: GreetQuery,
  output: Greeting,
  deps: [GREETING],
})
export class Greet implements ToolHandler<GreetQuery, Greeting> {
  constructor(private readonly greeting: string) {}

  run({ who }: GreetQuery): Promise<Greeting> {
    return Promise.resolve({ text: `${this.greeting}, ${who}` });
  }
}

const price = { inputPerMTok: 1, outputPerMTok: 10 };

@Agent({ name: "drafter", description: "Drafts", prompt: "You draft.", model: "test/a", price })
export class Drafter {}

@Agent({
  name: "greeter",
  description: "Greets",
  prompt: "You greet.",
  model: "test/b",
  price,
  tools: [Greet],
})
export class Greeter {}

@WorkflowStart({ name: "child-start", description: "Child start", input: WorkflowStartText })
export class ChildStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "child-done", description: "Child done", output: WorkflowFinishText })
export class ChildDone {}

@Workflow({
  name: "greeting",
  version: "1.0.0",
  flow: [from(ChildStart).next(Greeter), from(Greeter).next(ChildDone)],
  defaults,
  providers: [provide(GREETING, "Hello")],
})
export class GreetingWorkflow extends Settings {}

@WorkflowStart({ name: "start", description: "Start", input: WorkflowStartText })
export class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "done", description: "Done", output: WorkflowFinishText })
export class Done {}

/** A → the greeting workflow → done. */
@Workflow({
  name: "parent",
  version: "1.0.0",
  flow: [
    from(Start).next(Drafter),
    from(Drafter).next(GreetingWorkflow),
    from(GreetingWorkflow).next(Done),
  ],
  defaults,
})
export class Parent extends Settings {}

/** The same child, but the parent registers GREETING with another value. */
@Workflow({
  name: "conflicting-parent",
  version: "1.0.0",
  flow: [from(Start).next(GreetingWorkflow), from(GreetingWorkflow).next(Done)],
  defaults,
  providers: [provide(GREETING, "Howdy")],
})
export class ConflictingParent extends Settings {}

/** Another class under the parent's agent name "drafter". */
@Agent({ name: "drafter", description: "Drafts too", prompt: "You draft.", model: "test/b", price })
export class OtherDrafter {}

@Workflow({
  name: "other-drafting",
  version: "1.0.0",
  flow: [from(ChildStart).next(OtherDrafter), from(OtherDrafter).next(ChildDone)],
  defaults,
})
export class OtherDrafting extends Settings {}

/** Its child uses the node name "drafter" for another agent class. */
@Workflow({
  name: "clashing-parent",
  version: "1.0.0",
  flow: [
    from(Start).next(Drafter),
    from(Drafter).next(OtherDrafting),
    from(OtherDrafting).next(Done),
  ],
  defaults,
})
export class ClashingParent extends Settings {}

@WorkflowAction({ name: "undo-booking" })
export class UndoBooking {
  execute(): Record<string, never> {
    undone.push("undo-booking");
    return {};
  }
}

@WorkflowStart({ name: "undo-start", description: "Undo start", input: WorkflowStartText })
export class UndoStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "undo-done", description: "Undo done", output: WorkflowFinishText })
export class UndoDone {}

/** The compensation of a booking: its own flow, one action. */
@Workflow({
  name: "undo",
  version: "1.0.0",
  flow: [from(UndoStart).next(UndoBooking), from(UndoBooking).next(UndoDone)],
  defaults,
})
export class UndoWorkflow extends Settings {}

@Agent({
  name: "booker",
  description: "Books",
  prompt: "You book.",
  model: "test/a",
  price,
  compensate: UndoWorkflow,
})
export class Booker {}

@Agent({ name: "payer", description: "Pays", prompt: "You pay.", model: "test/b", price })
export class Payer {}

/** Booker → Payer; a failing payer is compensated: the booker's compensation is a workflow. */
@Workflow({
  name: "booking",
  version: "1.0.0",
  flow: [
    from(Start).next(Booker),
    from(Booker).next(Payer),
    from(Payer).next(Done),
    catchError(Payer, Error).compensateWith(LocalSagaStrategy),
    from(LocalSagaStrategy).next(Done),
  ],
  defaults,
})
export class Booking extends Settings {}

import {
  Agent,
  Injectable,
  Tool,
  Workflow,
  type OnDestroy,
  type Class,
  type Provider,
  from,
  WorkflowFinish,
  WorkflowStart,
  WorkflowSettings,
  type FlowNodeClass,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import { usd } from "../../../src/units/index.js";

/** What the components of this fixture did, in order (`created:session-1`, `destroyed:tool-1`, …). */
export const log: string[] = [];
let sessions = 0;
let tools = 0;
let catalogs = 0;

/** Holds every tool call until `size` of them are in flight at once (proves two runs overlap). */
class Barrier {
  size = 1;
  private readonly waiting: (() => void)[] = [];
  async arrive(): Promise<void> {
    if (this.waiting.length + 1 >= this.size) {
      this.waiting.splice(0).forEach((go) => {
        go();
      });
      return;
    }
    await new Promise<void>((go) => this.waiting.push(go));
  }
}
export const barrier = new Barrier();

export class Query {
  @Text() text!: string;
}

/** Per-run state: what this run has searched so far. */
@Injectable({ scope: "run" })
export class SearchSession implements OnDestroy {
  readonly id = `session-${String(++sessions)}`;
  readonly seen: string[] = [];
  constructor() {
    log.push(`created:${this.id}`);
  }
  onDestroy(): void {
    log.push(`destroyed:${this.id}`);
  }
}

/** App-wide: one for the app, shared by every run. */
@Injectable()
export class Catalog {
  readonly id = `catalog-${String(++catalogs)}`;
}

@Tool({
  name: "greenhouse_jobs",
  description: "Searches jobs",
  input: Query,
  output: Query,
  scope: "run",
  deps: [SearchSession, Catalog],
})
export class GreenhouseJobs implements OnDestroy {
  readonly id = `tool-${String(++tools)}`;
  constructor(
    private readonly session: SearchSession,
    private readonly catalog: Catalog,
  ) {}
  async run(input: Query): Promise<Query> {
    this.session.seen.push(input.text);
    await barrier.arrive();
    const text = `${this.id} ${this.session.id} ${this.catalog.id} saw ${this.session.seen.join(",")}`;
    log.push(text);
    return { text };
  }
  onDestroy(): void {
    log.push(`destroyed:${this.id}`);
  }
}

/** The mistake the rule is for: a singleton tool holding a run-scoped session. */
@Tool({
  name: "leaky_jobs",
  description: "Searches jobs",
  input: Query,
  output: Query,
  deps: [SearchSession],
})
export class LeakyJobs {
  constructor(private readonly session: SearchSession) {}
  run(input: Query): Promise<Query> {
    return Promise.resolve({ text: `${this.session.id} ${input.text}` });
  }
}

@WorkflowStart({ name: "start", description: "Start", input: WorkflowStartText })
export class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finish", description: "Finish", output: WorkflowFinishText })
export class Finish {}

class Limits implements WorkflowDefinition {
  settings() {
    return (
      WorkflowSettings.builder()
        // runs go in parallel here: each reserves its run cap of the day (#202)
        .limits({ perDay: { cost: usd(100) }, perRun: { steps: 10, cost: usd(1) } })
        .build()
    );
  }
}

/** `start → <agent with tool> → finish`, the tool's dependencies registered. */
export function searchWorkflow(tool: typeof GreenhouseJobs | typeof LeakyJobs): {
  workflow: Class;
  agent: FlowNodeClass;
} {
  @Agent({ name: "scout", model: "stub", description: "scout", tools: [tool] })
  class Scout {}

  const providers: Provider[] = [SearchSession, Catalog];
  @Workflow({
    name: "run-scope",
    version: "1",
    defaults: {
      models: { temperature: 0, thinking: "default", cache: true },
      router: { kind: "jev", model: "typesafe/jev-1.13" },
      tools: { maxToolCalls: 4 },
      history: { limit: 1 },
    },
    flow: [from(Start).next(Scout), from(Scout).next(Finish)],
    providers,
  })
  class SearchWorkflow extends Limits {}
  return { workflow: SearchWorkflow, agent: Scout };
}

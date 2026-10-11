import {
  Agent,
  Injectable,
  Tool,
  Workflow,
  type ObserverClass,
  type Provider,
  from,
  WorkflowFinish,
  WorkflowStart,
  WorkflowSettings,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { WorkflowStartText, WorkflowFinishText, Text } from "../../../src/dto/index.js";
import { usd } from "../../../src/units/index.js";

export class EchoInput {
  @Text() text!: string;
}

/** Every call of `AuditService`, across its instances. */
export const auditCalls: string[] = [];

/** A service with hook-named methods, injected into the tool but never listed as an observer. */
@Injectable()
export class AuditService {
  record(text: string): void {
    auditCalls.push(`record:${text}`);
  }
  onError(error: Error): void {
    auditCalls.push(`onError:${error.message}`);
  }
  onToolEnd(): void {
    auditCalls.push("onToolEnd");
  }
  onWorkflowStart(): void {
    auditCalls.push("onWorkflowStart");
  }
}

@Tool({
  name: "echo",
  description: "Echoes the text",
  input: EchoInput,
  output: EchoInput,
  deps: [AuditService],
})
export class EchoTool {
  constructor(private readonly audit: AuditService) {}
  run(input: EchoInput): Promise<EchoInput> {
    this.audit.record(input.text);
    return Promise.resolve({ text: `echo ${input.text}` });
  }
}

@Agent({ name: "worker", model: "stub", description: "worker", tools: [EchoTool] })
export class Worker {}

@WorkflowStart({ name: "start", description: "Start", input: WorkflowStartText })
export class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finish", description: "Finish", output: WorkflowFinishText })
export class Finish {}

class Limits implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder()
      .limits({ perDay: { cost: usd(100) }, perRun: { steps: 10, cost: usd(1) } })
      .build();
  }
}

/** A workflow `start → worker (echo tool) → finish` with the given observers. */
export function workflowWith(
  name: string,
  observers: readonly ObserverClass[],
  providers: readonly Provider[] = [],
): typeof Limits {
  @Workflow({
    name,
    version: "1",
    defaults: {
      models: { temperature: 0, thinking: "default", cache: true },
      router: { kind: "jev", model: "typesafe/jev-1.13" },
      tools: { maxToolCalls: 2 },
      history: { limit: 1 },
    },
    flow: [from(Start).next(Worker), from(Worker).next(Finish)],
    observers,
    providers: [AuditService, ...providers],
  })
  class ObservedWorkflow extends Limits {}
  return ObservedWorkflow;
}

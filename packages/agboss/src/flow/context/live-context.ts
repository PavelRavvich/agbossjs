import { ExecutionContextUnavailableError } from "./errors.js";
import {
  ExecutionContext,
  type StepDescriptor,
  type WorkflowClass,
  type WorkflowDescriptor,
} from "./execution-context.js";
import { currentFrame, type Frame } from "./frame.js";

/**
 * The injected `ExecutionContext` (#280): one per consumer, every getter reading the frame of the
 * current async context — so it is safe in an app-scoped component and in parallel branches. No
 * frame → `ExecutionContextUnavailableError` (outside an execution); a closed frame → the same error
 * naming the ended step (S18). Frozen: nothing is set through it. One level until #263.
 */
export class LiveExecutionContext extends ExecutionContext {
  constructor(private readonly consumer: string) {
    super();
    Object.freeze(this);
  }

  get executionId(): string {
    return this.frameFor("executionId").execution.executionId;
  }

  get threadId(): string {
    return this.frameFor("threadId").execution.threadId;
  }

  get ownerId(): string | undefined {
    return this.frameFor("ownerId").execution.ownerId;
  }

  get signal(): AbortSignal {
    return this.frameFor("signal").execution.signal;
  }

  get workflow(): WorkflowDescriptor {
    return this.frameFor("workflow").execution.workflow;
  }

  get step(): StepDescriptor {
    return this.frameFor("step").step;
  }

  get itemIndex(): number | undefined {
    this.frameFor("itemIndex");
    return undefined;
  }

  get parent(): this | undefined {
    this.frameFor("parent");
    return undefined;
  }

  get root(): this {
    this.frameFor("root");
    return this;
  }

  get depth(): number {
    this.frameFor("depth");
    return 1;
  }

  executionOf(workflow: WorkflowClass): this | undefined {
    return this.frameFor("executionOf").execution.workflow.type === workflow ? this : undefined;
  }

  private frameFor(field: string): Frame {
    const frame = currentFrame();
    if (frame === undefined) {
      throw ExecutionContextUnavailableError.outside({ consumer: this.consumer, field });
    }
    if (frame.isClosed()) {
      throw ExecutionContextUnavailableError.ended(frame.step, frame.execution.executionId);
    }
    return frame;
  }
}

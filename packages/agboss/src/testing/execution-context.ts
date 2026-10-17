import type { Class } from "../components/injection.js";
import { componentOf } from "../components/metadata.js";
import {
  ExecutionContext,
  type StepDescriptor,
  type WorkflowClass,
  type WorkflowDescriptor,
} from "../flow/context/execution-context.js";
import { idempotencyKeyOf } from "../flow/context/idempotency.js";
import { declarationOf } from "../flow/decorators/declaration.js";

/** The step of a `testExecutionContext`: what is not given takes its default. */
export interface TestStepOptions {
  /** The component the step runs (its `name` from its decorator); default: a step `test-step`. */
  readonly component?: Class;
  readonly visitNumber?: number;
  readonly callId?: string;
  readonly itemIndex?: number;
  readonly copyNumber?: number;
}

/** What a unit test sets on its `ExecutionContext`; the rest takes its default. */
export interface TestExecutionContextOptions {
  readonly executionId?: string;
  readonly threadId?: string;
  readonly ownerId?: string;
  readonly signal?: AbortSignal;
  /** The `@Workflow` class (its `name` and `version` from its decorator). */
  readonly workflow?: WorkflowClass;
  readonly step?: TestStepOptions;
}

/** Stands in for a component a test does not name. */
class TestStep {
  declare readonly placeholder: "test-step";
}

/** Stands in for a workflow a test does not name. */
class TestWorkflow {
  declare readonly placeholder: "test-workflow";
}

/** A decorated class's `name` (a flow node's or a tool's), else its class name. */
function nameOf(cls: Class, fallback: string): string {
  const declared = declarationOf(cls)?.options.name;
  if (declared !== undefined) return declared;
  const meta = componentOf(cls)?.meta;
  if (meta !== undefined && "name" in meta) return meta.name;
  return cls === TestStep || cls === TestWorkflow ? fallback : cls.name;
}

function workflowOf(type: WorkflowClass): WorkflowDescriptor {
  const options = declarationOf(type)?.options;
  const version = options !== undefined && "version" in options ? options.version : "0.0.0";
  return Object.freeze({
    type,
    name: nameOf(type, "test-workflow"),
    version,
    startedVersion: version,
  });
}

function stepOf(executionId: string, options: TestStepOptions): StepDescriptor {
  const type = options.component ?? TestStep;
  const name = nameOf(type, "test-step");
  const visitNumber = options.visitNumber ?? 1;
  const { callId, itemIndex } = options;
  return Object.freeze({
    component: Object.freeze({ type, name }),
    nodeId: name,
    visitNumber,
    idempotencyKey: idempotencyKeyOf({ executionId, nodeId: name, visitNumber, itemIndex, callId }),
    callId,
    itemIndex,
    copyNumber: options.copyNumber ?? 1,
  });
}

/** A frozen root execution: the values a unit test gave, read the same at any time. */
class FixedExecutionContext extends ExecutionContext {
  readonly executionId: string;
  readonly threadId: string;
  readonly ownerId: string | undefined;
  readonly signal: AbortSignal;
  readonly workflow: WorkflowDescriptor;
  readonly step: StepDescriptor;
  readonly itemIndex = undefined;
  readonly depth = 1;

  constructor(options: TestExecutionContextOptions) {
    super();
    this.executionId = options.executionId ?? "test-execution";
    this.threadId = options.threadId ?? this.executionId;
    this.ownerId = options.ownerId;
    this.signal = options.signal ?? new AbortController().signal;
    this.workflow = workflowOf(options.workflow ?? TestWorkflow);
    this.step = stepOf(this.executionId, options.step ?? {});
    Object.freeze(this);
  }

  get parent(): this | undefined {
    return undefined;
  }

  get root(): this {
    return this;
  }

  executionOf(workflow: WorkflowClass): this | undefined {
    return workflow === this.workflow.type ? this : undefined;
  }
}

/**
 * An `ExecutionContext` for a component created in a unit test without the container (#280):
 * `new WriteAuditAction(testExecutionContext(), fakeAuditRepository)`. Frozen, one level (no
 * parent), readable at any time — no execution needed. Defaults: execution `test-execution`, its
 * own thread, no owner, a signal nobody aborts, step `test-step` on its first visit.
 */
export function testExecutionContext(options: TestExecutionContextOptions = {}): ExecutionContext {
  return new FixedExecutionContext(options);
}

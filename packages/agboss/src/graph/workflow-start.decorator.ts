import type { Class } from "../components/injection.js";
import type { WorkflowStartText } from "../dto/standard/framework.js";
import type { DtoClass } from "../dto/types.js";
import { recordNode } from "./node-kind.js";

/**
 * `@WorkflowStart` — where a workflow run starts: `@WorkflowStart({ name, description, input:
 * WorkflowStartText })`. Minimal here: the input's `text` becomes the task; other inputs, channels and
 * stream come with #117.
 */
export interface WorkflowStartOptions<
  In extends DtoClass<WorkflowStartText> = DtoClass<WorkflowStartText>,
> {
  readonly name: string;
  readonly description: string;
  readonly input: In;
}

/**
 * A `@WorkflowStart` class: it declares its input for the compiler, `declare readonly input: ChatIn`,
 * so `app.execute(ChatWorkflowStart, input)` checks the input against the DTO.
 */
export type WorkflowStartClass<I extends WorkflowStartText = WorkflowStartText> = Class<{
  readonly input: I;
}>;

/** What `app.execute(start, input)` takes for this start: its declared input DTO. */
export type StartInputOf<S extends WorkflowStartClass> =
  S extends Class<{ readonly input: infer I }> ? I : never;

const starts = new WeakMap<Class, WorkflowStartOptions>();

/** The class must declare the same input: `declare readonly input: <the input DTO>`. */
export function WorkflowStart<In extends DtoClass<WorkflowStartText>>(
  options: WorkflowStartOptions<In>,
) {
  return <C extends WorkflowStartClass<InstanceType<In>>>(value: C): C => {
    recordNode(value, { kind: "workflow-start", name: options.name });
    starts.set(value, options);
    return value;
  };
}

/** The options `@WorkflowStart` recorded on a class. */
export const workflowStartMetaOf = (target: Class): WorkflowStartOptions | undefined =>
  starts.get(target);

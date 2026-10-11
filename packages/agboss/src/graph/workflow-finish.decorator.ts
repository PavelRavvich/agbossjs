import type { Class } from "../components/injection.js";
import type { WorkflowFinishText } from "../dto/standard/framework.js";
import type { DtoClass } from "../dto/types.js";
import { recordNode } from "./node-kind.js";

/**
 * `@WorkflowFinish` — where a workflow run finishes: `@WorkflowFinish({ name, description, output:
 * WorkflowFinishText })`. Minimal here: the output is the last agent's text (`app.execute(…).output`
 * is a `WorkflowFinishText`); structured finishes come with #117.
 */
export interface WorkflowFinishOptions<
  Out extends DtoClass<WorkflowFinishText> = DtoClass<WorkflowFinishText>,
> {
  readonly name: string;
  readonly description: string;
  readonly output: Out;
}

/** The fields a finish DTO requires besides `text`. */
type RequiredBesidesText<T> = Exclude<
  { [K in keyof T]-?: Partial<Pick<T, K>> extends Pick<T, K> ? never : K }[keyof T],
  "text"
>;

/**
 * A run fills only the finish's `text`, so a finish DTO may add optional fields only; a required one
 * is a compile error naming it.
 */
export type FinishOutputCheck<Out extends DtoClass<WorkflowFinishText>> = [
  RequiredBesidesText<InstanceType<Out>>,
] extends [never]
  ? Out
  : { readonly "a run fills only `text`; make optional": RequiredBesidesText<InstanceType<Out>> };

const finishes = new WeakMap<Class, WorkflowFinishOptions>();

export function WorkflowFinish<Out extends DtoClass<WorkflowFinishText>>(
  options: WorkflowFinishOptions<Out> & { readonly output: FinishOutputCheck<Out> },
) {
  return <C extends Class>(value: C): C => {
    recordNode(value, { kind: "workflow-finish", name: options.name });
    finishes.set(value, options);
    return value;
  };
}

/** The options `@WorkflowFinish` recorded on a class. */
export const workflowFinishMetaOf = (target: Class): WorkflowFinishOptions | undefined =>
  finishes.get(target);

import { callerFile } from "../../components/call-site.js";
import type { Class, ResolvedAll, Token } from "../../components/injection.js";
import type { DtoClass } from "../../dto/types.js";
import { NodeKind } from "../ast.js";
import { declared, recordDeclaration, type InputFields } from "./declaration.js";

/**
 * `@WorkflowFinish` — where an execution ends. With `input` the class implements
 * `FinishHandler<Self>` (`finish(input)` builds the output); without `input` it has no handler and
 * passes the latest `output`-type value on the path through (#270 Q50).
 */
export interface WorkflowFinishOptions<TDeps extends readonly Token[] = readonly Token[]> {
  /** Ends with `-workflow-finish` (`chat-workflow-finish`). */
  readonly name: string;
  readonly description: string;
  readonly input?: InputFields;
  readonly output: DtoClass;
  /** Constructor dependencies, in order; checked against the constructor by the compiler. */
  readonly deps?: TDeps;
}

/** A finish with `input`: it builds its output in `finish(input)`. */
export type HandledFinishOptions<TDeps extends readonly Token[]> = WorkflowFinishOptions<TDeps> & {
  readonly input: InputFields;
};

/** A finish without `input`: a pass-through, no handler. */
export type PassThroughFinishOptions<TDeps extends readonly Token[]> =
  WorkflowFinishOptions<TDeps> & { readonly input?: undefined };

/** What a handled finish's class has: `finish(input)` (`implements FinishHandler<Self>`). */
export interface FinishMethod {
  finish(input: never): unknown;
}

/** A pass-through finish's class has no handler: `finish` there is a compile error (like `route`). */
export type NoFinishMethod<TClass extends Class> =
  InstanceType<TClass> extends { readonly finish: unknown }
    ? {
        readonly __error: "a finish without input has no handler — declare input, or remove finish()";
      }
    : unknown;

export function WorkflowFinish<const TDeps extends readonly Token[] = []>(
  options: HandledFinishOptions<TDeps>,
): <TClass extends new (...args: ResolvedAll<TDeps>) => FinishMethod>(value: TClass) => TClass;
export function WorkflowFinish<const TDeps extends readonly Token[] = []>(
  options: PassThroughFinishOptions<TDeps>,
): <TClass extends new (...args: ResolvedAll<TDeps>) => object>(
  value: TClass & NoFinishMethod<TClass>,
) => TClass;
export function WorkflowFinish(options: WorkflowFinishOptions) {
  const source = callerFile();
  return <TClass extends new (...args: never[]) => object>(value: TClass): TClass => {
    recordDeclaration(value, declared(NodeKind.Finish, options, source));
    return value;
  };
}

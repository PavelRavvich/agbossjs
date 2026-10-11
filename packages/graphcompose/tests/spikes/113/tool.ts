/**
 * Spike #113 — `@Tool({ input, output })` against the class, and `callTool` in tests. Not framework API.
 *
 * A standard class decorator cannot change the class's type, but it can **constrain** it: the
 * decorator's parameter is `new (...) => ToolRun<In, Out>`, so a class whose `run` takes another
 * input or returns another output does not fit and the `@Tool` line is a compile error.
 */
import type { DtoClass } from "./dto.js";

/** The contract a tool class implements (what the user writes after `implements`). */
export interface ToolHandler<TInput, TOutput> {
  run(request: TInput): Promise<TOutput>;
}

/**
 * What the decorator demands. A **property** of function type, not a method: method parameters are
 * bivariant even under `strictFunctionTypes`, so a method-shaped constraint would let
 * `run(request: Narrower)` through.
 */
interface ToolRun<TInput, TOutput> {
  readonly run: (request: TInput) => Promise<TOutput>;
}

interface ToolOptions<TIn extends DtoClass, TOut extends DtoClass> {
  readonly name: string;
  readonly input: TIn;
  readonly output: TOut;
}

export interface ToolRecord {
  readonly name: string;
  readonly input: DtoClass;
  readonly output: DtoClass;
}

const tools = new WeakMap<object, ToolRecord>();

export function Tool<TIn extends DtoClass, TOut extends DtoClass>(options: ToolOptions<TIn, TOut>) {
  return (
    value: abstract new (...args: never[]) => ToolRun<InstanceType<TIn>, InstanceType<TOut>>,
  ): void => {
    tools.set(value, { name: options.name, input: options.input, output: options.output });
  };
}

export const toolRecordOf = (tool: object): ToolRecord | undefined => tools.get(tool);

/** The input a tool class takes — read from its `run`, which `@Tool` has tied to `input`. */
export type InputOf<C extends abstract new (...args: never[]) => ToolHandler<never, unknown>> =
  Parameters<InstanceType<C>["run"]>[0];

/** A scripted model move: "call this tool with these arguments" (what `testing` would export). */
export interface ToolCallMove<C> {
  readonly kind: "tool-call";
  readonly tool: C;
  readonly args: unknown;
}

export function callTool<C extends abstract new (...args: never[]) => ToolHandler<never, unknown>>(
  tool: C,
  args: InputOf<C>,
): ToolCallMove<C> {
  return { kind: "tool-call", tool, args };
}

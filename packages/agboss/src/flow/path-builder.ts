import type { Class } from "../components/injection.js";
import { AGBossError } from "../core/errors.js";
import type { DtoClass } from "../dto/types.js";
import {
  NodeKind,
  StepKind,
  type ChooseOneRoute,
  type ComponentSource,
  type ErrorClass,
  type PathSource,
  type ReturnedValue,
  type Step,
  type SubPath,
  type SwitchCase,
} from "./ast.js";
import type { ReturnsOptions } from "./builder-types.js";
import { isValueShape } from "./dto-wrappers.js";

/**
 * The runtime of the path builder (#272): one immutable class behind every typed builder state;
 * `builder.ts` gives it its typed entry points. Every call returns a new builder.
 */

/** A builder used where the grammar does not allow it (only reachable from untyped code). */
export class FlowSyntaxError extends AGBossError {
  static override readonly code: string = "flow.syntax";
}

/** How a builder's path begins: a source, a route, a case, or the side path of `.onError`. */
export type PathStart =
  | { readonly kind: "source" }
  | { readonly kind: "route"; readonly target: Class }
  | { readonly kind: "case"; readonly dto: DtoClass; readonly tag?: string }
  | { readonly kind: "side" };

const isReturnsOptions = (value: unknown): value is ReturnsOptions =>
  typeof value === "object" && value !== null && !isValueShape(value);

/** The values of `.returns(A, optional(B), …)`, the last argument may be `{ as }`. */
function returnedValues(args: readonly unknown[]): readonly ReturnedValue[] {
  const last = args.at(-1);
  const options = isReturnsOptions(last) ? last : undefined;
  const shapes = options === undefined ? args : args.slice(0, -1);
  return shapes.map((shape): ReturnedValue => {
    if (!isValueShape(shape))
      throw new FlowSyntaxError(".returns(…) takes DTO classes and wrappers");
    return options?.as === undefined ? { shape } : { shape, as: options.as };
  });
}

/** A flow path's builder holds its source; a sub-path's holds `undefined`. */
type SourceOf = PathSource | undefined;

export class PathBuilder<TSource extends SourceOf = SourceOf> {
  constructor(
    private readonly start: PathStart,
    readonly source: TSource,
    readonly steps: readonly Step[],
  ) {
    Object.freeze(this.steps);
  }

  private then(step: Step): PathBuilder<TSource> {
    return new PathBuilder(this.start, this.source, [...this.steps, step]);
  }

  private to(target: Class, targetKind: NodeKind): PathBuilder<TSource> {
    return this.then({ kind: StepKind.To, target, targetKind });
  }

  returns(...args: readonly unknown[]): PathBuilder<TSource> {
    return this.then({ kind: StepKind.Returns, values: returnedValues(args) });
  }

  toAgent(target: Class): PathBuilder<TSource> {
    return this.to(target, NodeKind.Agent);
  }

  toRouter(target: Class): PathBuilder<TSource> {
    return this.to(target, NodeKind.Router);
  }

  toAction(target: Class): PathBuilder<TSource> {
    return this.to(target, NodeKind.Action);
  }

  toFinish(target: Class): PathBuilder<TSource> {
    return this.to(target, NodeKind.Finish);
  }

  switch(...cases: readonly PathBuilder[]): PathBuilder<TSource> {
    return this.then({ kind: StepKind.Switch, cases: cases.map((path) => path.asCase()) });
  }

  chooseOne(...routes: readonly PathBuilder[]): PathBuilder<TSource> {
    return this.then({ kind: StepKind.ChooseOne, routes: routes.map((path) => path.asRoute()) });
  }

  onError(error: ErrorClass, path: PathBuilder): PathBuilder<TSource> {
    return this.then({ kind: StepKind.OnError, error, path: path.asSidePath() });
  }

  private subPath(): SubPath {
    return Object.freeze({ steps: this.steps });
  }

  private asCase(): SwitchCase {
    if (this.start.kind !== "case") throw new FlowSyntaxError(".switch(…) takes caseOf(…) paths");
    const { dto, tag } = this.start;
    const path = this.subPath();
    return Object.freeze(tag === undefined ? { dto, path } : { dto, tag, path });
  }

  private asRoute(): ChooseOneRoute {
    if (this.start.kind !== "route")
      throw new FlowSyntaxError(".chooseOne(…) takes route(…) paths");
    return Object.freeze({ target: this.start.target, path: this.subPath() });
  }

  private asSidePath(): SubPath {
    if (this.start.kind !== "side")
      throw new FlowSyntaxError(".onError(E, …) takes a side path: toAction(…), toFinish(…), …");
    return this.subPath();
  }
}

export const fromSource = (source: PathSource): PathBuilder<PathSource> =>
  new PathBuilder({ kind: "source" }, Object.freeze(source), []);

export const fromComponent = (
  kind: ComponentSource["kind"],
  node: Class,
): PathBuilder<PathSource> => fromSource({ kind, node });

/** A sub-path's builder. */
export const subPathFrom = (start: PathStart): PathBuilder<undefined> =>
  new PathBuilder(start, undefined, []);

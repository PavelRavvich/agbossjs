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
import type {
  AfterStep,
  AfterValue,
  CaseHead,
  KindCheck,
  KindLabel,
  ReturnsOptions,
  RouteContinuation,
  RouteTargetKind,
  RouteTargetLabel,
  SideHead,
  SourceHead,
  TargetCheck,
} from "./builder-types.js";
import { isValueShape } from "./dto-wrappers.js";

/**
 * The path builder (#272): `start(S)…`, `agent(X)…`, `router(R)…`, `action(X)…` begin a flow
 * path; `route(X)…`, `caseOf(D)…` and `toAction(X)…` begin a sub-path and return the same builder.
 * Every call returns a new, immutable builder; the AST it holds is `source` + `steps`.
 */

/** A builder used where the grammar does not allow it (only reachable from untyped code). */
export class FlowSyntaxError extends AGBossError {
  static override readonly code: string = "flow.syntax";
}

/** How a builder's path begins: a source, a route, a case, or the side path of `.onError`. */
type PathStart =
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

class PathBuilder<TSource extends SourceOf = SourceOf> {
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
    if (this.start.kind !== "side") throw new FlowSyntaxError(".onError(E, …) takes toAction(…)");
    return this.subPath();
  }
}

const fromSource = (source: PathSource): PathBuilder<PathSource> =>
  new PathBuilder({ kind: "source" }, Object.freeze(source), []);

const fromComponent = (kind: ComponentSource["kind"], node: Class): PathBuilder<PathSource> =>
  fromSource({ kind, node });

/** A sub-path's builder. */
const subPathFrom = (start: PathStart): PathBuilder<undefined> =>
  new PathBuilder(start, undefined, []);

/** A path from a start: `start(S).returns(InputDto)…`. */
export function start<const TClass extends Class>(
  source: TClass & KindCheck<TClass, NodeKind.Start, KindLabel<NodeKind.Start>>,
): AfterStep<InstanceType<TClass>, SourceHead>;
export function start(source: Class): PathBuilder<PathSource> {
  return fromSource({ kind: NodeKind.Start, node: source });
}

/** The own path of an agent reached from two or more places. */
export function agent<const TClass extends Class>(
  source: TClass & KindCheck<TClass, NodeKind.Agent, KindLabel<NodeKind.Agent>>,
): AfterStep<InstanceType<TClass>, SourceHead>;
export function agent(source: Class): PathBuilder<PathSource> {
  return fromComponent(NodeKind.Agent, source);
}

/** The own path of a router reached from two or more places: `router(R).chooseOne(…)`. */
export function router<const TClass extends Class>(
  source: TClass & KindCheck<TClass, NodeKind.Router, KindLabel<NodeKind.Router>>,
): AfterStep<InstanceType<TClass>, SourceHead>;
export function router(source: Class): PathBuilder<PathSource> {
  return fromComponent(NodeKind.Router, source);
}

/** The own path of an action reached from two or more places. */
export function action<const TClass extends Class>(
  source: TClass & KindCheck<TClass, NodeKind.Action, KindLabel<NodeKind.Action>>,
): AfterStep<InstanceType<TClass>, SourceHead>;
export function action(source: Class): PathBuilder<PathSource> {
  return fromComponent(NodeKind.Action, source);
}

/** One target of `.chooseOne(…)` and what follows it. */
export function route<const TClass extends Class>(
  target: TClass & TargetCheck<TClass, RouteTargetKind, RouteTargetLabel>,
): RouteContinuation<InstanceType<TClass>>;
export function route(target: Class): PathBuilder<undefined> {
  return subPathFrom({ kind: "route", target });
}

/** One case of `.switch(…)`: the class of the `oneOf` result, put on the path like `.returns`. */
export function caseOf<const TDto extends DtoClass>(
  dto: TDto,
  options?: ReturnsOptions,
): AfterValue<InstanceType<TDto>, CaseHead<InstanceType<TDto>>>;
export function caseOf(dto: DtoClass, options?: ReturnsOptions): PathBuilder<undefined> {
  const tag = options?.as;
  return subPathFrom(tag === undefined ? { kind: "case", dto } : { kind: "case", dto, tag });
}

/** The side path of `.onError(E, toAction(X)…)`. */
export function toAction<const TClass extends Class>(
  target: TClass & TargetCheck<TClass, NodeKind.Action, KindLabel<NodeKind.Action>>,
): AfterStep<InstanceType<TClass>, SideHead>;
export function toAction(target: Class): PathBuilder<undefined> {
  return subPathFrom({ kind: "side" }).toAction(target);
}

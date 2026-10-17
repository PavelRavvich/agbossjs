import type { Class } from "../../../src/components/injection.js";
import type { DtoClass } from "../../../src/dto/types.js";
import { NodeKind, type PathSource } from "../../../src/flow/ast.js";
import {
  fromComponent,
  fromSource,
  subPathFrom,
  type PathBuilder,
} from "../../../src/flow/path-builder.js";

/**
 * The path builder without its compile-time checks, for the analyser's tests: the graphs here are
 * wrong on purpose (a shared node inline, a missing case, a wrong kind), which the typed builder
 * (`builder.ts`) would not let compile. The AST it writes is the same.
 */

export const start = (source: Class): PathBuilder<PathSource> =>
  fromSource({ kind: NodeKind.Start, node: source });

export const agent = (source: Class): PathBuilder<PathSource> =>
  fromComponent(NodeKind.Agent, source);

export const router = (source: Class): PathBuilder<PathSource> =>
  fromComponent(NodeKind.Router, source);

export const action = (source: Class): PathBuilder<PathSource> =>
  fromComponent(NodeKind.Action, source);

export const route = (target: Class): PathBuilder => subPathFrom({ kind: "route", target });

export const caseOf = (dto: DtoClass, options?: { readonly as: string }): PathBuilder =>
  subPathFrom(
    options === undefined ? { kind: "case", dto } : { kind: "case", dto, tag: options.as },
  );

/** A side path of `.onError(E, …)` with nothing in it yet. */
export const side = (): PathBuilder => subPathFrom({ kind: "side" });

export const toAction = (target: Class): PathBuilder =>
  side()
    .toAction(target);

export const toAgent = (target: Class): PathBuilder =>
  side()
    .toAgent(target);

export const toFinish = (target: Class): PathBuilder =>
  side()
    .toFinish(target);

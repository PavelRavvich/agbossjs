import {
  isSelf,
  isReturn,
  isEnd,
  isParallel,
  isOptional,
  unwrapTarget,
  labelOf,
  type ChoiceTarget,
  type FlowNode,
  type FlowStep,
} from "./flow.js";
import type { NextDeclaration, Transition } from "./flow-nodes.js";

/** Transitions of the non-trivial flow steps (split out of flow-nodes.ts). */

export type Resolve = (target: FlowNode) => string | undefined;

export const defined = (names: readonly (string | undefined)[]): string[] =>
  names.filter((name): name is string => name !== undefined);

type ChooseDeclaration = Extract<NextDeclaration, { kind: "choose" }>;

function chooseTargets(targets: readonly ChoiceTarget[], resolve: Resolve): ChooseDeclaration {
  const nodesOnly: FlowNode[] = [];
  const parallelTargets: { optionName: string; targets: string[] }[] = [];
  const optionNames: string[] = [];
  let hasSelf = false;
  let hasReturn = false;
  let hasEnd = false;

  const parallelMember = (inner: ChoiceTarget): string | undefined => {
    if (isSelf(inner) || isReturn(inner) || isEnd(inner) || isParallel(inner))
      throw new Error("Invalid parallel target");
    const actual = (isOptional(inner) ? inner.target : inner) as FlowNode;
    nodesOnly.push(actual);
    return resolve(actual);
  };

  const extract = (t: ChoiceTarget): void => {
    if (isSelf(t)) hasSelf = true;
    else if (isReturn(t)) hasReturn = true;
    else if (isEnd(t)) hasEnd = true;
    else if (isParallel(t)) {
      const pTargets = t.targets.map(parallelMember);
      parallelTargets.push({ optionName: labelOf(t), targets: defined(pTargets) });
    } else if (isOptional(t)) {
      extract(t.target);
    } else {
      nodesOnly.push(t);
      const res = resolve(t);
      if (res) optionNames.push(res);
    }
  };

  targets.forEach(extract);

  return {
    kind: "choose",
    targets: defined(nodesOnly.map(resolve)),
    parallelTargets,
    optionNames,
    self: hasSelf,
    return: hasReturn,
    end: hasEnd,
  };
}

type StepOf<K extends FlowStep["kind"]> = Extract<FlowStep, { kind: K }>;

export function catchTransitions(step: StepOf<"catch">, resolve: Resolve): Transition[] {
  const source = resolve(step.target);
  const nextNode = resolve(step.nextNode);
  if (!source || !nextNode) return [];
  return [{ from: source, next: { kind: "catch", errorType: step.errorType, nextNode } }];
}

export function joinTransitions(step: StepOf<"join">, resolve: Resolve): Transition[] {
  const sources = defined(step.from.map(resolve));
  const target = resolve(unwrapTarget(step.target));
  if (!target) return [];
  return sources.map((from) => ({
    from,
    next: { kind: "join", target, joinSources: sources },
  }));
}

export function chooseTransitions(step: StepOf<"choose">, resolve: Resolve): Transition[] {
  const sources = defined(step.from.map(resolve));
  const next: ChooseDeclaration = {
    ...chooseTargets(step.targets, resolve),
    quorumRouter: step.quorumRouter?.name,
    quorumMin: step.quorumMin,
    quorumMax: step.quorumMax,
    quorumTimeoutSeconds: step.quorumTimeoutSeconds,
  };
  return sources.map((from) => ({ from, next }));
}

export function batchParallelTransitions(
  step: StepOf<"batchParallel">,
  resolve: Resolve,
): Transition[] {
  const sources = defined(step.from.map(resolve));
  const target = resolve(step.target);
  return target === undefined
    ? []
    : sources.map((from) => ({
        from,
        next: { kind: "batchParallel", options: step.options, target, strategy: step.strategy },
      }));
}

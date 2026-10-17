import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import type { InputFieldShape } from "../../decorators/declaration.js";
import { Wrapper } from "../../dto-wrappers.js";
import type { ComponentName } from "../../registry.js";
import {
  MAX_SCOPES_PER_NODE,
  statesOf,
  witnessPath,
  type NodeScopes,
  type ScopeState,
} from "../dataflow.js";
import type { ResolvedField } from "../fields.js";
import { shapeLabel } from "../labels.js";
import { slotOf, SlotStatus } from "../scope.js";
import type { AnalysisContext } from "./context.js";

/**
 * The input rules of #270, proved on the reachable abstract scopes (S10): a required field absent
 * in some scope → `[input.missing-on-path]` (with the shortest path to that scope); an `optional`
 * field absent in every scope → `[input.never-produced]`; a single field where one step brought
 * several values → `[input.several-on-path]`; two fields of one shape that do not each read their
 * own tag → `[flow.ambiguous-field]`; too many scopes → `[flow.analysis-too-large]`.
 */

const innerShape = (shape: InputFieldShape): InputFieldShape =>
  typeof shape !== "function" && shape.kind === Wrapper.Optional ? shape.inner : shape;

function pathTo(context: AnalysisContext, node: ComponentName, state: ScopeState): string {
  return witnessPath(context.dataflow, { node, key: state.key }).join(" → ");
}

function fieldViolations(
  context: AnalysisContext,
  node: ComponentName,
  field: ResolvedField,
  states: readonly ScopeState[],
): readonly RuleViolation[] {
  const slots = states.map((state) => ({ state, slot: slotOf(state.scope, field.slot) }));
  const absent = slots.filter(({ slot }) => slot.status === SlotStatus.Absent);
  const found: RuleViolation[] = [];
  const [shallowest] = absent;
  if (field.isRequired && shallowest !== undefined) {
    const message = `${field.label} is not produced on the path ${pathTo(context, node, shallowest.state)}`;
    found.push(violation("input.missing-on-path", message, [node]));
  }
  if (!field.isRequired && absent.length === states.length) {
    const message =
      `${field.label} is optional, but no path into ${node} produces it — return ` +
      `${shapeLabel(innerShape(field.shape))} on a path into ${node}, or remove the field`;
    found.push(violation("input.never-produced", message, [node]));
  }
  const several = field.isList ? undefined : slots.find(({ slot }) => slot.count > 1);
  if (several !== undefined) {
    const inner = shapeLabel(innerShape(field.shape));
    const message =
      `${field.label}: ${several.slot.producers.join(", ")} brings ${String(several.slot.count)} ` +
      `values on the path ${pathTo(context, node, several.state)} — declare listOf(${inner}), or ` +
      "give the values different classes";
    found.push(violation("input.several-on-path", message, [node]));
  }
  return found;
}

function ambiguousFields(
  node: ComponentName,
  fields: readonly ResolvedField[],
): readonly RuleViolation[] {
  const byBase = new Map<string, ResolvedField[]>();
  for (const field of fields.filter((candidate) => !candidate.isPassThrough)) {
    byBase.set(field.base, [...(byBase.get(field.base) ?? []), field]);
  }
  return [...byBase.values()]
    .filter((group) => group.length > 1 && group.some((field) => field.tag === undefined))
    .map((group) => {
      const [first] = group;
      const shape = first === undefined ? "" : shapeLabel(innerShape(first.shape));
      const count = group.length === 2 ? "two" : String(group.length);
      const message =
        `${node} has ${count} ${shape} fields (${group.map((field) => field.name).join(", ")}) — ` +
        `tag the values: .returns(${shape}, { as: "…" })`;
      return violation("flow.ambiguous-field", message, [node]);
    });
}

/** The slots whose state differs between the node's scopes: what multiplies them. */
function multiplyingSlots(scopes: NodeScopes): readonly string[] {
  const all = [
    ...[...scopes.states.values()].map((state) => state.scope),
    ...(scopes.rejected === undefined ? [] : [scopes.rejected]),
  ];
  const slots = new Set(all.flatMap((scope) => [...scope.keys()]));
  return [...slots]
    .filter((slot) => new Set(all.map((scope) => JSON.stringify(scope.get(slot)))).size > 1)
    .sort();
}

function nodeViolations(context: AnalysisContext, node: ComponentName): readonly RuleViolation[] {
  const fields = context.fields.get(node) ?? [];
  const scopes = context.dataflow.scopes.get(node);
  if (scopes === undefined) return ambiguousFields(node, fields);
  if (scopes.isTooLarge) {
    const message =
      `${node} is reached with more than ${String(MAX_SCOPES_PER_NODE)} path scopes — the slots ` +
      `${multiplyingSlots(scopes).join(", ")} multiply them; move a branch into a child workflow ` +
      "(agboss generate workflow …)";
    return [violation("flow.analysis-too-large", message, [node])];
  }
  const states = statesOf(context.dataflow, node);
  return [
    ...ambiguousFields(node, fields),
    ...fields.flatMap((field) => fieldViolations(context, node, field, states)),
  ];
}

export function dataInputRules(context: AnalysisContext): readonly RuleViolation[] {
  return [...context.graph.nodes.keys()].flatMap((node) => nodeViolations(context, node));
}

import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import type { ComponentName } from "../../registry.js";
import { statesOf } from "../dataflow.js";
import { EdgeKind, type FlowEdge, type ValueWrite } from "../flow-graph.js";
import { shapeLabel } from "../labels.js";
import { slotOf, slotsOfValue, SlotStatus, writtenValue, type SlotKey } from "../scope.js";
import type { AnalysisContext } from "./context.js";

/**
 * Reaching definitions on the same abstract scopes (#270 AC7, AC19): every `.returns(T)` must reach,
 * on at least one path, a node that reads it before a newer value overwrites it, else
 * `[flow.unused-output]` (a dead store fails; a value read on one path and overwritten unread on
 * another passes). A value is identified by its producer and slot — one class is one node, so a
 * producer returns in one place. `caseOf(XDto)` is a read (the switch chose by it). A tagged value
 * whose tag no field reads → `[flow.unused-tag]`.
 */

/** How a field read a value: as its shape's `latest`, or by a tag. */
const LATEST = "";

/** `producer|slot|tag`: which value was read, and how. */
const readKey = (producer: ComponentName, slot: SlotKey, role: string): string =>
  `${producer}|${slot}|${role}`;

/** Every value some field read on some reachable scope, with how it was read. */
function collectReads(context: AnalysisContext): ReadonlySet<string> {
  const reads = new Set<string>();
  for (const [node, fields] of context.fields) {
    for (const state of statesOf(context.dataflow, node)) {
      for (const field of fields) {
        const slot = slotOf(state.scope, field.slot);
        if (slot.status === SlotStatus.Absent) continue;
        for (const producer of slot.producers)
          reads.add(readKey(producer, field.base, field.tag ?? LATEST));
      }
    }
  }
  return reads;
}

/** One value a step returned, on the edge it travels. */
interface ReturnedWrite {
  readonly edge: FlowEdge;
  readonly write: ValueWrite;
}

function returnedValues(context: AnalysisContext): readonly ReturnedWrite[] {
  return context.graph.edges
    .filter((edge) => edge.kind === EdgeKind.Next && context.dataflow.scopes.has(edge.from))
    .flatMap((edge) =>
      edge.writes.filter((write) => !write.isCase).map((write) => ({ edge, write })),
    );
}

function valueViolations(
  value: ReturnedWrite,
  reads: ReadonlySet<string>,
): readonly RuleViolation[] {
  const { edge, write } = value;
  const slots = slotsOfValue(writtenValue(write.shape).value);
  const roles = [...reads].filter((key) =>
    slots.some((slot) => key.startsWith(`${edge.from}|${slot}|`)),
  );
  const found: RuleViolation[] = [];
  if (roles.length === 0) {
    const message = `${edge.from} returns ${shapeLabel(write.shape)} that no node reads — read it in a node below, or remove it`;
    found.push(violation("flow.unused-output", message, [edge.from]));
  }
  const { tag } = write;
  if (tag !== undefined && !roles.some((key) => key.endsWith(`|${tag}`))) {
    const message =
      `tag "${tag}" on ${shapeLabel(write.shape)} from ${edge.from} is never read by a field named ` +
      `"${tag}" — rename the tag or the field`;
    found.push(violation("flow.unused-tag", message, [edge.from]));
  }
  return found;
}

export function dataOutputRules(context: AnalysisContext): readonly RuleViolation[] {
  // past the scope guard the reads are incomplete: `[flow.analysis-too-large]` says so instead
  if ([...context.dataflow.scopes.values()].some((scopes) => scopes.isTooLarge)) return [];
  const reads = collectReads(context);
  const found = new Map<string, RuleViolation>();
  for (const value of returnedValues(context)) {
    for (const problem of valueViolations(value, reads))
      found.set(`${problem.code}|${problem.message}`, problem);
  }
  return [...found.values()];
}

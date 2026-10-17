import type { ValueWrite } from "../analyse/flow-graph.js";
import type { Provenance } from "../analyse/outdating.js";
import { slotsOfWrite, untaggedSlot } from "../analyse/scope.js";
import type { ScopeRecords, ScopeValueRecord } from "./records.js";

/**
 * What a value is built from at run time (#271 rule 3, S11, S40) — the same rule the analyser's
 * abstract step applies (`analyse/outdating.ts`), on `valueId`s instead of slots: the values the
 * step read (its `input` fields; every current value for an agent without `input`, rule 8), plus
 * its own `about(Target, …)` target, minus the answers about what the step writes (rule 5: a new
 * draft never counts the notes about the old one, so a new note never outdates it). Only current
 * values are ever read: the scope holds nothing else.
 */

/** The analyser's provenance tables, keyed by plain names for the runtime's records. */
export interface RuntimeProvenance {
  /** Agents without `input`: built from every current value (rule 8). */
  readonly readsEverything: ReadonlySet<string>;
  /** The slot each producer's `output: about(Target, …)` names. */
  readonly aboutTargets: ReadonlyMap<string, string>;
}

export const runtimeProvenanceOf = (provenance: Provenance): RuntimeProvenance => ({
  readsEverything: new Set<string>(provenance.readsEverything),
  aboutTargets: new Map<string, string>(provenance.aboutTargets),
});

/** One step's write, as provenance reads it. */
export interface ProvenanceSite {
  /** The node that wrote (its `name`). */
  readonly producer: string;
  /** The `valueId`s its fields read. */
  readonly read: readonly string[];
  /** What its way out writes. */
  readonly writes: readonly ValueWrite[];
}

/** Whether a record is an answer about one of the written slots (it does not count, rule 5). */
function isAboutWritten(
  record: ScopeValueRecord,
  written: ReadonlySet<string>,
  provenance: RuntimeProvenance,
): boolean {
  const target = provenance.aboutTargets.get(record.producer);
  return target !== undefined && written.has(target);
}

/** The `valueId`s the values a step writes are built from, sorted. */
export function builtFromOf(
  site: ProvenanceSite,
  scope: ScopeRecords,
  provenance: RuntimeProvenance,
): readonly string[] {
  const current = Object.values(scope);
  const read = provenance.readsEverything.has(site.producer)
    ? current.map((record) => record.valueId)
    : site.read;
  const target = provenance.aboutTargets.get(site.producer);
  const targetValue = target === undefined ? undefined : scope[target]?.valueId;
  const counted = new Set(targetValue === undefined ? read : [...read, targetValue]);
  const written = new Set<string>(site.writes.flatMap(slotsOfWrite).map(untaggedSlot));
  return current
    .filter((record) => counted.has(record.valueId))
    .filter((record) => !isAboutWritten(record, written, provenance))
    .map((record) => record.valueId)
    .sort();
}

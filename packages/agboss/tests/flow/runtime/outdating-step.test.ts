import { describe, expect, it } from "vitest";
import { writeAndOutdate } from "../../../src/flow/runtime/outdating.js";
import { builtFromOf, type RuntimeProvenance } from "../../../src/flow/runtime/provenance.js";
import {
  OutdatedReason,
  type ScopeRecords,
  type ScopeValueRecord,
} from "../../../src/flow/runtime/records.js";
import { CritiqueDto, DraftDto } from "../fixtures/review-dtos.js";

/**
 * #271 S11 / S40 / S42 — the runtime step on its own: what a value is built from, and what a write
 * outdates (the root trigger, the reason, tags, `about` protecting its target directly only).
 */

const record = (
  valueId: string,
  builtFrom: readonly string[] = [],
  slot = valueId.split("/")[1] ?? "",
): ScopeValueRecord => ({
  valueId,
  slot,
  producer: valueId.split(":")[0] ?? "",
  value: { of: valueId },
  builtFrom,
});

const scopeOf = (...records: readonly ScopeValueRecord[]): ScopeRecords =>
  Object.fromEntries(records.map((value) => [value.slot, value]));

const provenance: RuntimeProvenance = {
  readsEverything: new Set(["notes-agent"]),
  aboutTargets: new Map([["critic-agent", "DraftDto"]]),
};

const draft1 = record("writer-agent:1/DraftDto");
const critique1 = record("critic-agent:1/CritiqueDto", [draft1.valueId]);
const research1 = record("researcher-agent:1/ResearchDto", [critique1.valueId]);
const plan1 = record("planner-agent:1/PlanDto", [research1.valueId]);

describe("#271 S11: what a value is built from at run time", () => {
  it("its input fields and its own about target, even when it does not read the target", () => {
    const site = {
      producer: "critic-agent",
      read: [],
      writes: [{ shape: CritiqueDto, isCase: false }],
    };

    expect(builtFromOf(site, scopeOf(draft1), provenance)).toEqual([draft1.valueId]);
  });

  it("never an answer about the value it writes (the about direction, rule 5)", () => {
    const site = {
      producer: "writer-agent",
      read: [critique1.valueId],
      writes: [{ shape: DraftDto, isCase: false }],
    };

    expect(builtFromOf(site, scopeOf(draft1, critique1), provenance)).toEqual([]);
  });

  it("every current value for an agent without input (rule 8)", () => {
    const site = {
      producer: "notes-agent",
      read: [],
      writes: [{ shape: CritiqueDto, isCase: false }],
    };

    expect(builtFromOf(site, scopeOf(draft1, research1), provenance)).toEqual([
      research1.valueId,
      draft1.valueId,
    ]);
  });
});

describe("#271 S11: the cascade of a write", () => {
  it("the first write into a slot outdates nothing", () => {
    const outcome = writeAndOutdate(scopeOf(), scopeOf(draft1), provenance);

    expect({ outdated: outcome.outdated, cascades: outcome.cascades }).toEqual({
      outdated: [],
      cascades: [],
    });
    expect(outcome.scope).toEqual(scopeOf(draft1));
  });

  it("S42: about protects its target directly only — through a third class the cascade goes on", () => {
    const critique2 = record("critic-agent:2/CritiqueDto", [draft1.valueId]);

    const outcome = writeAndOutdate(
      scopeOf(draft1, critique1, research1, plan1),
      scopeOf(critique2),
      provenance,
    );

    expect(outcome.outdated.map((value) => [value.valueId, value.outdated.reason])).toEqual([
      [critique1.valueId, OutdatedReason.Replaced],
      [plan1.valueId, OutdatedReason.BuiltFromReplaced],
      [research1.valueId, OutdatedReason.BuiltFromReplaced],
    ]);
    expect(Object.keys(outcome.scope).sort()).toEqual(["CritiqueDto", "DraftDto"]);
  });

  it("a new draft outdates the answers about the old one: AboutReplaced, one root for all", () => {
    const draft2 = record("writer-agent:2/DraftDto");

    const outcome = writeAndOutdate(
      scopeOf(draft1, critique1, research1),
      scopeOf(draft2),
      provenance,
    );

    expect(outcome.cascades).toHaveLength(1);
    expect(outcome.cascades[0]?.trigger).toEqual(draft2);
    expect(outcome.outdated.map((value) => [value.valueId, value.outdated])).toEqual([
      [draft1.valueId, { byValueId: draft2.valueId, reason: OutdatedReason.Replaced }],
      [critique1.valueId, { byValueId: draft2.valueId, reason: OutdatedReason.AboutReplaced }],
      [research1.valueId, { byValueId: draft2.valueId, reason: OutdatedReason.BuiltFromReplaced }],
    ]);
  });

  it("S40 (c): a source the write itself outdated leaves the new value's builtFrom", () => {
    const draft2 = record("writer-agent:2/DraftDto", [draft1.valueId, research1.valueId]);

    const outcome = writeAndOutdate(
      scopeOf(draft1, critique1, research1),
      scopeOf(draft2),
      provenance,
    );

    expect(outcome.scope.DraftDto?.builtFrom).toEqual([]);
    expect(outcome.cascades[0]?.trigger.builtFrom).toEqual([]);
  });

  it("a source still current after the write stays in builtFrom", () => {
    const plan2 = record("planner-agent:2/PlanDto", [draft1.valueId, plan1.valueId]);

    const outcome = writeAndOutdate(scopeOf(draft1, plan1), scopeOf(plan2), provenance);

    expect(outcome.scope.PlanDto?.builtFrom).toEqual([draft1.valueId]);
  });

  it("byValueId is the root trigger whatever order the scope was written in", () => {
    const draft2 = record("writer-agent:2/DraftDto");
    const forward = scopeOf(draft1, critique1, research1, plan1);
    const backward = scopeOf(plan1, research1, critique1, draft1);

    const first = writeAndOutdate(forward, scopeOf(draft2), provenance);
    const second = writeAndOutdate(backward, scopeOf(draft2), provenance);

    expect(second.outdated).toEqual(first.outdated);
  });

  it("tag slots are independent: an untagged rewrite leaves what was built from #before", () => {
    const before = record("writer-agent:1/DraftDto#before", [], "DraftDto#before");
    const diff = record("diff-agent:1/DiffDto", [before.valueId]);
    const draft2 = record("writer-agent:2/DraftDto");

    const outdating = writeAndOutdate(scopeOf(draft1, before, diff), scopeOf(draft2), provenance);

    expect(outdating.outdated.map((value) => value.valueId)).toEqual([draft1.valueId]);
    expect(Object.keys(outdating.scope).sort()).toEqual(["DiffDto", "DraftDto", "DraftDto#before"]);
  });

  it("a write of several slots: each outdated value names the trigger whose chain reached it", () => {
    const list1 = record("search-agent:1/list:oneOf(ADto,BDto)", [], "list:oneOf(ADto,BDto)");
    const a1 = record("search-agent:1/list:ADto", [], "list:ADto");
    const fromA = record("reader-agent:1/ReportDto", [a1.valueId]);
    const list2 = record("search-agent:2/list:oneOf(ADto,BDto)", [], "list:oneOf(ADto,BDto)");
    const a2 = record("search-agent:2/list:ADto", [], "list:ADto");

    const outcome = writeAndOutdate(scopeOf(list1, a1, fromA), scopeOf(list2, a2), provenance);

    expect(outcome.cascades.map((cascade) => cascade.trigger.valueId)).toEqual([
      a2.valueId,
      list2.valueId,
    ]);
    expect(outcome.outdated.map((value) => [value.valueId, value.outdated.byValueId])).toEqual([
      [a1.valueId, a2.valueId],
      [list1.valueId, list2.valueId],
      [fromA.valueId, a2.valueId],
    ]);
  });
});

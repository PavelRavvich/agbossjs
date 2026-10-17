import { describe, expect, it } from "vitest";
import { shapeLabel } from "../../src/flow/analyse/labels.js";
import { slotLabel, type SlotKey } from "../../src/flow/analyse/scope.js";
import {
  about,
  aboutTargetOf,
  isValueShape,
  isVariant,
  isWrapper,
  listOf,
  oneOf,
  optional,
  outputShapeOf,
  variant,
  withVariant,
  Wrapper,
  type Produced,
} from "../../src/flow/dto-wrappers.js";
import { ChangesRequestedDto, DraftApprovedDto, OfferDraftDto } from "./fixtures/dtos.js";
import { ReviewerAgent } from "./fixtures/offer.fixture.js";

/** The #270 wrappers: frozen descriptors, and the variant a `oneOf` value carries. */

describe("#270: optional, listOf and oneOf are frozen descriptors", () => {
  it("describes each wrapper", () => {
    expect(optional(OfferDraftDto)).toEqual({ kind: Wrapper.Optional, inner: OfferDraftDto });
    expect(listOf(OfferDraftDto)).toEqual({ kind: Wrapper.List, element: OfferDraftDto });
    expect(oneOf(ChangesRequestedDto, DraftApprovedDto)).toEqual({
      kind: Wrapper.OneOf,
      variants: [ChangesRequestedDto, DraftApprovedDto],
    });
    expect(optional(listOf(oneOf(ChangesRequestedDto, DraftApprovedDto)))).toEqual({
      kind: Wrapper.Optional,
      inner: {
        kind: Wrapper.List,
        element: { kind: Wrapper.OneOf, variants: [ChangesRequestedDto, DraftApprovedDto] },
      },
    });
  });

  it("freezes them", () => {
    const wrapper = oneOf(ChangesRequestedDto, DraftApprovedDto);

    expect(Object.isFrozen(wrapper)).toBe(true);
    expect(Object.isFrozen(wrapper.variants)).toBe(true);
    expect(Object.isFrozen(listOf(OfferDraftDto))).toBe(true);
    expect(Object.isFrozen(optional(OfferDraftDto))).toBe(true);
  });

  it("tells wrappers and value shapes from other values", () => {
    expect(isWrapper(listOf(OfferDraftDto))).toBe(true);
    expect(isWrapper({ kind: "list-ish" })).toBe(false);
    expect(isWrapper(null)).toBe(false);
    expect(isWrapper({ as: "before" })).toBe(false);
    expect(isValueShape(OfferDraftDto)).toBe(true);
    expect(isValueShape(optional(OfferDraftDto))).toBe(true);
    expect(isValueShape(oneOf(ChangesRequestedDto, DraftApprovedDto))).toBe(false);
    expect(isValueShape({ as: "before" })).toBe(false);
  });
});

describe("#270 AC2: variant and isVariant", () => {
  const producedOf = <TValue>(value: TValue): Produced<TValue, typeof ReviewerAgent> =>
    ({ producer: ReviewerAgent, value }) as Produced<TValue, typeof ReviewerAgent>;

  it("variant keeps the value's fields and names its class off the record", () => {
    const changes = variant(ChangesRequestedDto, { notes: "shorter" });

    expect(changes).toEqual({ notes: "shorter" });
    expect(Object.keys(changes)).toEqual(["notes"]);
    expect(JSON.stringify(changes)).toBe('{"notes":"shorter"}');
  });

  it("isVariant narrows by the class the value carries, never by its shape", () => {
    const approved = producedOf(variant(DraftApprovedDto, {}));
    const changes = producedOf(variant(ChangesRequestedDto, { notes: "shorter" }));

    expect(isVariant(approved, DraftApprovedDto)).toBe(true);
    expect(isVariant(approved, ChangesRequestedDto)).toBe(false);
    expect(isVariant(changes, ChangesRequestedDto)).toBe(true);
    expect(isVariant(producedOf({}), DraftApprovedDto)).toBe(false);
    expect(isVariant(producedOf("text"), DraftApprovedDto)).toBe(false);
  });

  it("reads the class marked on a Produced record (the runtime's form)", () => {
    const marked = withVariant(producedOf({}), DraftApprovedDto);

    expect(isVariant(marked, DraftApprovedDto)).toBe(true);
    expect(isVariant(marked, ChangesRequestedDto)).toBe(false);
    expect(Object.keys(marked)).toEqual(["producer", "value"]);
  });
});

describe("#271 S15: about(TargetDto, shape) — a frozen descriptor around an output shape", () => {
  const answers = oneOf(ChangesRequestedDto, DraftApprovedDto);

  it("records what the answers are about and their shape: { about: Target, shape }", () => {
    const wrapper = about(OfferDraftDto, answers);

    expect(wrapper).toEqual({ kind: Wrapper.About, about: OfferDraftDto, shape: answers });
    expect(Object.isFrozen(wrapper)).toBe(true);
  });

  it("is a wrapper, but not a value shape: .returns(…) and input fields never take it", () => {
    expect(isWrapper(about(OfferDraftDto, answers))).toBe(true);
    expect(isValueShape(about(OfferDraftDto, answers))).toBe(false);
  });

  it("unwraps to its shape and names its target; any other output has no target", () => {
    expect(outputShapeOf(about(OfferDraftDto, listOf(ChangesRequestedDto)))).toEqual(
      listOf(ChangesRequestedDto),
    );
    expect(outputShapeOf(answers)).toBe(answers);
    expect(outputShapeOf(undefined)).toBeUndefined();
    expect(aboutTargetOf(about(OfferDraftDto, ChangesRequestedDto))).toBe(OfferDraftDto);
    expect(aboutTargetOf(ChangesRequestedDto)).toBeUndefined();
    expect(aboutTargetOf(answers)).toBeUndefined();
    expect(aboutTargetOf(undefined)).toBeUndefined();
  });

  it("is written in messages as in code", () => {
    expect(shapeLabel(about(OfferDraftDto, answers))).toBe(
      "about(OfferDraftDto, oneOf(ChangesRequestedDto, DraftApprovedDto))",
    );
    expect(slotLabel("list:CritiqueDto" as SlotKey)).toBe("listOf(CritiqueDto)");
    expect(slotLabel("OfferDraftDto#before" as SlotKey)).toBe('OfferDraftDto as "before"');
  });
});

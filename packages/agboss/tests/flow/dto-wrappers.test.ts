import { describe, expect, it } from "vitest";
import {
  isValueShape,
  isVariant,
  isWrapper,
  listOf,
  oneOf,
  optional,
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

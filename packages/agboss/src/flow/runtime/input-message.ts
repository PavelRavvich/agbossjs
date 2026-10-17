import type { ResolvedField } from "../analyse/fields.js";
import { prettyJson } from "./json.js";
import type { ScopeRecords, ScopeValueRecord, VariantElement } from "./records.js";

/**
 * The input message (#270 Q51): built by the framework, always the same way — every `input` field
 * in declaration order, each as `### <field> (from <producer>)` and its value as formatted JSON with
 * sorted keys; an absent `optional` field is `none`; a list is a JSON array of `{ producer, value }`.
 * Outside data stay in the `user` role; instructions never hold them.
 */

const listItems = (record: ScopeValueRecord): readonly unknown[] => {
  const values = Array.isArray(record.value) ? (record.value as readonly unknown[]) : [];
  const isOneOf = record.slot.startsWith("list:oneOf(");
  return values.map((element) =>
    isOneOf
      ? {
          producer: record.producer,
          variant: (element as VariantElement).variant,
          value: (element as VariantElement).value,
        }
      : { producer: record.producer, value: element },
  );
};

function fieldText(field: ResolvedField, record: ScopeValueRecord | undefined): string {
  if (record === undefined) return `### ${field.name}\nnone`;
  if (field.isList) return `### ${field.name}\n${prettyJson(listItems(record))}`;
  const variant = record.variant === undefined ? "" : `, ${record.variant}`;
  return `### ${field.name} (from ${record.producer}${variant})\n${prettyJson(record.value)}`;
}

/** The input message of a node's fields over the current scope. */
export function inputMessageOf(fields: readonly ResolvedField[], scope: ScopeRecords): string {
  return fields
    .filter((field) => !field.isPassThrough)
    .map((field) => fieldText(field, scope[field.slot]))
    .join("\n\n");
}

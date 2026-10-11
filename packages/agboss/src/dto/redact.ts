import { fieldsOf } from "./metadata.js";
import type { DtoClass, FieldSpec } from "./types.js";

/** What a sensitive field prints as wherever its value leaves the run (channels, their logs). */
export const REDACTED = "***";

/** The DTO each object schema was built from (`schemaOf`), so a tool's input can be redacted. */
const dtoOfSchema = new WeakMap<object, DtoClass>();

/** Remembers which DTO a schema was built from (internal: `objectSchemaOf`). */
export const rememberDtoOf = (schema: object, dto: DtoClass): void => {
  dtoOfSchema.set(schema, dto);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function redactedField(field: FieldSpec, value: unknown): unknown {
  if (value === undefined) return value;
  if (field.settings.sensitive !== undefined) return REDACTED;
  const element = field.element;
  if (element?.kind !== "dto") return value;
  return Array.isArray(value)
    ? value.map((item) => redactedDto(element.dto, item))
    : redactedDto(element.dto, value);
}

/** A DTO's fields with every `sensitive` one (nested and listed DTOs included) masked. */
function redactedRecord(dto: DtoClass, value: Record<string, unknown>): Record<string, unknown> {
  const fields = new Map(fieldsOf(dto).map((field) => [field.name, field]));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const field = fields.get(key);
      return [key, field === undefined ? item : redactedField(field, item)];
    }),
  );
}

/** A DTO's value with every `sensitive` field masked; anything but an object stays as it is. */
export const redactedDto = (dto: DtoClass, value: unknown): unknown =>
  isRecord(value) ? redactedRecord(dto, value) : value;

/**
 * Tool arguments as they may be shown (#202): the fields the tool's input DTO marks `sensitive`
 * masked. Arguments of a schema not built from a DTO (an MCP tool) are returned as they are.
 */
export function redactedArguments(
  schema: object,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const dto = dtoOfSchema.get(schema);
  return dto === undefined ? args : redactedRecord(dto, args);
}

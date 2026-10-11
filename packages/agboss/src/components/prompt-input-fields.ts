import { isOpen, registerDto } from "../dto/metadata.js";
import type { Flow } from "../graph/flow.js";
import { collectFlow } from "../graph/flow-nodes.js";
import { workflowStartMetaOf } from "../graph/workflow-start.decorator.js";
import type { PromptProblem } from "./prompt-problems.js";

/** `{{input.<field>}}`: a field of the run's start input, filled when the prompt is rendered. */
const INPUT_FIELD = /\{\{input\.(\w+)\}\}/g;

/** The start input fields a prompt may name; `undefined` = not known here (any field passes). */
export type KnownInputFields = readonly string[] | undefined;

/**
 * The fields of the workflow's starts' inputs — what `{{input.<field>}}` may name. Not known when
 * the flow has no start or a start takes an open input.
 */
export function startInputFieldsOf(flow: Flow): KnownInputFields {
  const inputs = [...collectFlow(flow).nodes.values()]
    .filter((ref) => ref.kind === "workflow-start")
    .map((ref) => workflowStartMetaOf(ref.use)?.input);
  const dtos = inputs.flatMap((dto) => (dto === undefined || isOpen(dto) ? [] : [dto]));
  if (dtos.length === 0 || dtos.length < inputs.length) return undefined;
  return [...new Set(dtos.flatMap((dto) => registerDto(dto).map((field) => field.name)))];
}

/** Every `{{input.<field>}}` of a text segment that no start of the workflow has, with its line. */
export function unknownInputFields(
  where: string,
  text: string,
  known: KnownInputFields,
): PromptProblem[] {
  if (known === undefined) return [];
  const knownSet = new Set(known);
  return [...text.matchAll(INPUT_FIELD)]
    .filter((match) => match[1] !== undefined && !knownSet.has(match[1]))
    .map((match) => {
      const line = text.slice(0, match.index).split("\n").length;
      const field = match[1] ?? "";
      return {
        code: "prompt.unknown-variable",
        message: `${where}:${String(line)} {{input.${field}}} — no workflow start has the input field "${field}" (start input fields: ${known.join(", ")})`,
      };
    });
}

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value, null, 2);
};

/**
 * Fills `{{input.<field>}}` from the run's start input (objects as JSON). A field the run's start
 * does not have renders empty, with a `prompt.missing-input-field` warning.
 */
export function fillInputFields(
  text: string,
  input: Readonly<Record<string, unknown>> | undefined,
  owner: string,
): string {
  return text.replace(INPUT_FIELD, (_match, field: string) => {
    const value = input?.[field];
    if (value === undefined) {
      process.emitWarning(
        `${owner}: {{input.${field}}} — the run's start input has no field "${field}"; rendered empty`,
        { code: "prompt.missing-input-field" },
      );
      return "";
    }
    return value === null ? "" : textOf(value);
  });
}

import { AGBossError } from "../core/errors.js";
import { WorkflowStartTextDto } from "../dto/standard/framework.js";
import { validate } from "../dto/schema.js";
import {
  workflowStartMetaOf,
  type WorkflowStartClass,
  type WorkflowStartOptions,
} from "../graph/workflow-start.decorator.js";
import type { FlowNodesByKey } from "./result.js";

/** `app.execute` from a class that is not a `@WorkflowStart` of the app's workflow. */
export class NotAWorkflowStartError extends AGBossError {
  static override readonly code: string = "workflow.not-a-start";
  override name = "NotAWorkflowStartError";
}

const startsOf = (nodes: FlowNodesByKey): WorkflowStartClass[] =>
  [...nodes.values()].filter(
    (node): node is WorkflowStartClass =>
      typeof node === "function" && workflowStartMetaOf(node) !== undefined,
  );

/** The start a plain text goes to: the one taking `WorkflowStartTextDto`, else the first one. */
export const textStartOf = (nodes: FlowNodesByKey): WorkflowStartClass | undefined => {
  const starts = startsOf(nodes);
  return (
    starts.find((start) => workflowStartMetaOf(start)?.input === WorkflowStartTextDto) ?? starts[0]
  );
};

/** A start of the workflow and its input, checked against the start's DTO (`DtoValidationError`). */
export function checkedStart(
  start: WorkflowStartClass,
  input: unknown,
  nodes: FlowNodesByKey,
  workflow: string,
): { readonly meta: WorkflowStartOptions; readonly input: WorkflowStartTextDto } {
  const meta = workflowStartMetaOf(start);
  if (meta === undefined || !startsOf(nodes).includes(start)) {
    throw new NotAWorkflowStartError(`${start.name} is not a workflow start of "${workflow}"`);
  }
  return { meta, input: validate(meta.input, input) };
}

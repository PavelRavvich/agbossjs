import { type App, type WorkflowStartClass } from "agboss";

export class NoTextStartError extends Error {
  override name = "NoTextStartError";
}

/** The workflow start the terminal's text goes to; a workflow without one cannot chat. */
export function textStartOrFail(app: Pick<App, "name" | "textStart">): WorkflowStartClass {
  if (app.textStart === undefined) {
    throw new NoTextStartError(`Workflow "${app.name}" has no @WorkflowStart for a text`);
  }
  return app.textStart;
}

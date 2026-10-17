import { type App, type Class } from "agboss";

export class NoTextStartError extends Error {
  override name = "NoTextStartError";
}

/** The workflow start the terminal's text goes to; a workflow without one cannot chat. */
export function textStartOrFail(app: Pick<App, "name" | "textStart">): Class {
  if (app.textStart === undefined) {
    throw new NoTextStartError(
      `Workflow "${app.name}" has no @WorkflowStart with input WorkflowStartTextDto for a text`,
    );
  }
  return app.textStart;
}

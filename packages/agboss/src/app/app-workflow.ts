import type { WorkflowIdentity } from "../flow/runtime/step-frame.js";
import type { App } from "./types.js";

/** The workflow each app runs (internal): what a call into the app from outside an execution names. */
const workflows = new WeakMap<App, WorkflowIdentity>();

export const rememberAppWorkflow = (app: App, workflow: WorkflowIdentity): void => {
  workflows.set(app, workflow);
};

/** The app's workflow; an app not built by `createApp` (a test double) has none. */
export const appWorkflowOf = (app: App): WorkflowIdentity | undefined => workflows.get(app);

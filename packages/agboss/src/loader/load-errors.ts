/** A workflow module that cannot be loaded: no file, or not exactly one exported @Workflow class. */
export class WorkflowLoadError extends Error {
  override name = "WorkflowLoadError";
}

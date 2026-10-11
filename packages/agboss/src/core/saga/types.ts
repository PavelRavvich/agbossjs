import type { ActionRuntime, IWorkflowAction } from "../../components/decorators.js";
import type { AgentState } from "../../graph/state.js";

/**
 * Base abstraction for Saga execution strategies.
 * Provides the contract for executing rollbacks when a workflow is cancelled or errors out.
 */
export abstract class BaseSagaStrategy implements IWorkflowAction {
  /**
   * Executes compensation logic based on the provided workflow state.
   * @param state The current workflow state containing history of executed nodes
   * @param context The runtime context (for resolving classes and running local compensations)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract execute(state: AgentState<unknown>, context: ActionRuntime): Promise<any>;
}

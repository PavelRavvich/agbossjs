import { WorkflowAction, type ActionRuntime } from "../../components/decorators.js";
import type { Class } from "../../components/injection.js";
import { componentOf } from "../../components/metadata.js";
import { BaseSagaStrategy } from "./types.js";
import type { AgentState } from "../../graph/state.js";

/** The compensation declared on an agent or action class, if any. */
function compensationOf(nodeClass: Class): Class | undefined {
  const component = componentOf(nodeClass);
  return component?.kind === "agent" || component?.kind === "action"
    ? component.meta.compensate
    : undefined;
}

/**
 * Default monolithic Saga implementation.
 * Iterates through the workflow history backwards and synchronously executes
 * any compensation actions defined on the successfully completed nodes.
 */
@WorkflowAction({ name: "LocalSagaStrategy" })
export class LocalSagaStrategy extends BaseSagaStrategy {
  async execute(
    state: AgentState<unknown>,
    context: ActionRuntime,
  ): Promise<Record<string, never>> {
    if (!context.getComponentClass || !context.runCompensation) {
      process.emitWarning("LocalSagaStrategy requires framework support for compensations.");
      return {};
    }

    // Unique node names in reverse order of their execution
    const executedNodes = Array.from(
      new Set(state.contributions.map((contribution) => contribution.agent).reverse()),
    );

    for (const nodeName of executedNodes) {
      const nodeClass = await context.getComponentClass(nodeName);
      if (!nodeClass) continue;
      const compensate = compensationOf(nodeClass);
      if (compensate) await context.runCompensation(compensate, state, nodeName);
    }

    return {};
  }
}

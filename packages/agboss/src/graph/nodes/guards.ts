import type { UsageRecord } from "../../finops/usage.js";
import { checkGuard, type Guard } from "../../guards/index.js";
import { GuardFailedError } from "../errors.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";
import type { AsyncNode } from "../types.js";

export type GuardSide = "input" | "output";

/**
 * Runs the guards of one side in order over the task (input) or the replyWith (output). The first
 * guard that trips replaces the replyWith with its refusal; a guard that cannot routeTo fails closed.
 */
export function makeGuardNode(
  guards: readonly Guard[],
  side: GuardSide,
): AsyncNode<AgentStateType, AgentStateUpdate> {
  return async (state) => {
    const text = side === "input" ? state.task : state.replyWith;
    const usage: UsageRecord[] = [];
    for (const guard of guards) {
      const verdict = await checkGuard(guard, text);
      if (verdict.usage !== undefined) usage.push(verdict.usage);
      if (verdict.kind === "failed") throw new GuardFailedError(guard.name, usage, verdict.reason);
      if (verdict.kind === "tripped") {
        return {
          usage,
          guarded: guard.name,
          replyWith: guard.refusal,
          routeReason: `stopped by guard: ${guard.name}`,
        };
      }
    }
    return { usage };
  };
}

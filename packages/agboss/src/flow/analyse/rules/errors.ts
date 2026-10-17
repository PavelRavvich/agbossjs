import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import type { AnalysisContext } from "./context.js";

/**
 * `.onError(E, …)` stands right after the step that throws (#272 AC7); several per step, one per
 * class: a second handler for the same class on one step → `[flow.duplicate-error-handler]`.
 */
export function errorRules(context: AnalysisContext): readonly RuleViolation[] {
  const seen = new Map<string, number>();
  for (const site of context.walked.errorHandlers) {
    const key = `${site.node}\u0000${site.step.error.name}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [node = "", error = ""] = key.split("\u0000");
      const message =
        `${node} has ${String(count)} handlers for ${error} — one .onError(${error}, …) per ` +
        "class on a step";
      return violation("flow.duplicate-error-handler", message, [node]);
    });
}

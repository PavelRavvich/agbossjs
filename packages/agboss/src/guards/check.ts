import type { Guard, GuardVerdict } from "./types.js";

const withUsage = <TVerdict extends GuardVerdict>(
  verdict: TVerdict,
  usage: GuardVerdict["usage"],
): TVerdict => (usage === undefined ? verdict : { ...verdict, usage });

/** Asks the guard's router; P(flag) ≥ threshold → tripped. A failed decision is reported, never passed. */
export async function checkGuard(guard: Guard, text: string): Promise<GuardVerdict> {
  const outcome = await guard.router.route({
    instructions: guard.question,
    input: text,
    options: [
      { name: "flag", description: guard.flag },
      { name: "pass", description: guard.pass },
    ],
  });
  if (outcome.kind === "failed")
    return withUsage({ kind: "failed", reason: outcome.reason }, outcome.usage);
  const confidence = outcome.decision.confidence ?? 1;
  const flagProbability = outcome.decision.next === "flag" ? confidence : 1 - confidence;
  const kind = flagProbability >= guard.threshold ? "tripped" : "pass";
  return withUsage({ kind, flagProbability }, outcome.usage);
}

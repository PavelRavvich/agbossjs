import type { GuardSettings, RouterModel } from "../config/types.js";
import type { RouterEngine } from "../routers/index.js";
import type { Guard, GuardSet, GuardText } from "./types.js";

export class MissingGuardPromptError extends Error {
  override name = "MissingGuardPromptError";
}

export interface GuardsConfig {
  readonly input?: Readonly<Record<string, GuardSettings>>;
  readonly output?: Readonly<Record<string, GuardSettings>>;
}

/** Config + texts → ready guards. A configured guard without texts stops startup. */
export function buildGuards(
  config: GuardsConfig | undefined,
  texts: Readonly<Record<string, GuardText>>,
  routerFor: (name: string, model: RouterModel | undefined) => RouterEngine,
): GuardSet {
  const side = (settings: Readonly<Record<string, GuardSettings>> = {}): Guard[] =>
    Object.entries(settings).map(([name, guard]) => {
      const text = texts[name];
      if (text === undefined) throw new MissingGuardPromptError(`No texts for guard "${name}"`);
      return {
        name,
        ...text,
        threshold: guard.threshold,
        refusal: guard.refusal,
        router: routerFor(name, guard.model),
      };
    });
  return { input: side(config?.input), output: side(config?.output) };
}

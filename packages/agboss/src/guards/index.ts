/** Public API of the guards module. Guards are two-option routers with a threshold. */
export { checkGuard } from "./check.js";
export { buildGuards, MissingGuardPromptError, type GuardsConfig } from "./build.js";
export {
  NO_GUARDS,
  type Guard,
  type GuardSet,
  type GuardText,
  type GuardVerdict,
} from "./types.js";

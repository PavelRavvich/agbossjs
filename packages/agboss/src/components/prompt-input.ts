import type { FlowStateType } from "../graph/flow-state.js";
export type PromptInput = (state: FlowStateType) => Promise<string>;

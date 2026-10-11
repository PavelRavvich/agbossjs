import {
  Agent,
  provide,
  Workflow,
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
} from "../../../src/index.js";
import type { Class } from "../../../src/components/injection.js";
import type { FlowNodeClass } from "../../../src/graph/flow.js";
import type { WorkflowMeta } from "../../../src/components/meta-types.js";
import { WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import type { AppOptions } from "../../../src/app/create-app.js";
import { createMemoryLedger } from "../../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import { ScriptBook } from "../../../src/testing/script-book.js";
import { createScriptedGateway } from "../../../src/testing/scripted-gateway.js";
import {
  AuditGuardrail,
  MaskSecret,
  RemoteAgent,
  RevealTool,
  SECRET,
  SemanticInbound,
  StampAction,
  StrictJudge,
  Vault,
  VaultChannel,
  VaultDocs,
} from "./deps-contract.components.js";

/** Scripted models and in-memory stores: nothing external. */
export const offline = (book = new ScriptBook()): AppOptions => ({
  processEnv: {},
  gateway: createScriptedGateway(book),
  stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
});

@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
export class Chat {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "reply", description: "The reply", output: WorkflowFinishText })
export class Done {}

const price = { inputPerMTok: 1, outputPerMTok: 10 };

@Agent({
  name: "keeper",
  description: "Keeps the vault",
  model: "test/keeper",
  price,
  tools: [RevealTool],
  guardrails: [AuditGuardrail],
  judges: [StrictJudge],
  rag: [{ use: VaultDocs, mode: "context" }],
})
export class Keeper {}

@Agent({ name: "plain", description: "Plain", model: "test/plain", price })
export class Plain {}

class NoLimits {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

const base = {
  version: "1.0.0",
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
} satisfies Partial<WorkflowMeta>;

/** A workflow `Chat → agent → Done` with extra settings, for the assembly checks. */
export function workflowWith(
  name: string,
  extra: Partial<WorkflowMeta>,
  agent: FlowNodeClass = Plain,
): Class {
  @Workflow({ name, flow: [from(Chat).next(agent), from(agent).next(Done)], ...base, ...extra })
  class Built extends NoLimits {}
  return Built;
}

/** Every kind that takes `deps`, all wired: tool, guardrail, judge, RAG, action, PII, channel, A2A. */
@Workflow({
  name: "vault",
  flow: [from(Chat).next(Keeper), from(Keeper).next(StampAction), from(StampAction).next(Done)],
  ...base,
  piiPolicies: [MaskSecret],
  channelClasses: [VaultChannel],
  providers: [Vault, provide(SECRET, "s3cret"), SemanticInbound, RemoteAgent],
})
export class VaultWorkflow extends NoLimits {}

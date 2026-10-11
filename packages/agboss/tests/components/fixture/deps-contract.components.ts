import { A2AAgent } from "../../../src/a2a/a2a-decorator.js";
import { A2AClient } from "../../../src/a2a/a2a-client.js";
import {
  Channel,
  Guardrail,
  InboundChannelAdapter,
  PiiPolicy,
  Rag,
  SemanticInboundChannelAdapter,
  WorkflowAction,
  type ChannelHandler,
  type ChannelRequest,
  type IWorkflowAction,
} from "../../../src/components/decorators.js";
import {
  Judge,
  type JudgeHandler,
  type JudgeVerdict,
} from "../../../src/components/judge-decorators.js";
import { Injectable, InjectionToken, Tool, type ToolHandler } from "../../../src/index.js";
import { Text } from "../../../src/dto/index.js";
import type { RagRetrieval } from "../../../src/rag/types.js";

/** One component of every kind that takes `deps`, each depending on `Vault` (which depends on SECRET). */
export const SECRET = new InjectionToken<string>("SECRET");

/** What the components did with their injected dependency at run time, in order. */
export const seen: string[] = [];

@Injectable({ deps: [SECRET] })
export class Vault {
  constructor(readonly secret: string) {}
}

export class Query {
  @Text({ prompt: "what to reveal" })
  what!: string;
}

export class Revealed {
  @Text()
  text!: string;
}

@Tool({ name: "reveal", description: "Reveals", input: Query, output: Revealed, deps: [Vault] })
export class RevealTool implements ToolHandler<Query, Revealed> {
  constructor(private readonly vault: Vault) {}
  run(): Promise<Revealed> {
    return Promise.resolve({ text: this.vault.secret });
  }
}

@Guardrail({ name: "audit", deps: [Vault] })
export class AuditGuardrail implements Guardrail {
  constructor(private readonly vault: Vault) {}
  beforeAgentAnswer(): Promise<void> {
    seen.push(`guardrail:${this.vault.secret}`);
    return Promise.resolve();
  }
}

@PiiPolicy({ name: "mask-secret", deps: [Vault] })
export class MaskSecret implements PiiPolicy {
  constructor(private readonly vault: Vault) {}
  mask(text: string): Promise<string> {
    return Promise.resolve(text.replaceAll(this.vault.secret, "***"));
  }
  maskJson(obj: unknown): Promise<unknown> {
    return Promise.resolve(obj);
  }
}

@WorkflowAction({ name: "stamp", deps: [Vault] })
export class StampAction implements IWorkflowAction {
  constructor(private readonly vault: Vault) {}
  execute(): Record<string, never> {
    seen.push(`action:${this.vault.secret}`);
    return {};
  }
}

@InboundChannelAdapter({ name: "inbound", deps: [Vault] })
export class SecretInbound implements InboundChannelAdapter<string> {
  constructor(private readonly vault: Vault) {}
  interpret(input: string): Promise<{ approved: boolean }> {
    return Promise.resolve({ approved: input === this.vault.secret });
  }
}

@SemanticInboundChannelAdapter({ name: "semantic", model: "test/m", prompt: "p", deps: [Vault] })
export class SemanticInbound implements InboundChannelAdapter<string> {
  constructor(private readonly vault: Vault) {}
  interpret(input: string): Promise<{ approved: boolean }> {
    return Promise.resolve({ approved: input.includes(this.vault.secret) });
  }
}

@Channel({ name: "vault-desk", inboundAdapter: SecretInbound, deps: [Vault] })
export class VaultChannel implements ChannelHandler {
  constructor(private readonly vault: Vault) {}
  requestApproval(req: ChannelRequest): Promise<void> {
    seen.push(`channel:${req.toolName}:${this.vault.secret}`);
    return Promise.resolve();
  }
}

@Judge({ name: "strict", model: "test/strict", deps: [Vault] })
export class StrictJudge implements JudgeHandler {
  constructor(private readonly vault: Vault) {}
  judge(reply: string): Promise<JudgeVerdict> {
    return Promise.resolve({ passed: !reply.includes(this.vault.secret) });
  }
}

@Rag({ name: "docs", description: "Docs", topK: 1, deps: [Vault] })
export class VaultDocs {
  constructor(private readonly vault: Vault) {}
  retrieve(): Promise<RagRetrieval> {
    seen.push(`rag:${this.vault.secret}`);
    return Promise.resolve({ results: [{ text: "the vault", source: "vault.md" }] });
  }
}

@A2AAgent({ name: "remote", url: "http://remote.invalid", deps: [Vault] })
export class RemoteAgent extends A2AClient {
  constructor(readonly vault: Vault) {
    super();
  }
}

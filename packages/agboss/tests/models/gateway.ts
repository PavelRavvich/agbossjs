import type { ResolvedModelSettings } from "../../src/config/types.js";
import { createProviderGateway } from "../../src/llm/gateway.js";
import { CircuitBreakers, ModelProviderDirectory } from "../../src/models/index.js";
import type { ModelProviderType } from "../../src/models/model-provider.decorator.js";
import { completion, providerStub, type StubReply } from "./stub.js";

export const ENV = { OPENROUTER_API_KEY: "k" };

/** The bodies a provider gateway sends for one chat call per settings. */
export async function wireBodies(
  providers: readonly ModelProviderType[],
  calls: readonly ResolvedModelSettings[],
  replies: readonly StubReply[] = [completion()],
): Promise<Record<string, unknown>[]> {
  const stub = providerStub(replies);
  const gateway = createProviderGateway(ModelProviderDirectory.of(providers), {
    env: ENV,
    breakers: new CircuitBreakers(),
    send: stub.fetch,
  });
  for (const settings of calls) {
    await gateway.chatModel({ user: { kind: "agent", agent: "scout" }, settings }).invoke("hi");
  }
  return stub.requests.map((request) => request.body ?? {});
}

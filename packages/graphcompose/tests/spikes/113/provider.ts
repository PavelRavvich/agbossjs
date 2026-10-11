/**
 * Spike #113 — `requestFields` typed by the agent's model provider. Not framework API.
 *
 * The provider's fields are a type parameter of the class it extends
 * (`extends OpenAiCompatibleProvider<OpenRouterFields>`), so they are part of the class's type and a
 * generic `@Agent` can infer them from `overrideModelProvider`. Without it, the agent gets the
 * provider from the workflow's `settings()` — a method body the decorator cannot see — so only the
 * contract's fields are allowed.
 */
import type { Class } from "../../../src/components/injection.js";

/** The OpenAI Chat Completions contract's own request fields. */
export interface ChatCompletionFields {
  readonly top_p?: number;
  readonly seed?: number;
  readonly stop?: readonly string[];
  readonly response_format?: { readonly type: "text" | "json_object" };
}

export class OpenAiCompatibleProvider<F extends ChatCompletionFields = ChatCompletionFields> {
  /** Type only: carries `F` in the instance type so it can be inferred. Emits nothing. */
  declare readonly fieldsType: F;
  /** The provider's own fields for every call — typed by `F` when set here. */
  readonly requestFields: F | undefined = undefined;
}

type ProviderClass = abstract new (...args: never[]) => OpenAiCompatibleProvider<object>;

/** Stands for "the workflow's default provider": contract fields only. */
export class ContractOnly extends OpenAiCompatibleProvider {}

export type FieldsOf<P extends ProviderClass> =
  InstanceType<P> extends OpenAiCompatibleProvider<infer F> ? F : never;

interface AgentOptions<P extends ProviderClass> {
  readonly name: string;
  readonly model: string;
  readonly overrideModelProvider?: P;
  readonly requestFields?: NoInfer<FieldsOf<P>>;
}

const agents = new WeakMap<object, AgentOptions<ProviderClass>>();

export function Agent<P extends ProviderClass = typeof ContractOnly>(options: AgentOptions<P>) {
  return (value: Class): void => {
    agents.set(value, options);
  };
}

export const agentOptionsOf = (agent: object): AgentOptions<ProviderClass> | undefined =>
  agents.get(agent);

const providers = new WeakMap<object, object>();

/** `@ModelProvider` as #112 writes it: `requestFields` in the decorator, before the class exists. */
export function ModelProvider(options: {
  readonly name: string;
  readonly requestFields?: Readonly<Record<string, unknown>>;
}) {
  return (value: ProviderClass): void => {
    providers.set(value, options.requestFields ?? {});
  };
}

export const providerFieldsOf = (provider: object): object | undefined => providers.get(provider);

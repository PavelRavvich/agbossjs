import type { ModelProviderHandler } from "./handler.js";
import {
  modelProviderOf,
  servesModel,
  type ModelProviderOptions,
  type ModelProviderType,
} from "./model-provider.decorator.js";
import type { ModelProblem } from "./problems.js";

/** What a model is used for: a chat model (agents, compaction, LLM routers) or a decision (decision models). */
export enum ModelPurpose {
  Chat = "chat",
  Decision = "decision",
}

/** A registered provider: its options and its handler instance. */
export interface RegisteredModelProvider {
  readonly options: ModelProviderOptions;
  readonly handler: ModelProviderHandler;
}

/** Which provider serves a model, or why none can. */
export type ProviderResolution =
  | { readonly kind: "resolved"; readonly provider: RegisteredModelProvider }
  | { readonly kind: "problem"; readonly problem: ModelProblem };

/** A model's use the directory resolves: the setting's key, the model, its purpose, an override. */
export interface ProviderQuery {
  readonly key: string;
  readonly model: string;
  readonly purpose: ModelPurpose;
  /** A provider name that wins over `serves` (`overrideModelProvider`). */
  readonly override?: string;
}

const canServe = (provider: RegisteredModelProvider, purpose: ModelPurpose): boolean =>
  purpose === ModelPurpose.Chat
    ? provider.handler.chat !== undefined
    : provider.handler.routeTo !== undefined;

const names = (providers: readonly RegisteredModelProvider[]): string =>
  providers.map((provider) => provider.options.name).join(", ");

/** The workflow's model providers (`settings().modelProviders([...])`) and who serves which model. */
export class ModelProviderDirectory {
  constructor(
    readonly providers: readonly RegisteredModelProvider[],
    readonly defaultProvider?: string,
  ) {}

  /** Instantiates `@ModelProvider` classes (each constructed with no arguments). */
  static of(
    classes: readonly ModelProviderType[],
    defaultProvider?: ModelProviderType,
  ): ModelProviderDirectory {
    const providers = classes.map((cls) => ({
      options: modelProviderOf(cls),
      // a @ModelProvider class is constructed with no arguments (the decorator's type requires it)
      handler: new (cls as unknown as new () => ModelProviderHandler)(),
    }));
    return new ModelProviderDirectory(
      providers,
      defaultProvider === undefined ? undefined : modelProviderOf(defaultProvider).name,
    );
  }

  byName(name: string): RegisteredModelProvider | undefined {
    return this.providers.find((provider) => provider.options.name === name);
  }

  /** The override, else exactly one provider serving the model for its purpose (the default breaks a tie). */
  resolve(query: ProviderQuery): ProviderResolution {
    const problem = (code: ModelProblem["code"], supported: string): ProviderResolution => ({
      kind: "problem",
      problem: {
        code,
        key: query.key,
        value: query.override ?? query.model,
        model: query.model,
        supported,
      },
    });
    if (query.override !== undefined) {
      const provider = this.byName(query.override);
      if (provider === undefined)
        return problem(
          "model.no-provider",
          `no provider named "${query.override}" (registered: ${names(this.providers)})`,
        );
      if (!servesModel(provider.options, query.model) || !canServe(provider, query.purpose)) {
        return problem(
          "model.no-provider",
          `${query.override} does not serve it for ${query.purpose}`,
        );
      }
      return { kind: "resolved", provider };
    }
    const serving = this.providers.filter(
      (provider) => servesModel(provider.options, query.model) && canServe(provider, query.purpose),
    );
    const [only, ...others] = serving;
    if (only === undefined)
      return problem(
        "model.no-provider",
        `no registered provider serves it for ${query.purpose} (registered: ${names(this.providers)})`,
      );
    if (others.length === 0) return { kind: "resolved", provider: only };
    const preferred = serving.find((provider) => provider.options.name === this.defaultProvider);
    return preferred === undefined
      ? problem("model.ambiguous-provider", `served by several providers: ${names(serving)}`)
      : { kind: "resolved", provider: preferred };
  }
}

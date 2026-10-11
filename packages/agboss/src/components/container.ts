import { InjectionToken, tokenName, type Class, type Provider, type Token } from "./injection.js";
import { ComponentError, componentOf, scopeOf } from "./metadata.js";
import { runScopedProxy, type RunContainer, type ScopeOwner } from "./run-scope.js";

/** A component's constructor dependencies: every decorator kind that takes `deps` records them. */
export const depsOf = (cls: Class): readonly Token[] => {
  const meta = componentOf(cls)?.meta;
  return meta !== undefined && "deps" in meta ? meta.deps : [];
};

type Registration =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "class"; readonly cls: Class };

function registrations(
  providers: readonly Provider[],
  core: ReadonlyMap<Token, unknown>,
): Map<Token, Registration> {
  const registered = new Map<Token, Registration>();
  for (const [token, value] of core) registered.set(token, { kind: "value", value });
  for (const provider of providers) {
    if ("provide" in provider)
      registered.set(provider.provide, { kind: "value", value: provider.useValue });
    else registered.set(provider, { kind: "class", cls: provider });
  }
  return registered;
}

/** A class's dependencies as a readable tree: `JobFitJudge (ROUTER_FACTORY), JOB_SEARCH`. */
export function dependencyTree(cls: Class, providers: readonly Provider[]): string {
  const classes = new Map(
    providers.flatMap((p) => ("provide" in p ? [] : [[p as Token, p] as const])),
  );
  const render = (deps: readonly Token[]): string =>
    deps
      .map((dep) => {
        const provided = classes.get(dep);
        const inner = provided === undefined ? [] : depsOf(provided);
        return inner.length === 0 ? tokenName(dep) : `${tokenName(dep)} (${render(inner)})`;
      })
      .join(", ");
  return render(depsOf(cls));
}

/** An app-scoped component lives across runs: it cannot hold one run's instance (#184). */
const checkScope = (cls: Class, dep: Class): void => {
  if (scopeOf(cls) === "app" && scopeOf(dep) === "run") {
    throw new ComponentError(
      `[di.scope-mismatch] ${tokenName(cls)} (app) → ${tokenName(dep)} (run): give ${tokenName(cls)} scope: "run" too, or make ${tokenName(dep)} app-scoped`,
    );
  }
};

/**
 * Checks the dependency graph of `roots` without creating anything: every dependency registered,
 * no cycles, no app-scoped component depending on a run-scoped one. Errors name the component and the chain.
 */
export function checkGraph(
  roots: readonly Class[],
  providers: readonly Provider[],
  core: readonly Token[],
): void {
  const registered = registrations(providers, new Map(core.map((t) => [t, undefined])));
  const done = new Set<Token>();
  const visit = (cls: Class, chain: readonly string[]): void => {
    if (done.has(cls)) return;
    const path = [...chain, tokenName(cls)];
    if (chain.includes(tokenName(cls)))
      throw new ComponentError(`Dependency cycle: ${path.join(" → ")}`);
    for (const dep of depsOf(cls)) {
      const reg = registered.get(dep);
      if (reg === undefined) {
        throw new ComponentError(
          `${tokenName(cls)}: "${tokenName(dep)}" is not registered in @Workflow({ providers })`,
        );
      }
      if (reg.kind === "class") {
        checkScope(cls, reg.cls);
        visit(reg.cls, path);
      }
    }
    done.add(cls);
  };
  roots.forEach((root) => {
    visit(root, []);
  });
}

/**
 * A core value the app does not have (e.g. no environment): registered so the graph checks pass,
 * failing with its message — naming the component that needs it — only when something injects it.
 */
export class UnavailableValue {
  constructor(readonly message: (dependant: string) => string) {}
}

/** How one app's container differs: values that replace registrations (test mocks), a creation hook. */
export interface ContainerOptions {
  readonly overrides?: ReadonlyMap<Token, unknown>;
  /** Called with every instance the container creates (not with values or overrides). */
  readonly onCreate?: (instance: unknown) => void;
}

export interface Container extends ScopeOwner {
  readonly get: (token: Token) => unknown;
  /** Class names in creation order (dependencies before dependants). */
  readonly created: readonly string[];
}

const failIfUnavailable = (reg: Registration | undefined, dependant: string): void => {
  if (reg?.kind === "value" && reg.value instanceof UnavailableValue) {
    throw new ComponentError(reg.value.message(dependant));
  }
};

/** What a token is registered as; an unregistered class (a tool, an action) is its own registration. */
function registrationOf(
  registered: ReadonlyMap<Token, Registration>,
  token: Token,
  dependant: string,
): Registration {
  const reg = registered.get(token);
  failIfUnavailable(reg, dependant);
  if (reg === undefined && token instanceof InjectionToken) {
    throw new ComponentError(`"${tokenName(token)}" is not registered in @Workflow({ providers })`);
  }
  return reg ?? { kind: "class", cls: token as Class };
}

type Resolve = (token: Token, dependant: string) => unknown;

/** A new instance of `cls`, its dependencies resolved first. */
function construct(cls: Class, resolve: Resolve): unknown {
  const args = depsOf(cls).map((dep) => resolve(dep, tokenName(cls)));
  if (args.length === 0 && cls.length > 0 && !componentOf(cls)) {
    throw new ComponentError(
      `[di.undecorated-provider] ${tokenName(cls)} takes ${String(cls.length)} constructor argument(s) but has no @Injectable({ deps }) or similar decorator.`,
    );
  }
  return new (cls as unknown as new (...a: unknown[]) => unknown)(...args);
}

/** A run's child container: run-scoped classes are created in it, everything else comes from the app's. */
function runChildOf(registered: ReadonlyMap<Token, Registration>, app: Resolve): RunContainer {
  const instances = new Map<Token, unknown>();
  const created: unknown[] = [];
  const resolve = (token: Token, dependant: string): unknown => {
    if (instances.has(token)) return instances.get(token);
    const reg = registrationOf(registered, token, dependant);
    if (reg.kind === "value" || scopeOf(reg.cls) === "app") return app(token, dependant);
    const instance = construct(reg.cls, resolve);
    created.push(instance);
    instances.set(token, instance);
    return instance;
  };
  return { get: (token) => resolve(token, "the run"), created };
}

/**
 * Creates app-scoped components once (singletons), dependencies first; `created` records the order.
 * A run-scoped class resolves to a stand-in for the current run's instance (`runChild`, #184).
 */
export function createContainer(
  providers: readonly Provider[],
  core: ReadonlyMap<Token, unknown>,
  options: ContainerOptions = {},
): Container {
  const registered = registrations(providers, core);
  for (const [token, value] of options.overrides ?? []) {
    registered.set(token, { kind: "value", value });
  }
  const instances = new Map<Token, unknown>();
  const created: string[] = [];
  const singleton = (cls: Class): unknown => {
    const instance = construct(cls, resolve);
    created.push(tokenName(cls));
    options.onCreate?.(instance);
    return instance;
  };
  const resolve = (token: Token, dependant = "the app"): unknown => {
    if (instances.has(token)) return instances.get(token);
    const reg = registrationOf(registered, token, dependant);
    const value =
      reg.kind === "value"
        ? reg.value
        : scopeOf(reg.cls) === "run"
          ? runScopedProxy(reg.cls, container)
          : singleton(reg.cls);
    instances.set(token, value);
    return value;
  };
  const container: Container = {
    get: (token: Token): unknown => resolve(token),
    created,
    runChild: () => runChildOf(registered, resolve),
  };
  return container;
}

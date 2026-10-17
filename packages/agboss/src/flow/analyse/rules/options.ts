import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import { NodeKind } from "../../ast.js";
import type { FlowNode } from "../flow-graph.js";
import type { AnalysisContext, LoadedModule } from "./context.js";

/**
 * Shared agent options (#272 AC16): two classes of one agent spread one const declared as a static
 * object literal in an `*.options.ts` file. A decorator records its options as written, so a spread
 * keeps the const's own objects (`input`, `output`, `promptUrls`, …); the analyser finds the const by
 * those objects among the loaded modules' exports. `[agent.dynamic-options]` when the const comes
 * from another file, when an `*.options.ts` file exports a function (options built by a call), or
 * when an action or a router spreads one (`*.options.ts` is for agents only).
 */

const OPTIONS_FILE = /\.options\.[cm]?[jt]s$/;

const isOptionsFile = (file: string): boolean => OPTIONS_FILE.test(file);

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** An exported const a component's options were spread from. */
interface SpreadSource {
  readonly module: LoadedModule;
  readonly exportName: string;
}

/** The consts whose own objects the options carry (objects, not primitives, can be told apart). */
function spreadSources(options: object, modules: readonly LoadedModule[]): readonly SpreadSource[] {
  const values: readonly unknown[] = Object.values(options);
  return modules.flatMap((module) =>
    Object.entries(module.exports).flatMap(([exportName, exported]) => {
      if (!isPlainObject(exported)) return [];
      const isSpread = Object.values(exported).some(
        (field) => typeof field === "object" && field !== null && values.includes(field),
      );
      return isSpread ? [{ module, exportName }] : [];
    }),
  );
}

function spreadViolation(node: FlowNode, source: SpreadSource): RuleViolation | undefined {
  const spread = `${source.exportName} from ${source.module.file}`;
  if (node.kind !== NodeKind.Agent) {
    const message =
      `${node.name} spreads ${spread} — *.options.ts is for agents only; share logic through a ` +
      "service in deps";
    return violation("agent.dynamic-options", message, [node.name]);
  }
  if (isOptionsFile(source.module.file)) return undefined;
  const message =
    `${node.name} spreads ${spread} — shared agent options are a static object literal in an ` +
    '*.options.ts file (satisfies Omit<AgentOptions, "name" | "description">)';
  return violation("agent.dynamic-options", message, [node.name]);
}

function factoryExports(modules: readonly LoadedModule[]): readonly RuleViolation[] {
  return modules
    .filter((module) => isOptionsFile(module.file))
    .flatMap((module) =>
      Object.entries(module.exports)
        .filter(([, exported]) => typeof exported === "function")
        .map(([exportName]) => {
          const message =
            `${module.file} exports ${exportName}, a function — an *.options.ts file declares ` +
            "static object literals, never options built by a call";
          return violation("agent.dynamic-options", message, []);
        }),
    );
}

export function optionsRules(context: AnalysisContext): readonly RuleViolation[] {
  const modules = context.options.modules ?? [];
  const spreads = [...context.graph.nodes.values()].flatMap((node) =>
    spreadSources(node.declaration.options, modules).flatMap((source) => {
      const problem = spreadViolation(node, source);
      return problem === undefined ? [] : [problem];
    }),
  );
  return [...spreads, ...factoryExports(modules)];
}

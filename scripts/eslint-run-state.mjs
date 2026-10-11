// Local lint rule (#184): an app-scoped component (the default `scope: "app"`) is one instance for
// every run, so state written on `this` inside its `run()` leaks from one user's run into another's.
// Flags `this.x = …` (and `this.x++`, `this.x += …`) inside `run()` of a class decorated with a DI
// decorator whose options do not say `scope: "run"`.

const DI_DECORATORS = new Set([
  "Tool",
  "McpTool",
  "Injectable",
  "Rag",
  "WorkflowAction",
  "Channel",
  "Guardrail",
  "PiiPolicy",
  "Judge",
  "InboundChannelAdapter",
  "SemanticInboundChannelAdapter",
  "A2AAgent",
]);

const nameOf = (callee) =>
  callee.type === "Identifier"
    ? callee.name
    : callee.type === "MemberExpression" && callee.property.type === "Identifier"
      ? callee.property.name
      : undefined;

const isRunScope = (options) =>
  options.properties.some(
    (p) =>
      p.type === "Property" &&
      ((p.key.type === "Identifier" && p.key.name === "scope") ||
        (p.key.type === "Literal" && p.key.value === "scope")) &&
      p.value.type === "Literal" &&
      p.value.value === "run",
  );

/** Whether a decorator's options may make the class run-scoped (unreadable options count as maybe). */
const mayBeRunScoped = (options) =>
  options !== undefined &&
  (options.type !== "ObjectExpression" ||
    options.properties.some((p) => p.type === "SpreadElement") ||
    isRunScope(options));

/** The DI decorator's name when the class is app-scoped; undefined when it may be run-scoped or not one. */
function appScopedDecorator(cls) {
  for (const decorator of cls.decorators ?? []) {
    const call = decorator.expression;
    const name = call.type === "CallExpression" ? nameOf(call.callee) : undefined;
    if (name === undefined || !DI_DECORATORS.has(name)) continue;
    return mayBeRunScoped(call.arguments[0]) ? undefined : name;
  }
  return undefined;
}

const isRunMember = (node) =>
  (node.type === "MethodDefinition" || node.type === "PropertyDefinition") &&
  !node.static &&
  node.key.type === "Identifier" &&
  node.key.name === "run";

/** The class whose `run()` the node is in (`this` still the instance), else undefined. */
function runOwner(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (isRunMember(node)) return ancestors[i - 2];
    const isMethodBody = ancestors[i - 1]?.type === "MethodDefinition";
    if (
      (node.type === "FunctionExpression" && !isMethodBody) ||
      node.type === "FunctionDeclaration"
    )
      return undefined;
    if (node.type === "ClassBody" || node.type === "PropertyDefinition") return undefined;
  }
  return undefined;
}

const noRunStateInSingleton = {
  meta: {
    type: "problem",
    docs: { description: "No per-run state on `this` in run() of an app-scoped component" },
    messages: {
      leak: '`this.{{field}} = …` in run() of an app-scoped @{{decorator}}: the instance is shared by every run, so one run\'s data leaks into the next. Keep it in a local, or give the class scope: "run".',
    },
    schema: [],
  },
  create(context) {
    const check = (node, target) => {
      if (target.type !== "MemberExpression" || target.object.type !== "ThisExpression") return;
      const cls = runOwner(context.sourceCode.getAncestors(node));
      const decorator = cls === undefined ? undefined : appScopedDecorator(cls);
      if (decorator === undefined) return;
      const field = target.property.type === "Identifier" ? target.property.name : "[…]";
      context.report({ node, messageId: "leak", data: { field, decorator } });
    };
    return {
      AssignmentExpression: (node) => check(node, node.left),
      UpdateExpression: (node) => check(node, node.argument),
    };
  },
};

export const runStatePlugin = { rules: { "no-run-state-in-singleton": noRunStateInSingleton } };

/** The flat-config block: framework sources, examples and generator templates. */
export const runStateRules = {
  files: ["packages/agboss/src/**/*.ts", "examples/*/src/**/*.ts"],
  plugins: { agboss: runStatePlugin },
  rules: { "agboss/no-run-state-in-singleton": "error" },
};

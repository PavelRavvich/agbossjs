import ts from "typescript";
import { ScaffoldError } from "./errors.js";
import { addImport } from "./wire.js";
import type { FileToWrite } from "./write.js";

/** `from(<sources>).<method>(<args>)` in a flow. */
export interface FlowCall {
  readonly sources: ts.NodeArray<ts.Expression>;
  readonly method: string;
  readonly args: ts.NodeArray<ts.Expression>;
}

export function flowCalls(source: ts.SourceFile): FlowCall[] {
  const calls: FlowCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "from"
    ) {
      calls.push({
        sources: node.expression.expression.arguments,
        method: node.expression.name.text,
        args: node.arguments,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** The identifiers of a list (`from(A, B)` → `["A", "B"]`). */
export const namesIn = (list: ts.NodeArray<ts.Expression>): string[] =>
  list.map((item) => (ts.isIdentifier(item) ? item.text : item.getText()));

/** The star around `router`: `from(router).routes()` and the `from(<agents>).next(router)` back to it. */
export function starCalls(
  calls: readonly FlowCall[],
  router: string,
  agents: readonly string[],
): { choose: FlowCall; back: FlowCall } | undefined {
  const choose = calls.find((c) => c.method === "routes" && namesIn(c.sources).join() === router);
  const back = calls.find(
    (c) =>
      c.method === "next" &&
      namesIn(c.args).join() === router &&
      namesIn(c.sources).every((name) => agents.includes(name)),
  );
  return choose === undefined || back === undefined ? undefined : { choose, back };
}

/**
 * Puts a new agent into a star flow: `from(<agents>, Agent).next(Router)`. The router's targets are
 * its `@Router({ routes })` (`from(Router).routes()` stays empty, #200), wired in the router file. An
 * agent already there is skipped (reported, never doubled); an unexpected shape → an error naming the
 * file — never a guess.
 */
export function addAgentToFlow(
  file: FileToWrite,
  agent: string,
  router: string,
  agents: readonly string[],
): FileToWrite {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const star = starCalls(flowCalls(source), router, [...agents, agent]);
  const last = star?.back.sources.at(-1);
  if (star === undefined || last === undefined) {
    throw new ScaffoldError(
      `${file.path}: no from(${router}).routes() and from(<agents>).next(${router}) in the flow — add ${agent} by hand`,
    );
  }
  if (namesIn(star.back.sources).includes(agent)) {
    const skipped = `${file.path}: ${agent} already in from(…).next(${router})`;
    return { ...file, skipped: [...(file.skipped ?? []), skipped] };
  }
  const at = last.getEnd();
  return {
    path: file.path,
    content: `${file.content.slice(0, at)}, ${agent}${file.content.slice(at)}`,
    skipped: [...(file.skipped ?? [])],
  };
}

/** Wires an agent into the workflow's flow and imports it. */
export const wireAgentIntoFlow = (
  file: FileToWrite,
  agent: { readonly className: string; readonly from: string },
  router: string,
  agents: readonly string[],
): FileToWrite => {
  const flowed = addAgentToFlow(file, agent.className, router, agents);
  return {
    ...flowed,
    content: addImport(flowed.content, file.path, agent.className, agent.from),
  };
};

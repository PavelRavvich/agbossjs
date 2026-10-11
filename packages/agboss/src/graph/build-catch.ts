import type { FlowModel } from "./check-flow.js";
import type { NextDeclaration } from "./flow-nodes.js";
import { graphNodeId, nodeKeyed } from "./build-shared.js";
import { codeOfErrorClass, recordMatches, type ErrorRecord } from "../core/error-record.js";

/** The catch handler a caught error leads to; an unhandled error is rethrown. */
export function caughtErrorTarget(
  model: FlowModel,
  catches: readonly NextDeclaration[],
  error: ErrorRecord,
): string {
  for (const catchNode of catches) {
    if (catchNode.kind === "catch" && recordMatches(error, codeOfErrorClass(catchNode.errorType))) {
      return graphNodeId(nodeKeyed(model, catchNode.nextNode));
    }
  }
  // visitNode keeps only an error one of the node's catches matches
  throw new Error(`no catchError matches the caught ${error.code}: ${error.message}`);
}

/** The codes a node's `catchError`s catch, in declaration order (`undefined` = any error). */
export const catchCodesOf = (model: FlowModel, key: string): readonly (string | undefined)[] =>
  (model.catches.get(key) ?? []).flatMap((c) =>
    c.kind === "catch" ? [codeOfErrorClass(c.errorType)] : [],
  );

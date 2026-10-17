import { inputShapesOf, type FlowAnalysis } from "../flow/analyse/analyse.js";
import type { ResolvedField } from "../flow/analyse/fields.js";
import { NodeKind } from "../flow/ast.js";
import { shapeLabel } from "../flow/analyse/labels.js";
import { Wrapper } from "../flow/dto-wrappers.js";

/**
 * Each node's inputs and who can give them (#270 AC18), as `agboss describe` prints them:
 * `prepare-offer-action ← draft: editor-agent | draft-agent (latest), legal: legal-agent (optional)`.
 * `latest` — several producers reach the field and the newest value wins; a tagged field names its
 * tag; nothing reaches → `none`.
 */

function fieldText(field: ResolvedField, producers: readonly string[]): string {
  const notes = [
    ...(producers.length > 1 ? ["latest"] : []),
    ...(field.tag === undefined ? [] : [`tag ${field.tag}`]),
    ...(field.isRequired ? [] : ["optional"]),
  ];
  const who = producers.length === 0 ? "none" : producers.join(" | ");
  return `${field.name}: ${who}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}`;
}

/** One line per node that reads the path scope. */
export function inputLines(analysis: FlowAnalysis): readonly string[] {
  return [...analysis.fields].flatMap(([node, fields]) => {
    const shapes = inputShapesOf(analysis, node);
    const declared = fields.filter((field) => !field.isPassThrough);
    if (declared.length === 0) return [];
    const texts = declared.map((field) => {
      const producers = new Set(
        shapes.flatMap((shape) => shape.find((item) => item.name === field.name)?.producers ?? []),
      );
      return fieldText(field, [...producers].sort());
    });
    return [`${node} ← ${texts.join(", ")}`];
  });
}

/**
 * Each `about(…)` output (#271 M2): `reviewer-agent → about DraftDto: oneOf(ApprovalDto,
 * DraftChangesDto)` — what the answers are about (a new value of it outdates them), then their shape.
 */
export function aboutLines(analysis: FlowAnalysis): readonly string[] {
  return [...analysis.graph.nodes.values()].flatMap((node) => {
    const { declaration } = node;
    if (declaration.kind !== NodeKind.Agent && declaration.kind !== NodeKind.Action) return [];
    const { output } = declaration.options;
    if (output === undefined || typeof output === "function" || output.kind !== Wrapper.About)
      return [];
    return [`${node.name} → about ${shapeLabel(output.about)}: ${shapeLabel(output.shape)}`];
  });
}

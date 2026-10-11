import ts from "typescript";
import type { ImportMoves } from "./moves.js";
import {
  mergeSlots,
  renderGroup,
  slotOf,
  specifiersOf,
  type Declaration,
  type Slot,
} from "./slots.js";

/** A file after `agboss migrate imports`: its new text and what needs a look by hand. */
export interface MigratedSource {
  readonly text: string;
  readonly changed: boolean;
  readonly warnings: readonly string[];
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const isDeclaration = (node: ts.Node): node is Declaration =>
  ts.isImportDeclaration(node) || ts.isExportDeclaration(node);

/** The suppression the old deep imports needed; the new entries are allowed, so it goes too. */
const RESTRICTED_IMPORT_DISABLE =
  /^\/\/\s*eslint-disable-next-line\s+no-restricted-imports(\s+--.*)?$/;

function disableCommentStart(text: string, node: ts.Node): number | undefined {
  const last = ts.getLeadingCommentRanges(text, node.getFullStart())?.at(-1);
  if (last === undefined) return undefined;
  return RESTRICTED_IMPORT_DISABLE.test(text.slice(last.pos, last.end)) ? last.pos : undefined;
}

function slotEdit(text: string, slot: Slot): Edit {
  const { node } = slot;
  const start = (slot.touched ? disableCommentStart(text, node) : undefined) ?? node.getStart();
  if (slot.groups.length > 0)
    return { start, end: node.end, text: slot.groups.map(renderGroup).join("\n") };
  // merged into an earlier statement: its line goes
  const from = disableCommentStart(text, node) ?? start;
  if (text[node.end] === "\n") return { start: from, end: node.end + 1, text: "" };
  return { start: text[from - 1] === "\n" ? from - 1 : from, end: node.end, text: "" };
}

const stringLiteral = (node: ts.Node | undefined): ts.StringLiteral | undefined =>
  node !== undefined && ts.isStringLiteral(node) ? node : undefined;

/** The module string of an import that is not `{ … }`: namespace, bare, star, `import()`, types. */
function wholeModuleLiteral(node: ts.Node): ts.StringLiteral | undefined {
  if (isDeclaration(node))
    return (specifiersOf(node)?.length ?? 0) === 0
      ? stringLiteral(node.moduleSpecifier)
      : undefined;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    return stringLiteral(node.arguments[0]);
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return stringLiteral(node.argument.literal);
  return undefined;
}

/** Whole-module uses of a moved entry: the specifier changes; renamed names there need a look. */
function wholeModuleEdits(source: ts.SourceFile, moves: ImportMoves, warnings: string[]): Edit[] {
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    const literal = wholeModuleLiteral(node);
    if (literal !== undefined) {
      const renamed = Object.keys(moves.names[literal.text] ?? {});
      if (renamed.length > 0) {
        const { line } = source.getLineAndCharacterOfPosition(literal.getStart());
        warnings.push(
          `${source.fileName}:${String(line + 1)}: "${literal.text}" as a whole — renamed or moved there: ${renamed.join(", ")}; check them by hand`,
        );
      }
      const replacement = moves.entries[literal.text];
      if (replacement !== undefined)
        edits.push({ start: literal.getStart() + 1, end: literal.end - 1, text: replacement });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits;
}

const applyEdits = (text: string, edits: readonly Edit[]): string =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      text,
    );

/**
 * Rewrites the imports (and re-exports) of one file from the old entries to the new ones (#195):
 * names split by where they live now, renamed names imported under their new name with the old local
 * name kept (`RouterEngine as Router`), statements from the same entry merged, and the
 * `no-restricted-imports` suppressions the old deep imports needed removed.
 */
export function migrateImports(text: string, fileName: string, moves: ImportMoves): MigratedSource {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const slots = source.statements
    .filter(isDeclaration)
    .flatMap((node) => slotOf(node, moves) ?? []);
  const warnings: string[] = [];
  const edits = [
    ...[...mergeSlots(slots)].map((slot) => slotEdit(text, slot)),
    ...wholeModuleEdits(source, moves, warnings),
  ];
  const migrated = applyEdits(text, edits);
  return { text: migrated, changed: migrated !== text, warnings };
}

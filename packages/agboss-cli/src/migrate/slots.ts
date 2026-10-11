import ts from "typescript";
import { moveOf, type ImportMoves } from "./moves.js";

export type Declaration = ts.ImportDeclaration | ts.ExportDeclaration;
type Specifier = ts.ImportSpecifier | ts.ExportSpecifier;

/** One `import { … } from "…"` (or `export`) a statement becomes. */
export interface Group {
  /** `import type|agboss`: statements with the same key merge */
  readonly key: string;
  readonly head: string;
  readonly module: string;
  readonly elements: string[];
}

/** A named import / export statement of the file and what it becomes. */
export interface Slot {
  readonly node: Declaration;
  /** some of its names moved */
  readonly touched: boolean;
  groups: Group[];
}

export const moduleOf = (node: Declaration): string | undefined => {
  const specifier = node.moduleSpecifier;
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
};

/** The `{ … }` of a named import / export; undefined for default, namespace, star and bare forms. */
export function specifiersOf(node: Declaration): readonly Specifier[] | undefined {
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    return clause !== undefined && ts.isNamedExports(clause) ? clause.elements : undefined;
  }
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  if (clause?.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings))
    return undefined;
  return bindings.elements;
}

const headOf = (node: Declaration): string => {
  const typeOnly = ts.isImportDeclaration(node)
    ? node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    : node.isTypeOnly;
  return `${ts.isImportDeclaration(node) ? "import" : "export"}${typeOnly ? " type" : ""}`;
};

/** The element under its new name, keeping the local (or exported) name: `RouterEngine as Router`. */
function movedText(specifier: Specifier, name: string): string {
  const local = specifier.name.text;
  return `${specifier.isTypeOnly ? "type " : ""}${name}${name === local ? "" : ` as ${local}`}`;
}

function groupIn(groups: Map<string, Group>, head: string, module: string): Group {
  const key = `${head}|${module}`;
  const existing = groups.get(key);
  if (existing !== undefined) return existing;
  const group: Group = { key, head, module, elements: [] };
  groups.set(key, group);
  return group;
}

/** One element of the statement: its text after the move and the entry it comes from now. */
function elementOf(specifier: Specifier, module: string, moves: ImportMoves) {
  const name = (specifier.propertyName ?? specifier.name).text;
  const move = moveOf(moves, module, name);
  return move === undefined
    ? { text: specifier.getText(), entry: module, moved: false }
    : { text: movedText(specifier, move.name ?? name), entry: move.entry, moved: true };
}

/** The statement's names grouped by where they live now; undefined when it has no `{ … }`. */
export function slotOf(node: Declaration, moves: ImportMoves): Slot | undefined {
  const module = moduleOf(node);
  const specifiers = specifiersOf(node);
  if (module === undefined || specifiers === undefined || specifiers.length === 0) return undefined;
  const head = headOf(node);
  const groups = new Map<string, Group>();
  const elements = specifiers.map((specifier) => elementOf(specifier, module, moves));
  for (const { text, entry } of elements) {
    const group = groupIn(groups, head, entry);
    if (!group.elements.includes(text)) group.elements.push(text);
  }
  return { node, touched: elements.some((e) => e.moved), groups: [...groups.values()] };
}

/**
 * Merges statements that now import from the same entry into the first of them (only where a moved
 * name is involved: other duplicate imports of the file stay as they are). Answers the changed slots.
 */
export function mergeSlots(slots: readonly Slot[]): Set<Slot> {
  const owners = new Map<string, { readonly slot: Slot; readonly group: Group }>();
  const changed = new Set(slots.filter((slot) => slot.touched));
  for (const slot of slots) {
    for (const group of [...slot.groups]) {
      const owner = owners.get(group.key);
      if (owner === undefined) owners.set(group.key, { slot, group });
      if (owner === undefined || !(owner.slot.touched || slot.touched)) continue;
      group.elements
        .filter((element) => !owner.group.elements.includes(element))
        .forEach((element) => owner.group.elements.push(element));
      slot.groups = slot.groups.filter((other) => other !== group);
      changed.add(slot).add(owner.slot);
    }
  }
  return changed;
}

export const renderGroup = (group: Group): string =>
  `${group.head} { ${group.elements.join(", ")} } from "${group.module}";`;

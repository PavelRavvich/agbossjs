/**
 * Tarjan's strongly connected components of a directed graph, given by its vertices and each
 * vertex's successors. The flow's cycles (`[graph.cycle-without-max-visits]`) and the cycles of
 * classes built from each other (`[io.ambiguous-cycle]`, #271) are both read from it. Each component
 * is sorted; the components come in Tarjan's order.
 */
export function stronglyConnected<TVertex extends string>(
  vertices: readonly TVertex[],
  successors: (vertex: TVertex) => readonly TVertex[],
): readonly (readonly TVertex[])[] {
  const index = new Map<TVertex, number>();
  const low = new Map<TVertex, number>();
  const stack: TVertex[] = [];
  const onStack = new Set<TVertex>();
  const components: TVertex[][] = [];
  const visit = (vertex: TVertex): void => {
    index.set(vertex, index.size);
    low.set(vertex, index.get(vertex) ?? 0);
    stack.push(vertex);
    onStack.add(vertex);
    for (const next of successors(vertex)) {
      if (!index.has(next)) visit(next);
      if (onStack.has(next)) low.set(vertex, Math.min(low.get(vertex) ?? 0, low.get(next) ?? 0));
    }
    if (low.get(vertex) !== index.get(vertex)) return;
    const component: TVertex[] = [];
    for (let top = stack.pop(); top !== undefined; top = top === vertex ? undefined : stack.pop()) {
      onStack.delete(top);
      component.push(top);
    }
    components.push(component.sort());
  };
  for (const vertex of vertices) if (!index.has(vertex)) visit(vertex);
  return components;
}

/** Whether a component is a cycle: two or more vertices, or one with an edge to itself. */
export const isCycle = <TVertex extends string>(
  component: readonly TVertex[],
  successors: (vertex: TVertex) => readonly TVertex[],
): boolean =>
  component.length > 1 || component.some((vertex) => successors(vertex).includes(vertex));

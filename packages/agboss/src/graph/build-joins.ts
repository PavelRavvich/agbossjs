import { END, Send } from "@langchain/langgraph";
import type { FlowModel } from "./check-flow.js";
import type { FlowNodeRef } from "./flow-nodes.js";
import type { FlowStateType } from "./flow-state.js";
import { graphNodeId, nodeKeyed, type Builder } from "./build-shared.js";

interface JoinBarrier {
  target: FlowNodeRef;
  sources: FlowNodeRef[];
  type: "join" | "joinAny" | "joinQuorum";
  count?: number;
}

/** Join barriers by target key, with the nodes that feed them. */
function collectJoins(model: FlowModel): Map<string, JoinBarrier> {
  const joins = new Map<string, JoinBarrier>();
  for (const t of model.collected.transitions) {
    if (t.next.kind === "join") {
      const targetNode = nodeKeyed(model, t.next.target);
      if (!joins.has(targetNode.key)) {
        // A `join` declaration carries no count (joinAny / joinQuorum never reach here, see #180).
        joins.set(targetNode.key, { target: targetNode, sources: [], type: t.next.kind });
      }
      const join = joins.get(targetNode.key);
      if (join !== undefined) join.sources.push(nodeKeyed(model, t.from));
    }
  }
  return joins;
}

/** Whether the barrier lets its target run (`join` waits for all, `joinAny` for one). */
function barrierOpen(join: JoinBarrier, state: FlowStateType): boolean {
  const arrived = (src: FlowNodeRef): boolean => state.forks[src.key] !== undefined;
  if (join.type === "joinAny") return join.sources.some(arrived);
  if (join.type === "joinQuorum") return join.sources.filter(arrived).length >= (join.count ?? 1);
  // default join (all)
  return join.sources.every(arrived);
}

function wireJoinBarrier(builder: Builder, join: JoinBarrier): void {
  const targetId = graphNodeId(join.target);
  const barrierId = `join-barrier.${targetId}`;
  const waitId = `join-wait.${targetId}`;

  builder.addNode(waitId, () => ({}));
  builder.addEdge(waitId, END);

  builder.addNode(barrierId, () => ({}));
  builder.addConditionalEdges(barrierId, (state) =>
    barrierOpen(join, state) ? [targetId] : [waitId],
  );

  for (const src of join.sources) {
    const wrapperId = `join-wrap.${targetId}.${src.key}`;
    builder.addNode(wrapperId, (state) => {
      const lastContrib = [...state.contributions].reverse().find((c) => c.agent === src.name);
      return {
        forks: {
          [src.key]: { data: lastContrib?.content ?? "", name: src.name, status: "completed" },
        },
      };
    });
    builder.addEdge(wrapperId, barrierId);
  }
}

export function compileJoinBarriers(builder: Builder, model: FlowModel): void {
  const joins = collectJoins(model);

  // Add global skip-wrap
  builder.addNode("skip-wrap", () => ({}));
  if (joins.size === 0) {
    builder.addEdge("skip-wrap", END);
  } else {
    builder.addConditionalEdges("skip-wrap", (state) =>
      [...joins.values()].map((j) => new Send(`join-barrier.${graphNodeId(j.target)}`, state)),
    );
  }

  for (const join of joins.values()) wireJoinBarrier(builder, join);
}

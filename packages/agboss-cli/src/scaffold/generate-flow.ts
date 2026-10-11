import { ScaffoldError } from "./errors.js";
import { finishRoute, routeLine, routerFile, type RouterFileSpec } from "./flow-files.js";
import type { GenerateOptions } from "./generate.js";
import { namesOf } from "./names.js";
import { agentFiles } from "./plan.js";
import { read } from "./project-files.js";
import { wireInto } from "./wire.js";
import { starCalls, wireAgentIntoFlow } from "./wire-flow.js";
import {
  finishOf,
  folderOf,
  importPath,
  ofKind,
  workflowGraph,
  type Component,
  type WorkflowGraph,
} from "./workflow-graph.js";
import type { Changes } from "./write.js";

const classNames = (graph: WorkflowGraph, decorator: string): string[] =>
  ofKind(graph, decorator).map((c) => c.className);

/** The router the agents go back to: `from(R).routes()` and `from(<agents>).next(R)` (#197). */
function starRouterOf(graph: WorkflowGraph): Component {
  const agents = classNames(graph, "Agent");
  const routers = ofKind(graph, "Router").filter(
    (r) => starCalls(graph.flow, r.className, agents) !== undefined,
  );
  const [router] = routers;
  if (router === undefined || routers.length > 1) {
    const found = routers.length === 0 ? "no" : routers.map((r) => r.className).join(", ");
    throw new ScaffoldError(
      `${graph.module.path}: expected one router the agents go back to (from(Router).routes() and from(<agents>).next(Router)), found ${found} — add the agent by hand`,
    );
  }
  return router;
}

/**
 * `agboss g agent <name> --workflow …`: the agent and its prompt next to the workflow's agents; the agent
 * joins the star — a route in the router the agents go back to (before the finish route) and the
 * transition back to it in the flow (`from(Router).routes()` reads the router's routes, #200). Resolved from the workflow module, whatever the layout.
 */
export function planAgent(root: string, name: string, o: GenerateOptions): Changes {
  const graph = workflowGraph(root, o.workflow, "agent");
  const router = starRouterOf(graph);
  const n = namesOf(name);
  const description = o.description ?? `${n.title} (TODO: describe the role)`;
  const folder = folderOf(graph, "Agent", "agents");
  const path = `${folder}/${n.kebab}.agent.ts`;
  const className = `${n.pascal}Agent`;
  const agents = classNames(graph, "Agent");
  return {
    create: agentFiles(folder, n, description, []),
    modify: [
      wireAgentIntoFlow(
        graph.module,
        { className, from: importPath(graph.module.path, path) },
        router.className,
        agents,
      ),
      wireInto(read(root, router.path), {
        decorator: "Router",
        property: "routes",
        element: routeLine(className, description),
        name: className,
        from: importPath(router.path, path),
        before: classNames(graph, "WorkflowFinish"),
      }),
    ],
  };
}

/**
 * `agboss g router <name> --workflow …`: a router with the route to the workflow's finish, next to its
 * routers, ready for routes of its own. It is not put into the flow — where it sits is a choice.
 */
export function planRouter(root: string, name: string, o: GenerateOptions): Changes {
  const graph = workflowGraph(root, o.workflow, "router");
  const finish = finishOf(graph);
  const n = namesOf(name);
  const folder = folderOf(graph, "Router", "routers");
  const text: RouterFileSpec = {
    description: o.description ?? `${n.title} (TODO: say what it decides)`,
    prompt: "TODO: say how to choose between the routes.",
    maxVisits: 1,
  };
  const route = finishRoute(
    finish.className,
    importPath(`${folder}/${n.kebab}.router.ts`, finish.path),
  );
  return { create: [routerFile(folder, n, text, [route])], modify: [] };
}

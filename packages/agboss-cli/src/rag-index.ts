import { loadWorkflow } from "agboss";
import { loadOptions, textOption, workflowPath, type CommandHandler } from "./cli/context.js";
import { cliEnvironment } from "./cli/environment.js";

/** `agboss rag:index --workflow <path> [--kb <name>]` — builds or updates the knowledge-base indexes. */
export const handle: CommandHandler = async (context) => {
  const kb = textOption(context.values, "kb");
  const bundle = await loadWorkflow(workflowPath(context), loadOptions(context));
  const environment = await cliEnvironment(context, workflowPath(context));
  const services = {
    router: (name: string) => ({
      name,
      route: () => Promise.reject(new Error("rag:index does not route")),
    }),
    ...(environment === undefined ? {} : { environment }),
  };
  const bases = (bundle.knowledgeBases?.(services) ?? []).filter(
    (base) => kb === undefined || base.name === kb,
  );
  if (bases.length === 0)
    context.say(
      `No knowledge bases in "${bundle.config.name}"${kb === undefined ? "" : ` named ${kb}`}.`,
    );
  const indexed = [];
  for (const { name, connector } of bases) {
    if (connector.index === undefined) {
      context.say(`${name}: no index to build (the connector has none)`);
      continue;
    }
    const report = await connector.index();
    indexed.push({ name, ...report });
    context.say(
      `${name}: ${String(report.documents)} documents, ${String(report.chunks)} chunks, ${String(report.skipped)} unchanged · $${(report.costUsd ?? 0).toFixed(6)}`,
    );
  }
  return { result: { indexed } };
};

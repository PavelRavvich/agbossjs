import { MemorySaver } from "@langchain/langgraph";
import { buildApp } from "../../../src/app/create-app.js";
import type { ExecutionOutput } from "../../../src/app/types.js";
import { workflowOf } from "../../../src/components/assemble.js";
import type { Class } from "../../../src/components/injection.js";
import type { WorkflowStartClass } from "../../../src/graph/workflow-start.decorator.js";
import { createMemoryLedger } from "../../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import { McpStubs, stubbedMcpConnect } from "../../../src/testing/mcp-stubs.js";
import { ScriptBook } from "../../../src/testing/script-book.js";
import { createScriptedGateway } from "../../../src/testing/scripted-gateway.js";
import { Cassette } from "../../../src/testing/vcr-cassette.js";
import { vcrGateway } from "../../../src/testing/vcr.js";
import { ChatStart, Desk } from "./desk.workflow.js";

/**
 * Records a run of Desk into `file` the way `vcr: { mode: RECORD }` does, with the scripted
 * models standing in for the real providers (no key here): what replay must reproduce.
 */
export function recordDesk(
  file: string,
  text: string,
  script: (book: ScriptBook) => void,
): Promise<ExecutionOutput> {
  return recordRun({ workflow: Desk, start: ChatStart }, file, text, script);
}

/** Records a run of any workflow from `start` into `file`, the scripted models standing in. */
export async function recordRun(
  { workflow, start }: { readonly workflow: Class; readonly start: WorkflowStartClass },
  file: string,
  text: string,
  script: (book: ScriptBook) => void,
): Promise<ExecutionOutput> {
  const book = new ScriptBook();
  script(book);
  const { app } = await buildApp(await workflowOf(workflow), {
    processEnv: {},
    gateway: vcrGateway(Cassette.recording(file), () => createScriptedGateway(book)),
    connectMcp: stubbedMcpConnect(new McpStubs(book), new Map(), new Set()),
    stores: {
      checkpointer: new MemorySaver(),
      ledger: createMemoryLedger(),
      terns: createSqliteTernStore(":memory:"),
    },
    newRunId: () => "run-1",
  });
  try {
    return await app.execute(start, { text });
  } finally {
    await app.close();
  }
}

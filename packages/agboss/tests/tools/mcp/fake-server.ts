import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface FakeTool {
  readonly name: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly call: (args: Record<string, unknown>) => Record<string, unknown>;
}

/** In-memory MCP server: no process, no network. Returns the client side of the link. */
export async function fakeMcpServer(tools: readonly FakeTool[]): Promise<Transport> {
  const mcp = new McpServer({ name: "fake", version: "1.0.0" }, { capabilities: { tools: {} } });
  const server = mcp.server; // low-level handlers: tests need raw JSON Schemas
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, inputSchema, outputSchema }) => ({
      name,
      inputSchema: { type: "object", ...inputSchema },
      ...(outputSchema ? { outputSchema: { type: "object", ...outputSchema } } : {}),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name);
    if (tool === undefined)
      return { content: [{ type: "text", text: "no such tool" }], isError: true };
    return tool.call(request.params.arguments ?? {});
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  return clientSide;
}

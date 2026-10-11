import type { Class } from "../components/injection.js";
import { recordComponent } from "../components/metadata.js";

export interface McpExposeOptions {
  readonly name: string;
  readonly version: string;
  readonly exports: readonly Class[];
}

/**
 * `@McpExpose` — what a workflow exposes as an MCP server (its name, version and exported tools).
 * Put it on an empty class and pass it to `createMcpService(app, ConfigClass)` to serve the app over
 * stdio or HTTP. Not to be confused with `@McpServer`, an MCP server the workflow *uses* (#195).
 */
export function McpExpose(options: McpExposeOptions) {
  return <C extends Class>(target: C): C => {
    recordComponent(target, { kind: "mcp-expose", meta: options });
    return target;
  };
}

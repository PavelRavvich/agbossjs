/**
 * Spike #113, items 2 and 3 — `@Tool({ input, output })` agrees with `run`, and `callTool(Tool, {…})`
 * checks the arguments. Every `@ts-expect-error` below must stay an error (`tsc` in `make check`).
 */
import { describe, expect, it } from "vitest";
import { Text } from "./dto.js";
import { Tool, callTool, toolRecordOf, type ToolHandler } from "./tool.js";

class FileRead {
  @Text()
  path!: string;
}
class FolderRead {
  @Text()
  path!: string;
}
class FileWrite {
  @Text()
  path!: string;
  @Text()
  content!: string;
}
class FileWritten {
  @Text()
  path!: string;
}

@Tool({ name: "write-file", input: FileWrite, output: FileWritten })
class WriteFileTool implements ToolHandler<FileWrite, FileWritten> {
  run(file: FileWrite): Promise<FileWritten> {
    return Promise.resolve({ path: file.path });
  }
}

@Tool({ name: "read-file", input: FileRead, output: FileWritten })
class ReadFileTool implements ToolHandler<FileRead, FileWritten> {
  constructor(private readonly root: string) {}
  run(request: FileRead): Promise<FileWritten> {
    return Promise.resolve({ path: `${this.root}/${request.path}` });
  }
}

// @ts-expect-error — `run` needs FileWrite, but `input` is FileRead (no `content`)
@Tool({ name: "narrow-run", input: FileRead, output: FileWritten })
class NarrowRun implements ToolHandler<FileWrite, FileWritten> {
  run(file: FileWrite): Promise<FileWritten> {
    return Promise.resolve({ path: file.content });
  }
}

// @ts-expect-error — `run` returns FileWritten, but `output` FileWrite needs `content`
@Tool({ name: "wrong-output", input: FileRead, output: FileWrite })
class WrongOutput {
  run(request: FileRead): Promise<FileWritten> {
    return Promise.resolve({ path: request.path });
  }
}

// @ts-expect-error — `implements` agrees with `run`, but the decorator's `input` does not
@Tool({ name: "implements-disagrees", input: FileRead, output: FileWritten })
class ImplementsDisagrees implements ToolHandler<FileWrite, FileWritten> {
  run(file: FileWrite): Promise<FileWritten> {
    return Promise.resolve({ path: file.path });
  }
}

/** NOT caught: DTOs are compared by shape, so FolderRead ≡ FileRead. */
@Tool({ name: "same-shape", input: FolderRead, output: FileWritten })
class SameShape implements ToolHandler<FileRead, FileWritten> {
  run(request: FileRead): Promise<FileWritten> {
    return Promise.resolve({ path: request.path });
  }
}

/** Not a tool at all: no `@Tool`. `callTool` still accepts it — only startup / the test run can tell. */
class Undecorated implements ToolHandler<FileRead, FileWritten> {
  run(request: FileRead): Promise<FileWritten> {
    return Promise.resolve({ path: request.path });
  }
}

function scriptedMoves(): unknown[] {
  return [
    callTool(WriteFileTool, { path: "a.ts", content: "…" }),
    callTool(ReadFileTool, { path: "a.ts" }),
    // @ts-expect-error — `content` missing
    callTool(WriteFileTool, { path: "a.ts" }),
    // @ts-expect-error — `path` is a string
    callTool(WriteFileTool, { path: 1, content: "…" }),
    // @ts-expect-error — no field `file` in FileWrite (excess property)
    callTool(WriteFileTool, { path: "a.ts", content: "…", file: "b.ts" }),
    callTool(Undecorated, { path: "a.ts" }),
  ];
}

describe("spike #113 — @Tool and callTool", () => {
  it("records input and output DTOs for the runtime", () => {
    expect(toolRecordOf(WriteFileTool)).toEqual({
      name: "write-file",
      input: FileWrite,
      output: FileWritten,
    });
    expect(toolRecordOf(Undecorated)).toBeUndefined();
  });

  it("builds scripted moves typed by the tool's input", () => {
    expect(scriptedMoves()).toHaveLength(6);
    expect([NarrowRun, WrongOutput, ImplementsDisagrees, SameShape]).toHaveLength(4);
  });
});

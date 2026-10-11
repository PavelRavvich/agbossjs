import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { cleanLine, onInterruptKey, type KeyInput } from "../../src/cli/keys.js";
import { askMessage } from "../../src/cli/multiline.js";

function terminal(): KeyInput & {
  emit: (event: string, chunk: string) => boolean;
  modes: boolean[];
} {
  const events = new EventEmitter();
  const modes: boolean[] = [];
  return {
    isTTY: true,
    isRaw: false,
    setRawMode: (mode: boolean) => modes.push(mode),
    on: (event, listener) => events.on(event, listener),
    off: (event, listener) => events.off(event, listener),
    emit: (event, chunk) => events.emit(event, chunk),
    modes,
  };
}

describe("interrupt keys", () => {
  it("Esc and Ctrl+C interrupt; arrow keys and letters do not; raw mode is restored", () => {
    const input = terminal();
    const onInterrupt = vi.fn();

    const stop = onInterruptKey(input, onInterrupt);
    input.emit("data", "\u001b[A");
    input.emit("data", "x");
    input.emit("data", "\u001b");
    input.emit("data", "\u0003");
    stop();
    input.emit("data", "\u001b");

    expect(onInterrupt).toHaveBeenCalledTimes(2);
    expect(input.modes).toEqual([true, false]);
  });

  it("does nothing without a terminal", () => {
    const onInterrupt = vi.fn();

    onInterruptKey({ on: vi.fn(), off: vi.fn() }, onInterrupt)();

    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("drops escape sequences typed during a turn from the next line", () => {
    expect(cleanLine("\u001b\u001b[Ahello\u0003")).toBe("hello");
  });
});

describe("multi-line messages", () => {
  const asking = (...lines: (string | undefined)[]) => vi.fn(() => Promise.resolve(lines.shift()));

  it("joins lines ending with a backslash", async () => {
    const ask = asking("line one\\", "line two\\", "line three");

    expect(await askMessage(ask, "you › ")).toBe("line one\nline two\nline three");
    expect(ask).toHaveBeenCalledWith("… ");
  });

  it("keeps what was typed when input ends mid-message", async () => {
    expect(await askMessage(asking("first\\", undefined), "you › ")).toBe("first");
    expect(await askMessage(asking(undefined), "you › ")).toBeUndefined();
  });
});

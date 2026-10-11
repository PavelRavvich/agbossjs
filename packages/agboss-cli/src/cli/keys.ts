/** The terminal input the chat reads keys from (process.stdin on a TTY). */
export interface KeyInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  readonly setRawMode?: (mode: boolean) => unknown;
  readonly on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  readonly off: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
}

/** Esc alone (not an arrow key's escape sequence) and Ctrl+C. */
const INTERRUPT_KEYS = new Set(["\u001b", "\u0003"]);

/**
 * While a turn runs: Esc or Ctrl+C calls `onInterrupt`. Puts the terminal in raw mode to see single
 * keys and restores it when the returned function is called. No-op when input is not a terminal.
 */
export function onInterruptKey(input: KeyInput, onInterrupt: () => void): () => void {
  if (input.isTTY !== true || input.setRawMode === undefined) return () => undefined;
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  const onData = (chunk: Buffer | string): void => {
    if (INTERRUPT_KEYS.has(chunk.toString())) onInterrupt();
  };
  input.on("data", onData);
  return () => {
    input.off("data", onData);
    input.setRawMode?.(wasRaw);
  };
}

const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const STRAY_KEYS = new RegExp(`${ESC}(\\[[0-9;]*[A-Za-z])?|${CTRL_C}`, "g");

/** Keys pressed while a turn ran end up in the line buffer — drop escape sequences and Ctrl+C. */
export const cleanLine = (line: string): string => line.replace(STRAY_KEYS, "");

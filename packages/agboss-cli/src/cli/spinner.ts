/** Where the spinner draws: a stream that may be a terminal. */
export interface SpinnerOutput {
  readonly isTTY?: boolean;
  readonly write: (text: string) => unknown;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CLEAR_LINE = "\r\u001b[2K";

/** Shows `⠋ label… 3.2s` while `work` runs, then erases the line. Silent when not a terminal. */
export async function withSpinner<T>(
  out: SpinnerOutput,
  label: string,
  work: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  if (out.isTTY !== true) return work();
  const started = now();
  let frame = 0;
  const draw = (): void => {
    const seconds = ((now() - started) / 1000).toFixed(1);
    out.write(`${CLEAR_LINE}${FRAMES[frame % FRAMES.length] ?? ""} ${label}… ${seconds}s`);
    frame += 1;
  };
  draw();
  const timer = setInterval(draw, 100);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    out.write(CLEAR_LINE);
  }
}

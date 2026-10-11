const BOM = /^\uFEFF/;
const LINE_BREAK = /\r\n?/g;
const BLANK_LINE = /^[ \t]*$/;

/**
 * The text that is sent (and fingerprinted): BOM removed, line breaks as `\n`, Unicode NFC, blank
 * lines at the edges removed. Kept as written: indentation, spaces inside a line, tabs, blank lines
 * between paragraphs.
 */
export function normalisePromptText(text: string): string {
  const lines = text.replace(BOM, "").replace(LINE_BREAK, "\n").normalize("NFC").split("\n");
  const first = lines.findIndex((line) => !BLANK_LINE.test(line));
  if (first === -1) return "";
  const last = lines.findLastIndex((line) => !BLANK_LINE.test(line));
  return lines.slice(first, last + 1).join("\n");
}

/** Parts of one text (inline `prompt` first, then files in order), joined with one blank line. */
export const joinPromptParts = (parts: readonly string[]): string =>
  parts
    .map(normalisePromptText)
    .filter((part) => part !== "")
    .join("\n\n");

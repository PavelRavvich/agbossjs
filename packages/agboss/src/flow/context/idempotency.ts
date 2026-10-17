/** What one operation's idempotency key is built from (#280 Q43). */
export interface IdempotencyKeyParts {
  readonly executionId: string;
  readonly nodeId: string;
  readonly visitNumber: number;
  readonly itemIndex?: number | undefined;
  readonly callId?: string | undefined;
}

/**
 * `${executionId}:${nodeId}:${visitNumber}[:${itemIndex}][:${callId}]` — unique per operation:
 * every pass of a cycle, every item and every tool call has its own; a retry, a judge's retry and a
 * resume keep it, so an external service recognises the repeat.
 */
export function idempotencyKeyOf(parts: IdempotencyKeyParts): string {
  const { executionId, nodeId, visitNumber, itemIndex, callId } = parts;
  const item = itemIndex === undefined ? "" : `:${String(itemIndex)}`;
  const call = callId === undefined ? "" : `:${callId}`;
  return `${executionId}:${nodeId}:${String(visitNumber)}${item}${call}`;
}

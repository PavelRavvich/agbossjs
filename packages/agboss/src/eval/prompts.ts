/** Jev judge question and options — the eval's own prompt, not part of agents' versions. */
export const JUDGE_INSTRUCTIONS = "Is the replyWith an adequate response to the task?";
export const ADEQUATE = "The replyWith correctly and fully addresses the task.";
export const INADEQUATE = "The replyWith is wrong, incomplete, off-topic or empty.";

/** Pairwise comparison of two answers to the same task (order randomised by the caller). */
export const PAIR_INSTRUCTIONS = "Which replyWith addresses the task better?";
export const FIRST_BETTER = "Answer 1 addresses the task better.";
export const SECOND_BETTER = "Answer 2 addresses the task better.";

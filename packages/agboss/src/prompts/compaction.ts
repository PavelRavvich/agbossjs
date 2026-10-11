/** Default prompt of conversation compaction (a workflow may override it). Part of the prompt version. */
export const DEFAULT_COMPACTION_PROMPT = [
  "You compact part of a conversation between a user and an assistant into one memory note.",
  "Summarise ONLY the turns under `Turns to compact`. `Earlier turns` are context for resolving",
  "references — do not summarise them.",
  "The note must be self-contained: name people, companies, products and files in full; never use",
  "pronouns or words like 'it', 'he', 'that one' that point outside the note.",
  "Keep: facts about whoever started the run, decisions made, answers given, preferences, open questions and",
  "anything they may refer to later. Drop greetings and repetition. Plain text, at most 12 short lines.",
].join("\n");

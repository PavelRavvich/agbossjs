import { Agent } from "agboss";
import { GreenhouseJobs } from "../tools/greenhouse-jobs.tool.js";
import { CompanyNotes } from "../rag/company-notes.rag.js";
import { KIMI } from "../config/settings.js";

@Agent({
  name: "scout",
  promptUrls: ["./scout.prompt.md"],
  description:
    "Searches Greenhouse with the agreed search brief and returns the best-fitting jobs with links",
  model: KIMI,
  // a ceiling: a model stuck in a repetition loop stops here instead of generating for minutes
  maxTokens: 4000,
  // ranking is Jev's job; the scout only filters and formats — no reasoning to pay for
  thinking: "none",
  tools: [GreenhouseJobs],
  rag: [{ use: CompanyNotes, mode: "tool" }],
})
export class Scout {}

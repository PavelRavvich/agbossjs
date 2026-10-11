import "dotenv/config";
import { studioGraphOf } from "agboss";
import { JobScout } from "./job-scout.workflow.js";

/** job-scout in LangGraph Studio (`npm run studio` at the repo root; see langgraph.json). */
export const graph = await studioGraphOf(JobScout);

import { WorkflowFinishTextDto } from "agboss/dto";
import { WorkflowFinish } from "agboss";

/** Where a turn of the chat finishes: the answer sent back to the job seeker. */
@WorkflowFinish({
  name: "chat",
  description: "The answer sent back to the job seeker",
  output: WorkflowFinishTextDto,
})
export class ChatWorkflowFinish {}

import { WorkflowStartTextDto } from "agboss/dto";
import { WorkflowStart } from "agboss";

/** Where a turn of the chat starts: the job seeker's message. */
@WorkflowStart({
  name: "chat-workflow-start",
  description: "A message from the job seeker",
  input: WorkflowStartTextDto,
})
export class ChatWorkflowStart {}

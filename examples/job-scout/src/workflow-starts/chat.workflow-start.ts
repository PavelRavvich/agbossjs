import { WorkflowStartText } from "agboss/dto";
import { WorkflowStart } from "agboss";

/** Where a turn of the chat starts: the job seeker's message. */
@WorkflowStart({
  name: "chat",
  description: "A message from the job seeker",
  input: WorkflowStartText,
})
export class ChatWorkflowStart {
  declare readonly input: WorkflowStartText;
}

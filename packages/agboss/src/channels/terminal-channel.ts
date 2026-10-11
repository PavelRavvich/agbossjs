import { inspect } from "node:util";
import { Channel, type ChannelHandler, type ChannelRequest } from "../components/decorators.js";

@Channel({
  name: "terminal-user-channel",
  description: "Asks the user via terminal standard output and waits for CLI input",
})
export class TerminalUserChannel implements ChannelHandler {
  /** Prints the request; `agboss chat` then asks for the decision and resumes the run itself. */
  requestApproval = async (req: ChannelRequest): Promise<void> => {
    const lines = [
      "",
      `[APPROVAL REQUIRED] Tool '${req.toolName}' wants to run in Agent '${req.agentName}' (run ${req.runId}).`,
      `Arguments: ${inspect(req.toolArguments, { depth: 4 })}`,
      "Answer the prompt in this terminal, or from code: app.resume(thread, { approved, by }).",
      "",
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  };
}

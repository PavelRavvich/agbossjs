import type { ChannelHandler, InboundChannelAdapter } from "./decorators.js";
import type { Class } from "./injection.js";
import { ComponentError, componentOf, requireComponent } from "./metadata.js";
import type { WorkflowMeta } from "./meta-types.js";
import { containerFor } from "./runtime.js";
import type { AssembledWorkflow, WorkflowServices } from "../workflow.js";

/** A workflow channel: its name and class, and the class of its inbound adapter (if any). */
interface ChannelClasses {
  readonly name: string;
  readonly cls: Class;
  readonly adapter?: Class;
}

const ADAPTER_KINDS: ReadonlySet<string> = new Set(["inbound-adapter", "semantic-inbound-adapter"]);

function channelClassesOf(bundle: WorkflowMeta): readonly ChannelClasses[] {
  return (bundle.channelClasses ?? []).map((cls) => {
    const { name, inboundAdapter } = requireComponent(cls, "channel", "workflowOf").meta;
    if (inboundAdapter === undefined) return { name, cls };
    if (!ADAPTER_KINDS.has(componentOf(inboundAdapter)?.kind ?? "")) {
      throw new ComponentError(
        `@Channel "${name}": inboundAdapter ${inboundAdapter.name} is not an @InboundChannelAdapter`,
      );
    }
    return { name, cls, adapter: inboundAdapter };
  });
}

/** Every channel class and inbound adapter class, for the dependency graph check. */
export const channelComponentClassesOf = (bundle: WorkflowMeta): Class[] =>
  channelClassesOf(bundle).flatMap((c) => (c.adapter === undefined ? [c.cls] : [c.cls, c.adapter]));

/** The workflow's channels and their inbound adapters by channel name, created by its container. */
export function channelPartsOf(
  bundle: WorkflowMeta,
): Required<Pick<AssembledWorkflow, "channels" | "channelAdapters">> {
  const channels = channelClassesOf(bundle);
  const get = (services: WorkflowServices, cls: Class): unknown =>
    containerFor(bundle, services).get(cls);
  return {
    channels: (services) =>
      new Map(channels.map((c) => [c.name, get(services, c.cls) as ChannelHandler])),
    channelAdapters: (services) =>
      new Map(
        channels.flatMap((c) =>
          c.adapter === undefined
            ? []
            : [[c.name, get(services, c.adapter) as InboundChannelAdapter] as const],
        ),
      ),
  };
}

import { currentFrame } from "../flow/context/frame.js";
import type { RouterEngine } from "../routers/index.js";

/** What `ROUTER_FACTORY` gives a service: a router engine by name. */
export type RouterFactory = (name: string) => RouterEngine;

/**
 * `ROUTER_FACTORY`'s routers with their spend accounted (#280): a decision a service makes during a
 * tool call is recorded in that call's usage — tools no longer report it themselves (`ctx` is
 * gone). Outside a tool call nothing changes.
 */
export const accountedRouters =
  (routers: RouterFactory): RouterFactory =>
  (name) => {
    const engine = routers(name);
    return {
      name: engine.name,
      route: async (request) => {
        const outcome = await engine.route(request);
        if (outcome.usage !== undefined) currentFrame()?.services.reportUsage?.(outcome.usage);
        return outcome;
      },
    };
  };

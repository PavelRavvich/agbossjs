/**
 * Spike #113, item 6 — a router's `routes` against its `choose(...)`: startup only. The file compiles
 * although `from(TriageRouter).choose(...)` disagrees with the router's routes; assembly catches it.
 */
import { describe, expect, it } from "vitest";
import { Agent, Router, Self, assertRoutesMatchChoose, from, route } from "./router.js";

@Agent("billing")
class BillingAgent {}
@Agent("tech-support")
class TechSupportAgent {}
@Agent("account")
class AccountAgent {}

@Router({
  name: "triage",
  routes: [
    route(BillingAgent, "Money: invoices, charges, refunds"),
    route(TechSupportAgent, "Something does not work"),
  ],
})
class TriageRouter {}

@Router({ name: "follow-up", routes: [route(Self, "the same specialist continues")] })
class FollowUpRouter {}

describe("spike #113 — router routes vs choose", () => {
  it("empty component classes are one type to the compiler: any node fits any slot", () => {
    const billing: typeof BillingAgent = TechSupportAgent;
    const router: typeof TriageRouter = AccountAgent;
    expect([billing, router]).toEqual([TechSupportAgent, AccountAgent]);
  });

  it("a matching choose passes assembly", () => {
    expect(() => {
      assertRoutesMatchChoose(from(TriageRouter).choose(BillingAgent, TechSupportAgent));
    }).not.toThrow();
    expect(() => {
      assertRoutesMatchChoose(from(FollowUpRouter).choose(Self));
    }).not.toThrow();
  });

  it("a mismatch compiles and fails at startup with both directions named", () => {
    const choice = from(TriageRouter).choose(BillingAgent, AccountAgent);
    expect(() => {
      assertRoutesMatchChoose(choice);
    }).toThrow(
      "router.routes-mismatch: TriageRouter: AccountAgent is chosen but has no route; " +
        "TechSupportAgent has a route but is not in choose(...)",
    );
  });
});

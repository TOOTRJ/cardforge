import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  CLIENT_FUNNEL_EVENTS,
  FIRST_EVENT,
  PERMANENT_FUNNEL_EVENTS,
  SERVER_FUNNEL_EVENTS,
  isClientFunnelEvent,
  isFunnelEvent,
  sanitizeFunnelProps,
} from "@/lib/analytics/funnel-events";

describe("funnel event vocabulary", () => {
  it("client and server names never overlap, and only listed names are accepted", () => {
    const overlap = CLIENT_FUNNEL_EVENTS.filter((e) => (SERVER_FUNNEL_EVENTS as readonly string[]).includes(e));
    expect(overlap).toEqual([]);
    expect(isClientFunnelEvent("pricing_view")).toBe(true);
    expect(isClientFunnelEvent("checkout_started")).toBe(false);
    expect(isFunnelEvent("checkout_started")).toBe(true);
    expect(isFunnelEvent("drop table")).toBe(false);
    expect(isFunnelEvent(42)).toBe(false);
  });

  it("props keep allow-listed short scalars only — never free text, emails or objects", () => {
    expect(
      sanitizeFunnelProps({
        tier: "pro",
        period: "monthly",
        trial: true,
        amountCents: 1500.004,
        reason: "credits",
        email: "someone@example.com",
        note: "x".repeat(100),
        nested: { a: 1 },
        surface: "<script>",
      }),
    ).toEqual({ tier: "pro", period: "monthly", trial: true, amountCents: 1500, reason: "credits" });
    expect(sanitizeFunnelProps(null)).toEqual({});
    expect(sanitizeFunnelProps("string")).toEqual({});
  });

  it("every activity kind has a once-per-user milestone, and milestones + signup are permanent", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(FIRST_EVENT[kind]).toBe(`first_${kind}`);
      expect((SERVER_FUNNEL_EVENTS as readonly string[]).includes(FIRST_EVENT[kind])).toBe(true);
    }
    expect([...PERMANENT_FUNNEL_EVENTS].sort()).toEqual(["first_ai_generation", "first_card_saved", "first_download", "signup"]);
  });

  it("caps the number of props", () => {
    const many = Object.fromEntries(
      ["kind", "tier", "period", "pack", "surface", "reason", "trial", "discount", "signedIn", "mode", "interval", "amountCents"].map((k) => [k, "v"]),
    );
    expect(Object.keys(sanitizeFunnelProps(many)).length).toBeLessThanOrEqual(10);
  });
});

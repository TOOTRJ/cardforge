import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  CLIENT_FUNNEL_EVENTS,
  FIRST_EVENT,
  NAV_SURFACES,
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

  it("nav_click (TODO NV10) is a browser event carrying the link's id, its surface and signedIn — nothing else", () => {
    expect(isClientFunnelEvent("nav_click")).toBe(true);
    expect([...NAV_SURFACES]).toEqual(["header", "drawer", "footer"]);
    expect(
      sanitizeFunnelProps({
        item: "community.gallery",
        surface: "header",
        signedIn: false,
        href: "/gallery?q=someone@example.com",
        label: "Card gallery",
      }),
    ).toEqual({ item: "community.gallery", surface: "header", signedIn: false });
    // An item is an id, never free text.
    expect(sanitizeFunnelProps({ item: "<img onerror=x>" })).toEqual({});
  });

  it("caps the number of props", () => {
    const many = Object.fromEntries(
      ["kind", "tier", "period", "pack", "surface", "reason", "trial", "discount", "signedIn", "mode", "interval", "amountCents"].map((k) => [k, "v"]),
    );
    expect(Object.keys(sanitizeFunnelProps(many)).length).toBeLessThanOrEqual(10);
  });
});

describe("the deck events (TODO DK3.8)", () => {
  it("are allow-listed on the right side: created / cap hit / customized server-side, the export click from the browser", () => {
    for (const e of ["deck_created", "deck_cap_hit", "deck_card_customized"]) {
      expect((SERVER_FUNNEL_EVENTS as readonly string[]).includes(e), e).toBe(true);
      expect(isClientFunnelEvent(e), e).toBe(false);
    }
    expect(isClientFunnelEvent("deck_export_clicked")).toBe(true);
  });

  it("carry only allow-listed scalar props", () => {
    expect(sanitizeFunnelProps({ visibility: "private", format: "commander", surface: "wizard", title: "My deck" })).toEqual({
      visibility: "private",
      format: "commander",
      surface: "wizard",
    });
    expect(sanitizeFunnelProps({ kind: "create", tier: "free", visibility: undefined })).toEqual({ kind: "create", tier: "free" });
    expect(sanitizeFunnelProps({ kind: "pdf", preset: "hd", layout: "sheet", deckId: "x" })).toEqual({ kind: "pdf", preset: "hd", layout: "sheet" });
  });
});

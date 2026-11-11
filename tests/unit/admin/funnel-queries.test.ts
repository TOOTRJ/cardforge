import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import {
  FUNNEL_LIST_REST,
  SIGNUP_NOT_RECORDED,
  buildFunnel,
  groupCancelReasons,
  groupSignupSources,
  groupSignupSurfaces,
} from "@/lib/admin/funnel-queries";

describe("groupCancelReasons", () => {
  it("groups ended plans by the portal's feedback, else Stripe's reason, biggest first — in the customer's words", () => {
    const rows = [
      { props: { cancelReason: "cancellation_requested", cancelFeedback: "too_expensive" } },
      { props: { cancelReason: "cancellation_requested", cancelFeedback: "too_expensive" } },
      { props: { cancelReason: "cancellation_requested", cancelFeedback: "unused" } },
      { props: { cancelReason: "cancellation_requested" } },
      { props: { cancelReason: "payment_disputed" } },
      { props: {} },
      { props: null },
      { props: { cancelFeedback: "something_new" } },
    ];
    expect(groupCancelReasons(rows)).toEqual([
      // Ties alphabetical: "none" before "too_expensive".
      { reason: "none", label: "No reason recorded", n: 2 },
      { reason: "too_expensive", label: "Too expensive", n: 2 },
      { reason: "cancellation_requested", label: "Cancelled, no reason given", n: 1 },
      { reason: "payment_disputed", label: "Payment disputed", n: 1 },
      { reason: "something_new", label: "something_new", n: 1 },
      { reason: "unused", label: "Didn't use it enough", n: 1 },
    ]);
    // Past the limit the rest is ONE closing row: the list still adds up.
    const short = groupCancelReasons(rows, 2);
    expect(short).toHaveLength(3);
    expect(short[2]).toMatchObject({ reason: FUNNEL_LIST_REST, label: "Everything else" });
    expect(short.reduce((sum, row) => sum + row.n, 0)).toBe(rows.length);
    expect(groupCancelReasons([])).toEqual([]);
  });
});

describe("buildFunnel", () => {
  it("sets every step's count beside the previous period's — counts only, no step divided by the one above it", () => {
    const sections = buildFunnel(
      {
        pricing_view: { n: 200, users: 20 },
        cta_click: { n: 50, users: 30 },
        checkout_started: { n: 20, users: 18 },
        checkout_completed: { n: 5, users: 5 },
        trial_started: { n: 8, users: 8 },
        trial_converted: { n: 2, users: 2 },
        upgrade_modal_open: { n: 40, users: 25 },
        pack_purchased: { n: 3, users: 3 },
        payment_received: { n: 9, users: 6 },
        subscription_cancelled: { n: 1, users: 1 },
      },
      {
        pricing_view: { n: 100, users: 10 },
        checkout_completed: { n: 5, users: 4 },
        trial_started: { n: 16, users: 15 },
      },
    );
    const storefront = sections.find((x) => x.title === "Storefront")!;
    expect(storefront.steps.map((st) => [st.key, st.n, st.users, st.previousN, st.previousUsers])).toEqual([
      ["pricing_view", 200, 20, 100, 10],
      ["cta_click", 50, 30, 0, 0],
      ["checkout_started", 20, 18, 0, 0],
      ["checkout_completed", 5, 5, 5, 4],
    ]);
    expect(sections.find((x) => x.title === "Trials")!.steps[0]).toMatchObject({ n: 8, previousN: 16 });
    // The 2026-11 audit: "Rate 30d" divided one step's events by the step before's — 109 first cards over 42 signups.
    for (const step of sections.flatMap((x) => x.steps)) expect(step).not.toHaveProperty("rate");
  });

  it("keeps the nine sections and their steps in order", () => {
    expect(buildFunnel({}).map((section) => [section.title, section.steps.map((st) => st.key)])).toEqual([
      ["Activation", ["signup", "first_card_saved", "first_ai_generation", "first_download"]],
      ["Storefront", ["pricing_view", "cta_click", "checkout_started", "checkout_completed"]],
      ["Trials", ["trial_started", "trial_converted"]],
      ["Out of credits", ["upgrade_modal_open", "pack_purchased"]],
      ["Money", ["payment_received", "subscription_started", "subscription_changed", "subscription_cancelled", "subscription_resumed"]],
      ["Leaks", ["checkout_expired", "trial_lapsed", "payment_failed"]],
      ["Decks", ["deck_created", "deck_card_customized", "deck_export_clicked"]],
      ["Home create buttons", ["create_cta_click"]],
      ["Guest creator", ["guest_save_gate"]],
    ]);
  });

  it("lists the deck plan's moments (TODO DK3.8) — no cap event: decks are unlimited", () => {
    const sections = buildFunnel({ deck_created: { n: 12, users: 9 }, deck_card_customized: { n: 4, users: 3 } });
    const decks = sections.find((x) => x.title === "Decks")!;
    expect(decks.steps.map((st) => [st.key, st.label, st.n])).toEqual([
      ["deck_created", "Decks created", 12],
      ["deck_card_customized", "Deck cards customized", 4],
      ["deck_export_clicked", "Deck export clicks", 0],
    ]);
  });

  it("activation lists signup, first save, first generation, first download", () => {
    const sections = buildFunnel({ signup: { n: 20, users: 20 }, first_card_saved: { n: 8, users: 8 }, first_ai_generation: { n: 4, users: 4 }, first_download: { n: 2, users: 2 } });
    expect(sections[0].title).toBe("Activation");
    expect(sections[0].steps.map((s) => [s.key, s.n])).toEqual([
      ["signup", 20],
      ["first_card_saved", 8],
      ["first_ai_generation", 4],
      ["first_download", 2],
    ]);
  });

  it("groups signups by utm_source, then referrer, else direct — biggest first", () => {
    expect(
      groupSignupSources([
        { props: { utmSource: "reddit", referrer: "reddit.com" } },
        { props: { utmSource: "reddit" } },
        { props: { referrer: "google.com" } },
        { props: {} },
        { props: null },
        { props: { referrer: "<bad>" } },
      ]),
    ).toEqual([
      { source: "direct", n: 3 },
      { source: "reddit", n: 2 },
      { source: "google.com", n: 1 },
    ]);
  });

  it("an empty period is zeros on both sides", () => {
    const steps = buildFunnel({}, {}).flatMap((x) => x.steps);
    expect(steps.every((st) => st.n === 0 && st.users === 0 && st.previousN === 0 && st.previousUsers === 0)).toBe(true);
  });
});

describe("groupSignupSurfaces", () => {
  it("counts signups by the create button pressed last, none when there was no tracked button", () => {
    expect(
      groupSignupSurfaces([
        { props: { surface: "home_hero", referrer: "reddit.com" } },
        { props: { surface: "home_hero" } },
        { props: { surface: "header" } },
        { props: { utmSource: "discord" } },
        { props: null },
      ]),
    ).toEqual([
      { surface: "home_hero", n: 2 },
      { surface: "none", n: 2 },
      { surface: "header", n: 1 },
    ]);
  });
});

describe("the Storefront list is billing moments alone (TODO HM2)", () => {
  it("is exactly pricing view → CTA → checkout, and a home create click is counted apart", () => {
    const sections = buildFunnel({ cta_click: { n: 4, users: 4 }, create_cta_click: { n: 90, users: 60 } });
    expect(sections.find((x) => x.title === "Storefront")!.steps.map((st) => st.key)).toEqual([
      "pricing_view",
      "cta_click",
      "checkout_started",
      "checkout_completed",
    ]);
    const home = sections.find((x) => x.title === "Home create buttons")!;
    expect(home.steps).toEqual([expect.objectContaining({ key: "create_cta_click", n: 90 })]);
  });

  it("cta_click is sent only by the billing components (admin_funnel_counts groups by event alone)", async () => {
    const { execSync } = await import("node:child_process");
    const files = execSync(`grep -rl '"cta_click"' app components lib || true`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.startsWith("lib/analytics/") && !f.startsWith("lib/admin/"));
    for (const file of files) expect(file).toMatch(/^components\/billing\//);
  });
});


// Migration 0197 gives every account without a signup row one (259 of
// production's 312 on 2026-11-10: accounts made with Google or Discord were
// never recorded). Nobody knows where those arrived from: they are their own
// line, never "direct" (no referrer) or "none" (no button).
describe("signups whose first touch was never recorded", () => {
  const rows = [
    { props: { method: "google", backfilled: true } },
    { props: { method: "google", backfilled: true } },
    { props: { method: "email", backfilled: true } },
    { props: { method: "email" } },
    { props: { method: "google", referrer: "reddit.com", surface: "home_hero" } },
  ];

  it("are 'not recorded' in the source list — 'direct' stays the visitors who really came with no referrer", () => {
    expect(SIGNUP_NOT_RECORDED).toBe("not recorded");
    expect(groupSignupSources(rows)).toEqual([
      { source: "not recorded", n: 3 },
      { source: "direct", n: 1 },
      { source: "reddit.com", n: 1 },
    ]);
  });

  it("and in the create-button list", () => {
    expect(groupSignupSurfaces(rows)).toEqual([
      { surface: "not recorded", n: 3 },
      { surface: "home_hero", n: 1 },
      { surface: "none", n: 1 },
    ]);
  });
});

describe("a long list always adds up to what it breaks down", () => {
  // Ten sources, the last five with one signup each.
  const rows = [
    ...Array.from({ length: 6 }, () => ({ props: { utmSource: "reddit" } })),
    ...Array.from({ length: 4 }, () => ({ props: { utmSource: "discord" } })),
    ...Array.from({ length: 3 }, () => ({ props: { utmSource: "newsletter" } })),
    ...["a", "b", "c", "d", "e", "f", "g"].map((source) => ({ props: { utmSource: source } })),
  ];

  it("signups by source: the 8 biggest, then everything else in one row — the total is every signup", () => {
    const sources = groupSignupSources(rows);
    expect(sources).toHaveLength(9);
    expect(sources[0]).toEqual({ source: "reddit", n: 6 });
    expect(sources[8]).toEqual({ source: FUNNEL_LIST_REST, n: 2 });
    expect(sources.reduce((sum, row) => sum + row.n, 0)).toBe(rows.length);
  });

  it("a list that fits has no closing row", () => {
    expect(groupSignupSources(rows.slice(0, 13)).map((row) => row.source)).toEqual(["reddit", "discord", "newsletter"]);
    expect(groupSignupSurfaces([{ props: {} }]).some((row) => row.surface === FUNNEL_LIST_REST)).toBe(false);
  });

  it("signups by button pressed adds up the same way", () => {
    const pressed = Array.from({ length: 12 }, (_, i) => ({ props: { surface: `surface_${i}` } }));
    const surfaces = groupSignupSurfaces(pressed, 3);
    expect(surfaces.reduce((sum, row) => sum + row.n, 0)).toBe(12);
    expect(surfaces.at(-1)?.surface).toBe(FUNNEL_LIST_REST);
  });
});

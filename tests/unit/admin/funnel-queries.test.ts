import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { buildFunnel, groupCancelReasons, groupSignupSources, groupSignupSurfaces } from "@/lib/admin/funnel-queries";

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
    expect(groupCancelReasons(rows, 2)).toHaveLength(2);
    expect(groupCancelReasons([])).toEqual([]);
  });
});

describe("buildFunnel", () => {
  it("chains rates inside the storefront, trial and out-of-credits sections and leaves counts elsewhere", () => {
    const w = buildFunnel(
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
      30,
    );
    expect(w.days).toBe(30);
    const storefront = w.sections.find((x) => x.title === "Storefront")!;
    expect(storefront.steps.map((st) => [st.key, st.n, st.rate])).toEqual([
      ["pricing_view", 200, null],
      ["cta_click", 50, 25],
      ["checkout_started", 20, 40],
      ["checkout_completed", 5, 25],
    ]);
    expect(w.sections.find((x) => x.title === "Trials")!.steps[1]).toMatchObject({ n: 2, rate: 25 });
    expect(w.sections.find((x) => x.title === "Out of credits")!.steps[1]).toMatchObject({ n: 3, rate: 7.5 });
    // Money and Leaks are counts only.
    expect(w.sections.find((x) => x.title === "Money")!.steps.every((st) => st.rate === null)).toBe(true);
    expect(w.sections.find((x) => x.title === "Leaks")!.steps.every((st) => st.rate === null)).toBe(true);
  });

  it("lists the deck plan's moments as counts (TODO DK3.8) — no cap event: decks are unlimited", () => {
    const w = buildFunnel({ deck_created: { n: 12, users: 9 }, deck_card_customized: { n: 4, users: 3 } }, 7);
    const decks = w.sections.find((x) => x.title === "Decks")!;
    expect(decks.steps.map((st) => [st.key, st.label, st.n, st.rate])).toEqual([
      ["deck_created", "Decks created", 12, null],
      ["deck_card_customized", "Deck cards customized", 4, null],
      ["deck_export_clicked", "Deck export clicks", 0, null],
    ]);
  });

  it("activation chains signup → first save → first generation → first download", () => {
    const w = buildFunnel({ signup: { n: 20, users: 20 }, first_card_saved: { n: 8, users: 8 }, first_ai_generation: { n: 4, users: 4 }, first_download: { n: 2, users: 2 } }, 30);
    expect(w.sections[0].title).toBe("Activation");
    expect(w.sections[0].steps.map((s) => [s.key, s.n, s.rate])).toEqual([
      ["signup", 20, null],
      ["first_card_saved", 8, 40],
      ["first_ai_generation", 4, 50],
      ["first_download", 2, 50],
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

  it("an empty window renders zeros with no rates (no division by zero)", () => {
    const w = buildFunnel({}, 7);
    expect(w.sections.flatMap((x) => x.steps).every((st) => st.n === 0 && st.rate === null)).toBe(true);
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

describe("the Storefront chain is billing moments alone (TODO HM2)", () => {
  it("is exactly pricing view → CTA → checkout, and a home create click is counted apart", () => {
    const w = buildFunnel({ cta_click: { n: 4, users: 4 }, create_cta_click: { n: 90, users: 60 } }, 7);
    expect(w.sections.find((x) => x.title === "Storefront")!.steps.map((st) => st.key)).toEqual([
      "pricing_view",
      "cta_click",
      "checkout_started",
      "checkout_completed",
    ]);
    const home = w.sections.find((x) => x.title === "Home create buttons")!;
    expect(home.steps).toEqual([expect.objectContaining({ key: "create_cta_click", n: 90, rate: null })]);
  });

  it("cta_click is sent only by the billing components (admin_funnel_counts groups by event alone)", async () => {
    const { execSync } = await import("node:child_process");
    const files = execSync(`grep -rl '"cta_click"' app components lib || true`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.startsWith("lib/analytics/") && !f.startsWith("lib/admin/") && f !== "app/api/events/route.ts");
    for (const file of files) expect(file).toMatch(/^components\/billing\//);
  });
});

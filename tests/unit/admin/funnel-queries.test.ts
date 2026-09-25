import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { buildFunnel, groupSignupSources } from "@/lib/admin/funnel-queries";

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

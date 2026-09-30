import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { EMPTY_AUTO_REBAKE_STATE } from "@/lib/cards/auto-rebake-state";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { FRAME_ERA_VALUES, FRAME_TEMPLATE_VALUES } from "@/types/card";
import {
  summariseFrameDemand,
  summariseFrameVerification,
  summariseRebake,
  templatesNeedingReverification,
  type VerificationReview,
} from "@/lib/admin/ops-summary";
import type { AutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import type { FrameRequestRow, FrameRequestSummary } from "@/lib/frames/frame-request-queries";

// ---------------------------------------------------------------------------
// TODO 7.4 — the admin dashboard tile's numbers. Each must be the number its
// admin page shows: the frame checklist (verified counts stale ticks, "needs
// re-verification" is verificationState's), /admin/renders (pending, poison,
// lease) and /admin/frame-requests (30 days, families never built left out).
// ---------------------------------------------------------------------------

const current = (extra: Partial<VerificationReview> = {}): VerificationReview => ({
  verified: true,
  verifiedLayoutVersion: CARD_LAYOUT_VERSION,
  verifiedOverrideHash: "none",
  scoreJson: null,
  ...extra,
});

function reviewsOf(entries: Array<[string, string, VerificationReview]>) {
  return new Map(entries.map(([t, c, r]) => [frameComboKey(t, c), r]));
}

describe("summariseFrameVerification", () => {
  it("counts every template × colour the checklist lists, with nothing verified by default", () => {
    const s = summariseFrameVerification(new Map(), {});
    expect(s.templates).toHaveLength(FRAME_TEMPLATE_VALUES.length);
    expect(s.combos).toBe(FRAME_TEMPLATE_VALUES.length * FRAME_COLOR_KEYS.length);
    expect(s).toMatchObject({ verified: 0, stale: 0, unverified: s.combos, completeTemplates: 0 });
    // Checklist order: era by era.
    const eras = s.templates.map((row) => FRAME_ERA_VALUES.indexOf(row.era));
    expect(eras).toEqual([...eras].sort((a, b) => a - b));
    for (const row of s.templates) expect(row.era).toBe(eraForTemplate(row.template));
  });

  it("splits a template into current, stale (still verified) and unverified ticks", () => {
    const s = summariseFrameVerification(
      reviewsOf([
        ["m15", "w", current({ scoreJson: { overall: 4.9 } })],
        ["m15", "u", current({ scoreJson: { overall: 2.1 } })],
        // The override moved since this tick → needs re-verification.
        ["m15", "b", current({ verifiedOverrideHash: "deadbeef" })],
        // An unticked row (a reference pin) is not verified.
        ["m15", "r", { verified: false, verifiedLayoutVersion: null, verifiedOverrideHash: null, scoreJson: { overall: 12 } }],
      ]),
      {},
    );
    const m15 = s.templates.find((row) => row.template === "m15")!;
    expect(m15).toMatchObject({ combos: 7, verified: 3, stale: 1, unverified: 4, worstMatchPct: 95.1, lowMatch: 0 });
    expect(m15.fullLabel).toBe(describeFrame("m15"));
    expect(s).toMatchObject({ verified: 3, stale: 1, unverified: s.combos - 3, lowMatch: 0 });
    expect(templatesNeedingReverification(s).map((row) => row.template)).toEqual(["m15"]);
  });

  it("reads a recorded score as an edge DIFFERENCE: the worst match is the largest one, flagged under the sign-off line", () => {
    const s = summariseFrameVerification(
      reviewsOf([
        ["saga", "w", current({ scoreJson: { overall: 3 } })],
        ["saga", "u", current({ scoreJson: { overall: 12.5 } })],
        ["saga", "b", current({ scoreJson: { overall: 30 } })],
        ["saga", "r", current({ scoreJson: { note: "no number" } })],
      ]),
      {},
    );
    expect(s.templates.find((row) => row.template === "saga")).toMatchObject({ worstMatchPct: 70, lowMatch: 2 });
    expect(s.lowMatch).toBe(2);
    expect(s.templates.find((row) => row.template === "m15")).toMatchObject({ worstMatchPct: null, lowMatch: 0 });
  });

  it("reads the recorded match from CURRENT ticks only — a stale tick's score is only a re-verification", () => {
    // Stale by a moved override, and stale by a renderer bump (m15token's
    // tick predates v34 below): both scores were measured against a frame
    // that no longer renders, so they join `stale` and nothing else.
    const movedOverride = (overall: number) => current({ verifiedOverrideHash: "deadbeef", scoreJson: { overall } });
    const s = summariseFrameVerification(
      reviewsOf([
        ["saga", "w", current({ verifiedLayoutVersion: 34, scoreJson: { overall: 4 } })],
        ["saga", "u", movedOverride(30)],
        ["saga", "b", movedOverride(15)],
        ["m15token", "w", current({ verifiedLayoutVersion: 33, scoreJson: { overall: 40 } })],
      ]),
      {},
      { currentVersion: 34 },
    );
    expect(s.templates.find((row) => row.template === "saga")).toMatchObject({
      verified: 3,
      stale: 2,
      worstMatchPct: 96,
      lowMatch: 0,
    });
    // Only a stale score recorded: no worst match to print.
    expect(s.templates.find((row) => row.template === "m15token")).toMatchObject({
      verified: 1,
      stale: 1,
      worstMatchPct: null,
      lowMatch: 0,
    });
    expect(s).toMatchObject({ verified: 4, stale: 3, lowMatch: 0 });
  });

  it("judges a tick against the template's CURRENT override hash", () => {
    const override = { title: { rect: { topPct: 5 } } };
    const hash = overrideHash(override);
    const reviews = reviewsOf(FRAME_COLOR_KEYS.map((c) => ["retro", c, current({ verifiedOverrideHash: hash })]));
    const withOverride = summariseFrameVerification(reviews, { retro: override });
    const retro = withOverride.templates.find((row) => row.template === "retro")!;
    expect(retro).toMatchObject({ verified: 7, stale: 0, unverified: 0 });
    expect(withOverride.completeTemplates).toBe(1);
    // The override was reset since: all seven need re-verification, and the
    // template is no longer complete.
    const reset = summariseFrameVerification(reviews, {});
    expect(reset.templates.find((row) => row.template === "retro")).toMatchObject({ verified: 7, stale: 7 });
    expect(reset.completeTemplates).toBe(0);
  });

  it("stales a tick recorded before a bump that touches its template", () => {
    const s = summariseFrameVerification(
      reviewsOf([["m15token", "w", current({ verifiedLayoutVersion: 33 })]]),
      {},
      { currentVersion: 34 },
    );
    expect(s.templates.find((row) => row.template === "m15token")).toMatchObject({ verified: 1, stale: 1 });
  });

  it("lists the templates to re-verify most-stale first, then in checklist order", () => {
    const stale = current({ verifiedOverrideHash: "deadbeef" });
    const s = summariseFrameVerification(
      reviewsOf([
        ["retro", "w", stale],
        ["m15", "w", stale],
        ["m15", "u", stale],
        ["modern", "w", stale],
        ["modern", "u", current()],
      ]),
      {},
    );
    const order = templatesNeedingReverification(s).map((row) => row.template);
    expect(order[0]).toBe("m15");
    const retroIndex = s.templates.findIndex((row) => row.template === "retro");
    const modernIndex = s.templates.findIndex((row) => row.template === "modern");
    expect(order.slice(1)).toEqual(retroIndex < modernIndex ? ["retro", "modern"] : ["modern", "retro"]);
  });
});

describe("summariseRebake", () => {
  const NOW = Date.parse("2026-09-29T12:00:00.000Z");
  const overview = (
    state: Partial<AutoRebakeOverview["state"]> = {},
    rest: Partial<AutoRebakeOverview> = {},
  ): AutoRebakeOverview => ({
    state: { ...EMPTY_AUTO_REBAKE_STATE, ...state },
    pending: 12,
    layoutVersion: 34,
    sweepVersion: 34,
    billingEnabled: true,
    poisonCards: [],
    error: null,
    readAt: NOW,
    ...rest,
  });
  const lease = (holder: "cron" | "manual", expiresAt: string, running = true) => ({
    lease: { holder, running, expiresAt, acquiredAt: "2026-09-29T11:58:00.000Z" },
  });

  it("is idle with no live lease and carries the owed count and the poison COUNT", () => {
    const poison = [
      { id: "11111111-1111-4111-8111-111111111111", error: "Art unavailable", failures: 3, at: "2026-09-29T10:00:00.000Z" },
      { id: "22222222-2222-4222-8222-222222222222", error: "Art unavailable", failures: 3, at: "2026-09-29T10:00:00.000Z" },
    ];
    const s = summariseRebake(overview({ poison }), NOW);
    expect(s).toMatchObject({ status: "idle", runner: null, owed: 12, poisoned: 2, pausedReason: null });
    // Nothing that names a card leaves the server.
    expect(JSON.stringify(s)).not.toMatch(/11111111|22222222|Art unavailable/);
  });

  it("is running while a lease is live — by whoever holds it — and idle once it expired", () => {
    expect(summariseRebake(overview(lease("cron", "2026-09-29T12:03:00.000Z")), NOW)).toMatchObject({
      status: "running",
      runner: "cron",
    });
    // A manual run parked between two calls still holds the sweep.
    expect(summariseRebake(overview(lease("manual", "2026-09-29T12:01:00.000Z", false)), NOW)).toMatchObject({
      status: "running",
      runner: "manual",
    });
    expect(summariseRebake(overview(lease("cron", "2026-09-29T11:59:00.000Z")), NOW)).toMatchObject({
      status: "idle",
      runner: null,
    });
  });

  it("paused wins over a live lease and says why", () => {
    const s = summariseRebake(
      overview({
        ...lease("manual", "2026-09-29T12:03:00.000Z"),
        paused: true,
        pausedReason: "a whole batch failed",
        pausedAt: "2026-09-29T11:40:00.000Z",
      }),
      NOW,
    );
    expect(s).toMatchObject({
      status: "paused",
      pausedReason: "a whole batch failed",
      pausedAt: "2026-09-29T11:40:00.000Z",
    });
  });

  it("maps the last run and passes a failed count, an error and the billing flag through", () => {
    const s = summariseRebake(
      overview(
        {
          lastRun: {
            startedAt: "2026-09-29T11:50:00.000Z",
            finishedAt: "2026-09-29T11:54:00.000Z",
            durationMs: 240_000,
            layoutVersion: 34,
            batches: 3,
            rebaked: 20,
            stamped: 1,
            failed: 2,
            superseded: 0,
            remaining: 4,
            stop: "budget",
          },
        },
        { pending: null, billingEnabled: false, error: "Reading the re-bake state failed: boom" },
      ),
      NOW,
    );
    expect(s.lastRun).toEqual({ finishedAt: "2026-09-29T11:54:00.000Z", rebaked: 20, failed: 2 });
    expect(s).toMatchObject({ owed: null, billingEnabled: false, error: "Reading the re-bake state failed: boom" });
  });
});

describe("summariseFrameDemand", () => {
  const row = (patch: Partial<FrameRequestRow>): FrameRequestRow => ({
    signature: "sig",
    label: "Label",
    setCode: "abc",
    status: "nearest",
    cause: "missing",
    count: 1,
    users: 1,
    lastSeen: "2026-09-28T10:00:00.000Z",
    template: null,
    templateLabel: null,
    artFlags: [],
    sampleCollector: null,
    sampleScryfallId: null,
    sampleUrl: null,
    blockedBy: null,
    forGood: false,
    inRegistry: true,
    ...patch,
  });
  const summary = (rows: FrameRequestRow[], rest: Partial<FrameRequestSummary> = {}): FrameRequestSummary => ({
    window: "30",
    rows,
    totalRequests: rows.reduce((n, r) => n + r.count, 0),
    error: null,
    ...rest,
  });

  it("counts open signatures by cause, leaves never-built families out and keeps the page's order", () => {
    const s = summariseFrameDemand(
      summary([
        row({ signature: "poster", label: "Poster", forGood: true, users: 9, count: 20 }),
        row({ signature: "a", label: "Showcase A", users: 5, count: 8 }),
        row({ signature: "b", label: "Borderless B", cause: "unverified", users: 3, count: 3 }),
        row({ signature: "c", label: "Etched C", users: 2, count: 6 }),
        row({ signature: "d", label: "Retro D", users: 1, count: 1 }),
      ]),
    );
    expect(s).toMatchObject({ window: "30", requests: 38, missing: 3, unverified: 1, error: null });
    expect(s.top.map((r) => r.signature)).toEqual(["a", "b", "c"]);
    expect(s.top[1]).toEqual({ signature: "b", label: "Borderless B", setCode: "abc", cause: "unverified", users: 3, count: 3 });
  });

  it("counts FRAMES the way the page's group headings do: one signature under two set codes is one frame", () => {
    // The RPC groups by signature + set + cause, so a family printed in two
    // sets comes back as two rows; /admin/frame-requests says "3 requests
    // for 1 missing frame" (distinct signatures), and so must the tile.
    const s = summariseFrameDemand(
      summary([
        row({ signature: "borderless/standard", label: "Borderless", setCode: "dmu", users: 2, count: 2 }),
        row({ signature: "borderless/standard", label: "Borderless", setCode: "bro", users: 1, count: 1 }),
        row({ signature: "extendedart", label: "Extended art", setCode: "woe", cause: "unverified", users: 1, count: 1 }),
        row({ signature: "extendedart", label: "Extended art", setCode: "lci", cause: "unverified", users: 1, count: 1 }),
      ]),
    );
    expect(s).toMatchObject({ requests: 5, missing: 1, unverified: 1 });
    // The top list stays per row, as the page's table is.
    expect(s.top.map((r) => `${r.signature}/${r.setCode}`)).toEqual([
      "borderless/standard/dmu",
      "borderless/standard/bro",
      "extendedart/woe",
    ]);
  });

  it("is empty but honest about a read error", () => {
    expect(summariseFrameDemand(summary([], { error: "Couldn't read the request log." }))).toEqual({
      window: "30",
      requests: 0,
      missing: 0,
      unverified: 0,
      top: [],
      error: "Couldn't read the request log.",
    });
  });
});

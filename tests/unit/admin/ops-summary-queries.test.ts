import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 7.4 — the admin dashboard tile's loader is admin-only ON ITS OWN: a
// non-admin (or signed-out) caller gets null before ANY read, so the
// service-role render_sweep_state read can't run for them even if a page
// forgot its own gate. For an admin it reads the four sources once each,
// without looking up the poisoned cards (the tile prints a count).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  getFrameReviews: vi.fn(),
  getFrameProfileOverrides: vi.fn(),
  getAutoRebakeOverview: vi.fn(),
  getFrameRequestSummary: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: mocks.getFrameReviews }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  getFrameProfileOverrides: mocks.getFrameProfileOverrides,
}));
vi.mock("@/lib/cards/auto-rebake-queries", () => ({ getAutoRebakeOverview: mocks.getAutoRebakeOverview }));
vi.mock("@/lib/frames/frame-request-queries", () => ({
  getFrameRequestSummary: mocks.getFrameRequestSummary,
}));

import { getAdminOpsSummary } from "@/lib/admin/ops-summary-queries";
import { EMPTY_AUTO_REBAKE_STATE } from "@/lib/cards/auto-rebake-state";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

const POISON_ID = "33333333-3333-4333-8333-333333333333";
const READ_AT = Date.parse("2026-09-29T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFrameReviews.mockResolvedValue(
    new Map([["m15/w", { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null, scoreJson: null }]]),
  );
  mocks.getFrameProfileOverrides.mockResolvedValue({});
  mocks.getAutoRebakeOverview.mockResolvedValue({
    state: {
      ...EMPTY_AUTO_REBAKE_STATE,
      poison: [{ id: POISON_ID, error: "Art unavailable", failures: 3, at: "2026-09-29T10:00:00.000Z" }],
    },
    pending: 7,
    layoutVersion: 34,
    sweepVersion: 34,
    billingEnabled: true,
    poisonCards: [],
    error: null,
    readAt: READ_AT,
  });
  mocks.getFrameRequestSummary.mockResolvedValue({ window: "30", rows: [], totalRequests: 0, error: null });
});

const readers = () => [
  mocks.getFrameReviews,
  mocks.getFrameProfileOverrides,
  mocks.getAutoRebakeOverview,
  mocks.getFrameRequestSummary,
];

describe("getAdminOpsSummary", () => {
  it.each([
    ["signed out", null],
    ["a signed-in non-admin", { id: "u1", is_admin: false }],
  ])("returns null for %s without reading anything", async (_label, profile) => {
    mocks.getCurrentProfile.mockResolvedValue(profile);
    await expect(getAdminOpsSummary()).resolves.toBeNull();
    for (const reader of readers()) expect(reader).not.toHaveBeenCalled();
  });

  it("reads each source once for an admin and prints counts only", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ id: "admin", is_admin: true });
    const summary = await getAdminOpsSummary();
    expect(summary).not.toBeNull();
    for (const reader of readers()) expect(reader).toHaveBeenCalledTimes(1);
    expect(mocks.getAutoRebakeOverview).toHaveBeenCalledWith({ poisonDetails: false });
    expect(mocks.getFrameRequestSummary).toHaveBeenCalledWith("30");

    expect(summary!.readAt).toBe(READ_AT);
    expect(summary!.frames.combos).toBe(FRAME_TEMPLATE_VALUES.length * FRAME_COLOR_KEYS.length);
    expect(summary!.frames.verified).toBe(1);
    expect(summary!.rebake).toMatchObject({ status: "idle", owed: 7, poisoned: 1 });
    expect(summary!.requests).toMatchObject({ window: "30", requests: 0, top: [] });
    expect(JSON.stringify(summary)).not.toContain(POISON_ID);
  });
});

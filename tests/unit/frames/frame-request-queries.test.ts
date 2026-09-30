import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/frame-requests reads (TODO 1.6): who gets data, which window the RPC
// is asked for, and how its rows become the panel's rows. The SQL itself is
// migration 0123 (tests/unit/db/frame-requests-migration.test.ts).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  isAdminConfigured: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
  createAdminClient: mocks.createAdminClient,
}));

import {
  getFrameRequestSummary,
  mapFrameRequestRows,
  parseFrameRequestWindow,
  sortFrameRequestRows,
  windowSince,
} from "@/lib/frames/frame-request-queries";

const RPC_ROWS = [
  {
    signature: "borderless/standard+crown",
    label: "Borderless frame",
    set_code: "dmu",
    cause: "missing",
    status: "nearest",
    template: "m15",
    n: "3",
    users: "2",
    last_seen: "2026-09-27T10:00:00.000Z",
    sample_scryfall_id: "8df6603a-38c1-4d18-8b84-6211e9a7cc09",
    sample_collector: "435",
    art_flags: ["window-cropped", "bogus"],
  },
  {
    signature: "borderless/poster",
    label: "Artist-lettered borderless poster",
    set_code: "spg",
    cause: "missing",
    status: "unsupported",
    template: "m15",
    n: 1,
    users: 0,
    last_seen: "2026-09-24T10:00:00.000Z",
    sample_scryfall_id: null,
    sample_collector: null,
    art_flags: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: RPC_ROWS, error: null });
});

describe("getFrameRequestSummary", () => {
  it("is null for non-admins and guests (the page 404s), without touching the RPC", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: false });
    expect(await getFrameRequestSummary("30")).toBeNull();
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect(await getFrameRequestSummary("30")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reads the window through the admin client and maps the rows", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);

    const summary = await getFrameRequestSummary("90");
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("admin_frame_request_counts");
    const days = (Date.now() - Date.parse(args.p_since)) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    expect(summary?.window).toBe("90");
    expect(summary?.totalRequests).toBe(4);
    expect(summary?.error).toBeNull();
    expect(summary?.rows[0]).toMatchObject({
      signature: "borderless/standard+crown",
      cause: "missing",
      count: 3,
      users: 2,
      forGood: false,
      inRegistry: true,
      blockedBy: "4.6f",
      artFlags: ["window-cropped"],
      sampleUrl: "https://scryfall.com/card/dmu/435",
      templateLabel: "M15 (2015) Standard",
    });
    expect(summary?.rows[1]).toMatchObject({
      signature: "borderless/poster",
      status: "unsupported",
      forGood: true,
      sampleUrl: null,
      artFlags: [],
    });
  });

  it("asks for all time with a null since", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    await getFrameRequestSummary("all");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_frame_request_counts", { p_since: null });
  });

  it("says why the list is empty when the RPC fails or the admin key is missing", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const failed = await getFrameRequestSummary("30");
    expect(failed?.rows).toEqual([]);
    expect(failed?.error).toMatch(/migration 0123/);

    mocks.isAdminConfigured.mockReturnValue(false);
    const unconfigured = await getFrameRequestSummary("30");
    expect(unconfigured?.rows).toEqual([]);
    expect(unconfigured?.error).toMatch(/admin key/i);
  });
});

describe("the page's order (D4)", () => {
  const rows = mapFrameRequestRows([
    { ...RPC_ROWS[0], signature: "future", n: 9, users: 1, last_seen: "2026-09-27T00:00:00.000Z" },
    { ...RPC_ROWS[0], signature: "japan-showcase", n: 2, users: 2, last_seen: "2026-09-20T00:00:00.000Z" },
    { ...RPC_ROWS[0], signature: "borderless/planeswalker", n: 5, users: 1, last_seen: "2026-09-26T00:00:00.000Z" },
    { ...RPC_ROWS[0], signature: "borderless/poster", n: 5, users: 1, last_seen: "2026-09-27T12:00:00.000Z" },
  ]);

  it("puts distinct users first, then requests, then the latest", () => {
    expect(sortFrameRequestRows(rows).map((row) => row.signature)).toEqual([
      "japan-showcase", // 2 users beat 9 requests from one
      "future",
      "borderless/poster", // 5 requests each: the later one first
      "borderless/planeswalker",
    ]);
    // Pure: the input keeps its order.
    expect(rows[0].signature).toBe("future");
  });

  it("is the order the summary hands the page, whatever order the RPC returned", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ is_admin: true });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({
      data: [
        { ...RPC_ROWS[0], signature: "future", n: 9, users: 1 },
        { ...RPC_ROWS[0], signature: "japan-showcase", n: 2, users: 2 },
      ],
      error: null,
    });
    const summary = await getFrameRequestSummary("30");
    expect(summary?.rows.map((row) => row.signature)).toEqual(["japan-showcase", "future"]);
  });
});

describe("window helpers", () => {
  it("parses the window param, defaulting to 30 days", () => {
    expect(parseFrameRequestWindow("90")).toBe("90");
    expect(parseFrameRequestWindow("all")).toBe("all");
    expect(parseFrameRequestWindow("7")).toBe("30");
    expect(parseFrameRequestWindow(undefined)).toBe("30");
  });

  it("turns a window into the RPC's since", () => {
    const now = Date.parse("2026-09-28T00:00:00.000Z");
    expect(windowSince("30", now)).toBe("2026-08-29T00:00:00.000Z");
    expect(windowSince("all", now)).toBeNull();
  });

  it("maps the cause, and reads anything but 'unverified' as missing (D1)", () => {
    const [unverified, missing, junk] = mapFrameRequestRows([
      { ...RPC_ROWS[0], cause: "unverified" },
      { ...RPC_ROWS[0], cause: "missing" },
      { ...RPC_ROWS[0], cause: "stale" },
    ]);
    expect([unverified.cause, missing.cause, junk.cause]).toEqual(["unverified", "missing", "missing"]);
  });

  it("flags a signature the registry doesn't know (D6)", () => {
    const [known, retired] = mapFrameRequestRows([
      RPC_ROWS[0],
      { ...RPC_ROWS[0], signature: "retired/seed-example" },
    ]);
    expect(known.inRegistry).toBe(true);
    expect(retired).toMatchObject({ inRegistry: false, forGood: false, blockedBy: null });
  });

  it("answers a crown / two-colour row logged before 4.6a / 4.6b where its frame draws the piece now (4.6 review)", () => {
    const at = (signature: string, template: string) =>
      mapFrameRequestRows([{ ...RPC_ROWS[0], signature, template }])[0];
    // Drawn now: the same printing imports exact today, and no item blocks it.
    for (const [signature, template] of [
      ["era/2015+crown", "m15"],
      ["era/2015+crown", "m15artifact"],
      ["era/2015+crown", "m15land"],
      ["era/2015+two-colour", "m15"],
      ["era/2015+two-colour", "m15land"],
      ["era/2015+two-colour-hybrid", "m15"],
    ]) {
      expect(at(signature, template), `${signature} on ${template}`).toMatchObject({ drawnNow: true, blockedBy: null });
    }
    // Still open, with the item that finishes it:
    for (const [signature, template] of [
      ["era/2015+crown", "m15snow"], // 4.6f's snow crown
      ["era/2015+crown", "m15devoid"],
      ["layout/2015+crown", "adventure"],
      // A borderless printing that landed on its bordered equivalent is not
      // exact however the landing frame is dressed.
      ["borderless/standard+crown", "m15"],
      ["token/m20+crown", "m15token"], // 4.48's pill crown
      // Logged before the hybrid dress had its own gap: may be a hybrid
      // artifact, which m15artifact doesn't draw yet.
      ["era/2015+two-colour", "m15artifact"],
      ["era/2015+two-colour-hybrid", "m15artifact"],
      ["era/2003+two-colour", "modern"],
    ]) {
      const row = at(signature, template);
      expect(row.drawnNow, `${signature} on ${template}`).toBe(false);
      expect(row.blockedBy, `${signature} on ${template}`).not.toBeNull();
    }
    // No template recorded, or an unknown signature: never answered.
    expect(at("era/2015+crown", null as unknown as string).drawnNow).toBe(false);
    expect(at("retired/seed+crown", "m15").drawnNow).toBe(false);
  });

  it("keeps an unknown template's raw key as its label", () => {
    const [row] = mapFrameRequestRows([{ ...RPC_ROWS[0], template: "retired-frame" }]);
    expect(row.templateLabel).toBe("retired-frame");
  });
});

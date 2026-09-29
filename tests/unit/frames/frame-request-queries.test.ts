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
  windowSince,
} from "@/lib/frames/frame-request-queries";

const RPC_ROWS = [
  {
    signature: "borderless/standard+crown",
    label: "Borderless frame",
    set_code: "dmu",
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
      count: 3,
      users: 2,
      forGood: false,
      blockedBy: "4.6",
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

  it("keeps an unknown template's raw key as its label", () => {
    const [row] = mapFrameRequestRows([{ ...RPC_ROWS[0], template: "retired-frame" }]);
    expect(row.templateLabel).toBe("retired-frame");
  });
});

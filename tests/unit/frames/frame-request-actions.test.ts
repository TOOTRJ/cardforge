import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// recordFrameRequestAction (TODO 1.6): validates the row, needs a session,
// writes through the USER's client (record_frame_request stamps auth.uid()),
// and never throws — the creator fires it and forgets it.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  createClient: mocks.createClient,
}));

// The write must never go through the service role.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("the admin client must not be used for this write");
  },
  isAdminConfigured: () => true,
}));

import { recordFrameRequestAction } from "@/lib/frames/frame-request-actions";

const ROW = {
  signature: "borderless/standard+crown",
  label: "Borderless frame",
  setCode: "dmu",
  collectorNumber: "435",
  scryfallId: "8df6603a-38c1-4d18-8b84-6211e9a7cc09",
  status: "nearest",
  template: "m15",
  artFlag: "window-cropped",
  source: "import",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.getCurrentUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe("recordFrameRequestAction", () => {
  it("writes the row through record_frame_request with the user's client", async () => {
    expect(await recordFrameRequestAction(ROW)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("record_frame_request", {
      p_signature: "borderless/standard+crown",
      p_label: "Borderless frame",
      p_set: "dmu",
      p_collector: "435",
      p_scryfall_id: "8df6603a-38c1-4d18-8b84-6211e9a7cc09",
      p_status: "nearest",
      p_template: "m15",
      p_art_flag: "window-cropped",
      p_source: "import",
    });
  });

  it("refuses an unknown signature without calling the database", async () => {
    expect(await recordFrameRequestAction({ ...ROW, signature: "made/up" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses other bad input (template, set code, status) and junk", async () => {
    for (const bad of [
      { ...ROW, template: "notaframe" },
      { ...ROW, setCode: "DROP TABLE" },
      { ...ROW, status: "exact" },
      null,
      "borderless/standard",
    ]) {
      expect(await recordFrameRequestAction(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a guest", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await recordFrameRequestAction(ROW)).toEqual({ ok: false, error: "signed-out" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never throws: an RPC error (no migration 0120 on this database) is a quiet failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.record_frame_request" },
    });
    await expect(recordFrameRequestAction(ROW)).resolves.toEqual({ ok: false, error: "rpc" });
  });

  it("never throws: a client that blows up is a quiet failure too", async () => {
    mocks.createClient.mockRejectedValue(new Error("cookies() outside a request"));
    await expect(recordFrameRequestAction(ROW)).resolves.toEqual({ ok: false, error: "failed" });
    mocks.getCurrentUser.mockRejectedValue(new Error("auth down"));
    await expect(recordFrameRequestAction(ROW)).resolves.toEqual({ ok: false, error: "failed" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chainClient,
  called,
  payloadOf,
  type ChainAnswer,
} from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Frame layout override actions. Contract: admin gate first; Save upserts
// and marks the template's baked renders stale; Reset (and an empty Save)
// deletes the row and marks renders stale ONLY when a row existed — a
// draft-only reset must not null layout_version across the template; the
// read cache is refreshed with updateTag (read-your-own-writes), never the
// stale-while-revalidate revalidateTag.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  configured: true,
  client: null as unknown,
}));
const cache = vi.hoisted(() => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // The read module (imported for its tag constant) wraps its loader in
  // unstable_cache at import time; pass the function through untouched.
  unstable_cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => state.profile,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => state.configured,
}));
vi.mock("next/cache", () => cache);

import {
  resetFrameProfileOverrideAction,
  saveFrameProfileOverrideAction,
} from "@/lib/cards/frame-profile-override-actions";
import { FRAME_PROFILE_OVERRIDES_TAG } from "@/lib/cards/frame-profile-overrides";
import { staleTemplateFilter } from "@/lib/cards/frame-override-stale";

type Candidate = { id: string; layout_version: number | null; rarity?: string };

/** Baked, published cards on the template (what the mark scan reads). By
 *  default every `staleIds` card is current (v23) and so gets marked. */
function candidatesFor(opts: { staleIds?: string[]; candidates?: Candidate[] }): Candidate[] {
  return opts.candidates ?? (opts.staleIds ?? ["c1", "c2"]).map((id) => ({ id, layout_version: 23 }));
}

function db(opts: { existingRow?: boolean; staleIds?: string[]; candidates?: Candidate[] } = {}) {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "frame_profile_overrides" && called(calls, "delete")) {
      return { data: opts.existingRow ? [{ template: "saga" }] : [] };
    }
    if (table === "frame_profile_overrides" && called(calls, "upsert")) {
      return { error: null };
    }
    if (table === "cards" && called(calls, "update")) {
      const ids = (calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1] ?? []) as string[];
      return { data: ids.map((id) => ({ id })) };
    }
    if (table === "cards" && called(calls, "select")) {
      return {
        data: candidatesFor(opts).map((c) => ({
          visibility: "public",
          rendered_image_url: "https://cdn/r.png",
          frame_style: { template: "saga" },
          rarity: "uncommon",
          set_icon_url: null,
          set_icon_code: null,
          ...c,
        })),
      };
    }
    return {};
  });
  state.client = stub.client;
  return stub;
}

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.configured = true;
  cache.updateTag.mockClear();
  cache.revalidatePath.mockClear();
  cache.revalidateTag.mockClear();
});

describe("saveFrameProfileOverrideAction", () => {
  it("refuses non-admins before touching the database", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    const result = await saveFrameProfileOverrideAction({
      template: "saga",
      overrides: { title: { rect: { topPct: 5 } } },
    });
    expect(result).toEqual({ ok: false, error: "Not authorized." });
    expect(stub.log).toHaveLength(0);
  });

  it("rejects an override the schema does not allow", async () => {
    db();
    const result = await saveFrameProfileOverrideAction({
      template: "saga",
      overrides: { title: { colorHex: "#fff" } },
    });
    expect(result.ok).toBe(false);
  });

  it("upserts, marks the template's renders stale and refreshes the cache", async () => {
    const stub = db({ staleIds: ["a", "b", "c"] });
    const result = await saveFrameProfileOverrideAction({
      template: "saga",
      overrides: { title: { rect: { topPct: 5 } } },
    });
    expect(result).toEqual({ ok: true, staleCount: 3, keptForOwner: 0, changed: true });

    const upsert = stub.forTable("frame_profile_overrides")[0];
    expect(payloadOf(upsert.calls, "upsert")).toMatchObject({
      template: "saga",
      overrides: { title: { rect: { topPct: 5 } } },
      updated_by: ADMIN,
    });

    const [scan, stale] = stub.forTable("cards");
    expect(called(scan.calls, "filter", "frame_style->>template")).toBe(true);
    expect(payloadOf(stale.calls, "update")).toEqual({ layout_version: null });
    expect(stale.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["a", "b", "c"]);
    expect(cache.updateTag).toHaveBeenCalledWith(FRAME_PROFILE_OVERRIDES_TAG);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it("treats an empty override as a reset and is a no-op without a saved row", async () => {
    const stub = db({ existingRow: false });
    const result = await saveFrameProfileOverrideAction({
      template: "saga",
      overrides: {},
    });
    expect(result).toEqual({ ok: true, staleCount: 0, keptForOwner: 0, changed: false });
    expect(stub.forTable("cards")).toHaveLength(0);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe("resetFrameProfileOverrideAction", () => {
  it("deletes the row, marks renders stale and refreshes the cache when a row existed", async () => {
    const stub = db({ existingRow: true, staleIds: ["x"] });
    const result = await resetFrameProfileOverrideAction({ template: "saga" });
    expect(result).toEqual({ ok: true, staleCount: 1, keptForOwner: 0, changed: true });
    const del = stub.forTable("frame_profile_overrides")[0];
    expect(called(del.calls, "delete")).toBe(true);
    expect(called(del.calls, "select", "template")).toBe(true);
    // One scan of the template's baked cards, one update of the ids to mark.
    expect(stub.forTable("cards")).toHaveLength(2);
    expect(cache.updateTag).toHaveBeenCalledWith(FRAME_PROFILE_OVERRIDES_TAG);
  });

  it("does NOT mark renders stale when there was nothing to reset", async () => {
    const stub = db({ existingRow: false });
    const result = await resetFrameProfileOverrideAction({ template: "saga" });
    expect(result).toEqual({ ok: true, staleCount: 0, keptForOwner: 0, changed: false });
    expect(stub.forTable("cards")).toHaveLength(0);
    expect(cache.updateTag).not.toHaveBeenCalled();
    // The checklist still re-renders so the "override active" badge is right.
    expect(cache.revalidatePath).toHaveBeenCalledWith("/admin/frame-compare");
  });

  it("leaves cards with a pending opt-in look alone and counts the already-marked", async () => {
    const stub = db({
      existingRow: true,
      candidates: [
        { id: "current", layout_version: 23 },
        // v21: the owner hasn't accepted the v22 (opt-in) typography — a
        // re-bake would force it on them and drop their badge.
        { id: "owner-choice", layout_version: 21 },
        // Marked by an earlier save: owed already, nothing to update.
        { id: "marked", layout_version: null },
      ],
    });
    const result = await resetFrameProfileOverrideAction({ template: "saga" });
    expect(result).toEqual({ ok: true, staleCount: 2, keptForOwner: 1, changed: true });
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"));
    expect(update?.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["current"]);
  });

  it("uses the default-template filter (NULL + legacy values) for m15", async () => {
    const stub = db({ existingRow: true });
    await resetFrameProfileOverrideAction({ template: "m15" });
    const stale = stub.forTable("cards")[0];
    const orCall = stale.calls.find((c) => c.method === "or");
    expect(orCall).toBeDefined();
    const filter = staleTemplateFilter("m15");
    expect(filter.kind).toBe("or");
    expect(orCall?.args[0]).toBe(filter.kind === "or" ? filter.expression : "");
  });
});

describe("staleTemplateFilter", () => {
  it("matches only the template for non-default templates", () => {
    expect(staleTemplateFilter("saga")).toEqual({ kind: "eq", template: "saga" });
  });

  it("matches NULL and legacy/unknown values for the default template", () => {
    const filter = staleTemplateFilter("m15");
    expect(filter.kind).toBe("or");
    if (filter.kind !== "or") return;
    expect(filter.expression).toContain("frame_style->>template.eq.m15");
    expect(filter.expression).toContain("frame_style->>template.is.null");
    expect(filter.expression).toMatch(/frame_style->>template\.not\.in\.\(m15,/);
    // Every real template is in the exclusion list, so a saved saga card is
    // never mistaken for a legacy default-frame card.
    expect(filter.expression).toContain(",saga,");
  });
});

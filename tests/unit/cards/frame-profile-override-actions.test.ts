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
// The art-window gate (lib/frames/art-window-override.ts) is tested on its
// own; here, what the action does with its answer.
const artGate = vi.hoisted(() => ({
  refusal: null as string | null,
  calls: [] as unknown[][],
}));
vi.mock("@/lib/frames/art-window-override", () => ({
  artSlotOverrideRefusal: async (...args: unknown[]) => {
    artGate.calls.push(args);
    return artGate.refusal;
  },
}));
// Pinned at layout v30: v31 (the one corner radius) is an UNSCOPED sweep, so
// at v31 no older bake has only the v22 opt-in pending (the "kept for the
// owner" case). tests/stubs/layout-version-at.ts explains.
vi.mock("@/lib/cards/layout-version", async (importOriginal) => {
  const { layoutVersionAt } = await import("@/tests/stubs/layout-version-at");
  return layoutVersionAt(await importOriginal(), 30);
});

import {
  resetFrameProfileOverrideAction,
  saveFrameProfileOverrideAction,
} from "@/lib/cards/frame-profile-override-actions";
import { FRAME_PROFILE_OVERRIDES_TAG } from "@/lib/cards/frame-profile-overrides";
import { staleBackBodyFilter, staleTemplateFilter } from "@/lib/cards/frame-override-stale";
import { isDfcBackBody } from "@/lib/cards/dfc";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { UNTOUCHED_SINCE_V22 } from "@/tests/stubs/layout-scope-cards";
import { SCOPE_CARD_COLUMNS } from "@/lib/cards/bake-select";

type Candidate = { id: string; layout_version: number | null } & Record<string, unknown>;

/** Baked, published cards on the template (what the mark scan reads). By
 *  default every `staleIds` card is current (v23) and so gets marked. */
function candidatesFor(opts: { staleIds?: string[]; candidates?: Candidate[] }): Candidate[] {
  return opts.candidates ?? (opts.staleIds ?? ["c1", "c2"]).map((id) => ({ id, layout_version: 23 }));
}

function db(
  opts: {
    existingRow?: boolean;
    staleIds?: string[];
    candidates?: Candidate[];
    /** What the BACK-body scan (back_face->frame_style->>template) reads. */
    backCandidates?: Candidate[];
  } = {},
) {
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
      const backScan = called(calls, "filter", "back_face->frame_style->>template");
      return {
        data: (backScan ? (opts.backCandidates ?? []) : candidatesFor(opts)).map((c) => ({
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
  artGate.refusal = null;
  artGate.calls = [];
  cache.updateTag.mockReset();
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

  it("refuses an art slot the art-window check fails — before any write", async () => {
    artGate.refusal = "The art slot leaves the m15/w frame's art window uncovered (the art-window check, TODO 7.6) — nothing was saved. …";
    const stub = db();
    const overrides = { artSlot: { topPct: 11.4, heightPct: 44 } };
    const result = await saveFrameProfileOverrideAction({ template: "m15", overrides });
    expect(result).toEqual({ ok: false, error: artGate.refusal });
    expect(artGate.calls).toEqual([["m15", overrides]]);
    // Nothing saved, no render marked, no cache refreshed, no history row.
    expect(stub.log).toHaveLength(0);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it("asks the art-window check on every save that writes a row, and saves when it passes", async () => {
    const stub = db({ staleIds: ["a"] });
    const overrides = { artSlot: { topPct: 11.25 } };
    const result = await saveFrameProfileOverrideAction({ template: "m15", overrides });
    expect(result).toEqual({ ok: true, staleCount: 1, keptForOwner: 0, changed: true });
    expect(artGate.calls).toEqual([["m15", overrides]]);
    expect(payloadOf(stub.forTable("frame_profile_overrides")[0].calls, "upsert")).toMatchObject({ template: "m15", overrides });
    // A reset (an empty override) never asks: it returns to the code profile.
    artGate.calls = [];
    db({ existingRow: true });
    await saveFrameProfileOverrideAction({ template: "m15", overrides: {} });
    await resetFrameProfileOverrideAction({ template: "m15" });
    expect(artGate.calls).toEqual([]);
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

describe("the read cache is busted BEFORE any card is marked stale", () => {
  // A save bake reads the CACHED overrides and has no stamp guard: marking
  // first left a window where it drew the OLD map and persisted a current
  // stamp over the mark.
  function orderOf(run: () => Promise<unknown>, opts: Parameters<typeof db>[0]) {
    const order: string[] = [];
    const stub = db(opts);
    const from = (stub.client as { from: (t: string) => unknown }).from;
    (stub.client as { from: (t: string) => unknown }).from = (table: string) => {
      order.push(`from:${table}`);
      return from(table);
    };
    cache.updateTag.mockImplementation(() => void order.push("updateTag"));
    return run().then(() => order);
  }

  it("on a save: row written, tag busted, then the cards scanned and marked", async () => {
    const order = await orderOf(
      () => saveFrameProfileOverrideAction({ template: "saga", overrides: { title: { rect: { topPct: 5 } } } }),
      { staleIds: ["a"] },
    );
    expect(order.slice(0, 3)).toEqual(["from:frame_profile_overrides", "updateTag", "from:cards"]);
    expect(order.filter((o) => o === "updateTag")).toHaveLength(1);
  });

  it("on a reset (and an empty save): row deleted, tag busted, then the cards", async () => {
    for (const run of [
      () => resetFrameProfileOverrideAction({ template: "saga" }),
      () => saveFrameProfileOverrideAction({ template: "saga", overrides: {} }),
    ]) {
      const order = await orderOf(run, { existingRow: true, staleIds: ["a"] });
      expect(order.slice(0, 3)).toEqual(["from:frame_profile_overrides", "updateTag", "from:cards"]);
    }
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
    // Cards no sweep since v22 changed (UNTOUCHED_SINCE_V22, on lotr), so the
    // v22 opt-in is the only look pending on the v21 one.
    const stub = db({
      existingRow: true,
      candidates: [
        { ...UNTOUCHED_SINCE_V22, id: "current", layout_version: 23 },
        // v21: the owner hasn't accepted the v22 (opt-in) typography — a
        // re-bake would force it on them and drop their badge.
        { ...UNTOUCHED_SINCE_V22, id: "owner-choice", layout_version: 21 },
        // A v21 card that ALSO owes a sweep (a two-word name: layout v29's
        // word spacing) has no choice to keep — the sweep re-bakes it anyway.
        { ...UNTOUCHED_SINCE_V22, id: "owes-a-sweep", layout_version: 21, title: "Red Worm" },
        // Marked by an earlier save: owed already, nothing to update.
        { ...UNTOUCHED_SINCE_V22, id: "marked", layout_version: null },
      ],
    });
    const result = await resetFrameProfileOverrideAction({ template: "lotr" });
    expect(result).toEqual({ ok: true, staleCount: 3, keptForOwner: 1, changed: true });
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"));
    expect(update?.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual([
      "current",
      "owes-a-sweep",
    ]);
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

describe("a BACK body's save marks the cards whose back face is drawn on it (admin audit M1)", () => {
  const BACK_BODIES = FRAME_TEMPLATE_VALUES.filter((t) => isDfcBackBody(t));
  const dfc = (id: string, back: string, patch: Partial<Candidate> = {}): Candidate => ({
    id,
    layout_version: 23,
    frame_style: { template: "m15dfcfront" },
    back_face: { title: "Back", frame_style: { template: back } },
    ...patch,
  });

  it("knows the back bodies: every one has a back filter, no other template does", () => {
    expect(BACK_BODIES).toEqual(expect.arrayContaining(["m15dfcback", "m15dfcbackleft", "m15mdfcback"]));
    for (const t of FRAME_TEMPLATE_VALUES) {
      const filter = staleBackBodyFilter(t);
      if (isDfcBackBody(t)) expect(filter).toEqual({ column: "back_face->frame_style->>template", template: t });
      else expect(filter).toBeNull();
    }
  });

  it("marks exactly the cards whose back is drawn on the body, and counts them", async () => {
    const stub = db({
      existingRow: true,
      // No card wears a back body as its own template.
      candidates: [],
      backCandidates: [
        dfc("drawn", "m15dfcback"),
        // Marked by an earlier save: counted, not updated again.
        dfc("already", "m15dfcback", { layout_version: null }),
        // The value is stored, but its front holds no back: the renderer
        // draws it on the front's frame (a legacy flip) and bakes no back.
        dfc("not-drawn", "m15dfcback", { frame_style: { template: "m15" } }),
        // Another body (the SQL filter would not return it; the code
        // narrowing must not mark it either).
        dfc("other-body", "m15dfcbackleft"),
      ],
    });
    const result = await saveFrameProfileOverrideAction({
      template: "m15dfcback",
      overrides: { title: { rect: { topPct: 5 } } },
    });
    expect(result).toEqual({ ok: true, staleCount: 2, keptForOwner: 0, changed: true });
    const scans = stub.forTable("cards").filter((e) => !called(e.calls, "update"));
    expect(scans).toHaveLength(2);
    expect(called(scans[0].calls, "filter", "frame_style->>template")).toBe(true);
    expect(scans[1].calls.find((c) => c.method === "filter")?.args).toEqual([
      "back_face->frame_style->>template",
      "eq",
      "m15dfcback",
    ]);
    // Published, baked cards only — the same scope as the front scan.
    expect(called(scans[1].calls, "in", "visibility")).toBe(true);
    expect(called(scans[1].calls, "not", "rendered_image_url")).toBe(true);
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(update.calls, "update")).toEqual({ layout_version: null });
    expect(update.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["drawn"]);
  });

  it("a reset of a back body marks them too", async () => {
    const stub = db({ existingRow: true, candidates: [], backCandidates: [dfc("drawn", "m15mdfcback")] });
    const result = await resetFrameProfileOverrideAction({ template: "m15mdfcback" });
    expect(result).toEqual({ ok: true, staleCount: 1, keptForOwner: 0, changed: true });
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(update.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["drawn"]);
  });

  it("a card both scans find is marked and counted once", async () => {
    const both = dfc("both", "m15dfcback", { frame_style: { template: "m15dfcback" } });
    const stub = db({ existingRow: true, candidates: [both], backCandidates: [dfc("both", "m15dfcback")] });
    const result = await resetFrameProfileOverrideAction({ template: "m15dfcback" });
    expect(result).toEqual({ ok: true, staleCount: 1, keptForOwner: 0, changed: true });
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(update.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["both"]);
  });

  it("a front-only template runs the one front scan, as before — never a back scan", async () => {
    for (const template of ["saga", "m15", "m15dfcfront", "m15mdfcfront"] as const) {
      const stub = db({ existingRow: true, staleIds: ["x"], backCandidates: [dfc("back-only", "m15dfcback")] });
      const result = await resetFrameProfileOverrideAction({ template });
      expect(result).toEqual({ ok: true, staleCount: 1, keptForOwner: 0, changed: true });
      const scans = stub.forTable("cards").filter((e) => !called(e.calls, "update"));
      expect(scans).toHaveLength(1);
      expect(called(scans[0].calls, "filter", "back_face->frame_style->>template")).toBe(false);
    }
  });
});

describe("the mark scan reads every scope column", () => {
  it("selects SCOPE_CARD_COLUMNS (v72's nickname, typed types and credit too): a column left out null-stamps cards that owe nothing", async () => {
    const stub = db({ existingRow: true });
    await saveFrameProfileOverrideAction({ template: "saga", overrides: { title: { rect: { topPct: 5 } } } });
    const scans = stub.forTable("cards").filter((e) => called(e.calls, "select") && !called(e.calls, "update"));
    expect(scans.length).toBeGreaterThan(0);
    for (const scan of scans) {
      const columns = String(scan.calls.find((c) => c.method === "select")?.args[0]).split(", ");
      for (const column of SCOPE_CARD_COLUMNS) expect(columns, column).toContain(column);
      for (const column of ["id", "visibility", "layout_version", "rendered_image_url"]) expect(columns).toContain(column);
    }
  });
});

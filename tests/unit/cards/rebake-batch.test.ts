import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The shared re-bake batch (lib/cards/rebake-batch.ts) behind the cron route
// and the compare page's "Re-bake now". Contract: the "marked" scope picks
// baked null-stamp published cards and always re-bakes them; skipIds are
// never picked again; a dry run writes nothing; a failed render is reported
// and not counted as remaining; a re-bake stamps the CURRENT version; and
// the overlap guards (review of TODO 0.20) never let a render that raced an
// owner edit, an unpublish or a newer layout save be written.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  render: vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]))),
  upload: vi.fn(async () => ({ ok: true as const, renderedImageUrl: "https://cdn/r.png?v=2", renderedThumbUrl: "https://cdn/r.webp?v=2" })),
  remove: vi.fn(async () => {}),
  art: vi.fn(async () => ({ ok: true as const, artUrl: null as string | null })),
}));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: mocks.render }));
vi.mock("@/lib/cards/bake-render", () => ({ resolveBakeArt: mocks.art }));
vi.mock("@/lib/cards/bake-core", () => ({
  BAKE_SELECT_COLUMNS: "id, owner_id, visibility, updated_at, art_url, frame_style",
  rowToPreviewData: () => ({ title: "x" }),
  uploadRenderObjects: mocks.upload,
  removeRenderObject: mocks.remove,
}));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/cards/storage-paths", () => ({ cardRenderPath: (o: string, c: string) => `${o}/${c}.png` }));

import {
  countMarkedRenders,
  parseRebakeScope,
  rebakeVerdictFor,
  runRebakeBatch,
  type RebakeRow,
} from "@/lib/cards/rebake-batch";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";

const row = (id: string, patch: Partial<RebakeRow> = {}): RebakeRow =>
  ({
    id,
    owner_id: "owner-1",
    art_url: null,
    frame_style: { template: "m15" },
    visibility: "public",
    updated_at: "2026-09-20T00:00:00Z",
    layout_version: null,
    rendered_image_url: "https://cdn/old.png",
    rendered_at: "2026-09-01T00:00:00Z",
    rarity: "uncommon",
    ...patch,
  }) as unknown as RebakeRow;

type DbOptions = {
  /** What the pre-upload re-read of a card returns (default: unchanged). */
  fresh?: (id: string) => { updated_at: string; visibility: string } | null;
  /** frame_profile_overrides at batch start / at the pre-upload re-read. */
  overridesAtStart?: Array<{ template: string; updated_at: string }>;
  overrideNow?: { updated_at: string } | null;
  /** The compare-and-set write matches no row. */
  casLost?: boolean;
  /** visibility after a lost write. */
  nowVisibility?: string;
  /** Exact marked count after the batch, and among the ids asked about. */
  markedCount?: number;
  markedAmongIds?: number;
  /** Override stamp answered on the Nth pre-/post-upload re-read. */
  overrideSequence?: Array<{ updated_at: string } | null>;
  /** layout_version the pre-upload re-read sees (default null). */
  freshStamp?: number | null;
  /** The conditional stamp write matches no row. */
  stampLost?: boolean;
  countError?: boolean;
};

function db(rows: RebakeRow[], opts: DbOptions = {}) {
  const fresh =
    opts.fresh ??
    ((id: string) => {
      const r = rows.find((x) => x.id === id);
      return r ? { updated_at: r.updated_at, visibility: r.visibility } : null;
    });
  let overrideReads = 0;
  return chainClient((table, calls: ChainCall[]): ChainAnswer => {
    if (table === "frame_profile_overrides") {
      if (called(calls, "maybeSingle")) {
        const seq = opts.overrideSequence;
        const answer = seq ? seq[Math.min(overrideReads, seq.length - 1)] : (opts.overrideNow ?? null);
        overrideReads += 1;
        return { data: answer };
      }
      return { data: opts.overridesAtStart ?? [] };
    }
    if (table !== "cards") return {};
    if (called(calls, "update")) {
      const payload = payloadOf(calls, "update") as { layout_version?: number | null; rendered_image_url?: string };
      if (payload.rendered_image_url === undefined && payload.layout_version === CARD_LAYOUT_VERSION) {
        return { data: opts.stampLost ? [] : [{ id: "stamped" }] };
      }
      return { data: opts.casLost ? [] : [{ id: "written" }] };
    }
    const select = calls.find((c) => c.method === "select");
    if ((select?.args[1] as { head?: boolean } | undefined)?.head) {
      if (opts.countError) return { error: { message: "count failed" } };
      return { count: called(calls, "in", "id") ? (opts.markedAmongIds ?? 0) : (opts.markedCount ?? 0) };
    }
    if (select?.args[0] === "updated_at, visibility, layout_version") {
      const id = calls.find((c) => c.method === "eq")?.args[1] as string;
      const f = fresh(id);
      return { data: f ? { ...f, layout_version: opts.freshStamp ?? null } : null };
    }
    if (select?.args[0] === "visibility") return { data: { visibility: opts.nowVisibility ?? "public" } };
    return { data: rows };
  });
}

const run = (stub: ReturnType<typeof db>, extra: Partial<Parameters<typeof runRebakeBatch>[1]> = {}) =>
  runRebakeBatch(stub.client as never, {
    scope: { kind: "marked" },
    limit: 8,
    dry: false,
    billingEnabled: true,
    ...extra,
  });

beforeEach(() => {
  mocks.render.mockClear();
  mocks.upload.mockClear();
  mocks.remove.mockClear();
  mocks.art.mockClear();
  mocks.art.mockResolvedValue({ ok: true, artUrl: null });
});

describe("parseRebakeScope", () => {
  it("accepts marked, sweep, sweep-policy versions and legacy-art", () => {
    expect(parseRebakeScope(new URLSearchParams("scope=marked"))).toEqual({ kind: "marked" });
    expect(parseRebakeScope(new URLSearchParams("scope=sweep"))).toEqual({ kind: "sweep" });
    expect(parseRebakeScope(new URLSearchParams("scope=version&version=23"))).toEqual({ kind: "version", version: 23 });
    expect(parseRebakeScope(new URLSearchParams("scope=legacy-art&before=2026-09-01T00:00:00Z"))).toEqual({
      kind: "legacy-art",
      before: "2026-09-01T00:00:00Z",
    });
  });

  it("refuses an opt-in version, a missing scope and a bad legacy date", () => {
    expect(parseRebakeScope(new URLSearchParams("scope=version&version=22"))).toHaveProperty("error");
    expect(parseRebakeScope(new URLSearchParams(""))).toHaveProperty("error");
    expect(parseRebakeScope(new URLSearchParams("scope=legacy-art&before=nope"))).toHaveProperty("error");
  });
});

describe("rebakeVerdictFor", () => {
  it("always re-bakes a marked row; the sweep leaves opt-in-only rows alone", () => {
    expect(rebakeVerdictFor(row("a", { layout_version: 21 }), { kind: "marked" })).toBe("rebake");
    expect(rebakeVerdictFor(row("a", { layout_version: 21 }), { kind: "sweep" })).toBe("opt-in");
    expect(rebakeVerdictFor(row("a", { layout_version: null }), { kind: "sweep" })).toBe("rebake");
  });
});

describe("runRebakeBatch", () => {
  it("marked scope: baked null stamps only, re-bakes, compare-and-set write at the current version", async () => {
    const stub = db([row("c1"), row("c2")]);
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.processed.map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(result.remaining).toBe(0);
    const scan = stub.forTable("cards")[0].calls;
    expect(called(scan, "is", "layout_version")).toBe(true);
    // A failed bake (no render) is not "marked" — a layout change never
    // touches it and a retry fails the same way (found on the dev DB: 19
    // art-less cards retried and reported on every run).
    expect(called(scan, "not", "rendered_image_url")).toBe(true);
    const updates = stub.forTable("cards").filter((e) => called(e.calls, "update"));
    expect(updates).toHaveLength(2);
    expect(payloadOf(updates[0].calls, "update")).toMatchObject({
      layout_version: CARD_LAYOUT_VERSION,
      rendered_image_url: "https://cdn/r.png?v=2",
    });
    expect(called(updates[0].calls, "eq", "updated_at")).toBe(true);
    expect(called(updates[0].calls, "in", "visibility")).toBe(true);
    // Watermarked bake when billing is on.
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), "hd", { brandMark: true, watermarkText: null });
  });

  it("never picks a skipped id, sizes the page to limit + skips, counts remaining exactly", async () => {
    const stub = db([row("c1"), row("c2"), row("c3")], { markedCount: 2, markedAmongIds: 1 });
    const result = await run(stub, { limit: 1, skipIds: ["c1"] });
    if (!result.ok) throw new Error(result.error);
    expect(result.processed.map((p) => p.id)).toEqual(["c2"]);
    // c1 (skipped) + c3 are still marked; the skip doesn't count.
    expect(result.remaining).toBe(1);
    const range = stub.forTable("cards")[0].calls.find((c) => c.method === "range");
    expect(range?.args).toEqual([0, 1]);
  });

  it("reports a failed render without counting it as remaining work", async () => {
    mocks.art.mockResolvedValueOnce({ ok: false, error: "art host refused" } as never);
    const stub = db([row("bad"), row("good")], { markedCount: 1, markedAmongIds: 1 });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.failed).toEqual([{ id: "bad", error: "art host refused" }]);
    expect(result.processed.map((p) => p.id)).toEqual(["good"]);
    expect(result.remaining).toBe(0);
  });

  it("an owner save during the render supersedes it: nothing uploaded or written", async () => {
    const stub = db([row("c1")], {
      fresh: () => ({ updated_at: "2026-09-25T12:00:00Z", visibility: "public" }),
      markedCount: 0,
    });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(result.processed).toEqual([]);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(stub.forTable("cards").some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("a card unpublished during the render is never uploaded", async () => {
    const stub = db([row("c1")], { fresh: () => ({ updated_at: "2026-09-20T00:00:00Z", visibility: "private" }) });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("a layout save during the batch supersedes the render (the card stays marked)", async () => {
    const stub = db([row("c1")], {
      overridesAtStart: [{ template: "m15", updated_at: "2026-09-25T10:00:00Z" }],
      overrideNow: { updated_at: "2026-09-25T10:00:09Z" },
      markedCount: 1,
    });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(result.remaining).toBe(1);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("a layout save during the UPLOAD re-marks the card instead of leaving it 'current'", async () => {
    // Guard read sees the batch-start stamp; the post-write read sees a newer save.
    const stub = db([row("c1")], {
      overridesAtStart: [{ template: "m15", updated_at: "T1" }],
      overrideSequence: [{ updated_at: "T1" }, { updated_at: "T2" }],
      markedCount: 1,
    });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(result.processed).toEqual([]);
    const updates = stub.forTable("cards").filter((e) => called(e.calls, "update"));
    const remark = updates[updates.length - 1];
    expect(payloadOf(remark.calls, "update")).toEqual({ layout_version: null });
    // Only if the row still holds the render this batch wrote.
    expect(called(remark.calls, "eq", "rendered_at")).toBe(true);
  });

  it("skips a marked card another run already re-baked", async () => {
    const stub = db([row("c1")], { freshStamp: CARD_LAYOUT_VERSION });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("stamps conditionally: a layout save that nulled the card since the scan wins", async () => {
    // v22 uncommon m15: v23 didn't change it → the sweep only stamps it.
    const stub = db([row("c1", { layout_version: 22 })], { stampLost: true });
    const result = await run(stub, { scope: { kind: "sweep" } });
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    const stamp = stub.forTable("cards").find((e) => called(e.calls, "update"));
    expect(called(stamp!.calls, "eq", "layout_version")).toBe(true);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("fails the call when the remaining count can't be read (never 'nothing left')", async () => {
    const stub = db([row("c1")], { countError: true });
    const result = await run(stub);
    expect(result.ok).toBe(false);
  });

  it("a lost compare-and-set on a card that just went private removes the uploaded objects", async () => {
    const stub = db([row("c1")], { casLost: true, nowVisibility: "private" });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(result.processed).toEqual([]);
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), "owner-1/c1.png");
  });

  it("a lost compare-and-set on a still-public card keeps the objects (the newer bake owns them)", async () => {
    const stub = db([row("c1")], { casLost: true, nowVisibility: "public" });
    const result = await run(stub);
    if (!result.ok) throw new Error(result.error);
    expect(result.superseded).toEqual(["c1"]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("a dry run plans without rendering or writing", async () => {
    const stub = db([row("c1"), row("c2", { layout_version: 21 })]);
    const result = await runRebakeBatch(stub.client as never, {
      scope: { kind: "sweep" },
      limit: 8,
      dry: true,
      billingEnabled: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.plan).toEqual({ rebake: 1, stamp: 0, optIn: 1 });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(stub.forTable("cards").some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("surfaces a scan error", async () => {
    const stub = chainClient(() => ({ error: { message: "boom" } }));
    const result = await runRebakeBatch(stub.client as never, {
      scope: { kind: "marked" },
      limit: 8,
      dry: false,
      billingEnabled: true,
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("countMarkedRenders", () => {
  it("throws on a query error and counts among ids in chunks", async () => {
    const failing = chainClient(() => ({ error: { message: "boom" } }));
    await expect(countMarkedRenders(failing.client as never)).rejects.toThrow(/boom/);
    const stub = chainClient(() => ({ count: 3 }));
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    expect(await countMarkedRenders(stub.client as never, ids)).toBe(9);
    expect(stub.forTable("cards")).toHaveLength(3);
    expect(await countMarkedRenders(stub.client as never, [])).toBe(0);
  });

  it("counts published, baked null-stamp cards", async () => {
    const stub = chainClient(() => ({ count: 7 }));
    expect(await countMarkedRenders(stub.client as never)).toBe(7);
    const calls = stub.forTable("cards")[0].calls;
    expect(called(calls, "is", "layout_version")).toBe(true);
    expect(called(calls, "not", "rendered_image_url")).toBe(true);
    expect(called(calls, "in", "visibility")).toBe(true);
  });
});

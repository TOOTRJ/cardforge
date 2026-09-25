import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The shared re-bake batch (lib/cards/rebake-batch.ts) behind the cron route
// and the compare page's "Re-bake now". Contract: the "marked" scope picks
// null-stamp published cards and always re-bakes them; skipIds are never
// picked again (one unbakeable card can't wedge a client loop); a dry run
// writes nothing; a failed render is reported and not counted as remaining;
// a re-bake stamps the CURRENT layout version.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  render: vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]))),
  upload: vi.fn(async () => ({ ok: true as const, renderedImageUrl: "https://cdn/r.png?v=2", renderedThumbUrl: "https://cdn/r.webp?v=2" })),
  art: vi.fn(async () => ({ ok: true as const, artUrl: null as string | null })),
}));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: mocks.render }));
vi.mock("@/lib/cards/bake-render", () => ({ resolveBakeArt: mocks.art }));
vi.mock("@/lib/cards/bake-core", () => ({
  BAKE_SELECT_COLUMNS: "id, owner_id, art_url, frame_style",
  rowToPreviewData: () => ({ title: "x" }),
  uploadRenderObjects: mocks.upload,
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
    layout_version: null,
    rendered_image_url: "https://cdn/old.png",
    rendered_at: "2026-09-01T00:00:00Z",
    rarity: "uncommon",
    ...patch,
  }) as unknown as RebakeRow;

function db(rows: RebakeRow[]) {
  return chainClient((table, calls: ChainCall[]): ChainAnswer => {
    if (table === "cards" && called(calls, "select") && !called(calls, "update")) {
      return { data: rows };
    }
    if (table === "cards" && called(calls, "update")) return { error: null };
    return {};
  });
}

beforeEach(() => {
  mocks.render.mockClear();
  mocks.upload.mockClear();
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
  it("marked scope: filters null stamps, re-bakes, stamps the current version", async () => {
    const stub = db([row("c1"), row("c2")]);
    const result = await runRebakeBatch(stub.client as never, {
      scope: { kind: "marked" },
      limit: 8,
      dry: false,
      billingEnabled: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.processed.map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(result.remaining).toBe(0);
    const scan = stub.forTable("cards")[0].calls;
    expect(called(scan, "is", "layout_version")).toBe(true);
    const updates = stub.forTable("cards").filter((e) => called(e.calls, "update"));
    expect(updates).toHaveLength(2);
    expect(payloadOf(updates[0].calls, "update")).toMatchObject({
      layout_version: CARD_LAYOUT_VERSION,
      rendered_image_url: "https://cdn/r.png?v=2",
    });
    // Watermarked bake when billing is on.
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), "hd", { brandMark: true, watermarkText: null });
  });

  it("never picks a skipped id and caps the batch at the limit", async () => {
    const stub = db([row("c1"), row("c2"), row("c3")]);
    const result = await runRebakeBatch(stub.client as never, {
      scope: { kind: "marked" },
      limit: 1,
      dry: false,
      billingEnabled: true,
      skipIds: ["c1"],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.processed.map((p) => p.id)).toEqual(["c2"]);
    expect(result.plan.rebake).toBe(2);
    expect(result.remaining).toBe(1);
  });

  it("reports a failed render without counting it as remaining work", async () => {
    mocks.art.mockResolvedValueOnce({ ok: false, error: "art host refused" } as never);
    const stub = db([row("bad"), row("good")]);
    const result = await runRebakeBatch(stub.client as never, {
      scope: { kind: "marked" },
      limit: 8,
      dry: false,
      billingEnabled: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.failed).toEqual([{ id: "bad", error: "art host refused" }]);
    expect(result.processed.map((p) => p.id)).toEqual(["good"]);
    expect(result.remaining).toBe(0);
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
  it("counts published null-stamp cards", async () => {
    const stub = chainClient(() => ({ count: 7 }));
    expect(await countMarkedRenders(stub.client as never)).toBe(7);
    const calls = stub.forTable("cards")[0].calls;
    expect(called(calls, "is", "layout_version")).toBe(true);
    expect(called(calls, "in", "visibility")).toBe(true);
  });
});

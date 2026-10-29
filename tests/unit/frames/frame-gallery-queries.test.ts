import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /frames' example reads (lib/frames/frame-gallery-queries.ts, TODO NV8):
// staff cards stay out, as migration 0091 keeps them out of the gallery's
// trending and newest rows — each picked card's owner is asked once through
// owner_is_admin(); an admin's card is never an example, later reads leave
// the admin's cards out, a frame with only staff examples shows its empty
// master, and a failed check keeps the card out (fail closed).
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAKER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders";

type Row = Record<string, unknown>;
type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const s = vi.hoisted(() => ({
  /** The public cards, in the read's order (most liked first). */
  pool: [] as Row[],
  admins: new Set<string>(),
  rpcFails: false,
  calls: [] as Call[],
  ownerChecks: [] as string[],
}));

/** A PostgREST chain over `s.pool` that applies the filters the read uses. */
function chain(table: string) {
  const call: Call = { table, ops: [] };
  s.calls.push(call);
  const c: Record<string, unknown> = {};
  for (const op of ["select", "eq", "not", "in", "order", "limit"]) {
    c[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return c;
    };
  }
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let data: Row[] = [];
    if (table === "frame_reviews") {
      data = ["m15", "m15borderless"].map((template) => ({ template, color_key: "u", verified_layout_version: 1 }));
    } else if (table === "profiles") {
      const ids = call.ops.find(([op]) => op === "in")![2] as string[];
      data = ids.map((id) => ({ id, username: id === ADMIN ? "staff" : "maker" }));
    } else {
      const templates = call.ops.find(([op, column]) => op === "in" && column === "frame_style->>template")![2] as string[];
      const notOwners = call.ops.find(([op, column]) => op === "not" && column === "owner_id");
      const excluded = notOwners ? String(notOwners[3]).replace(/[()]/g, "").split(",") : [];
      const limit = call.ops.find(([op]) => op === "limit")![1] as number;
      data = s.pool
        .filter((row) => templates.includes((row.frame_style as { template: string }).template))
        .filter((row) => !excluded.includes(row.owner_id as string))
        .slice(0, limit);
    }
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };
  return c;
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: chain,
    rpc: async (fn: string, args: { p_owner_id: string }) => {
      if (fn !== "owner_is_admin") throw new Error(`unexpected rpc ${fn}`);
      s.ownerChecks.push(args.p_owner_id);
      if (s.rpcFails) return { data: null, error: { message: "boom" } };
      return { data: s.admins.has(args.p_owner_id), error: null };
    },
  }),
}));

import { EXAMPLE_PAGE, getFrameGallery } from "@/lib/frames/frame-gallery-queries";

let n = 0;
const card = (owner: string, template: string): Row => {
  n += 1;
  const id = `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
  return {
    id,
    slug: `card-${n}`,
    title: `Card ${n}`,
    owner_id: owner,
    visibility: "public",
    card_type: "creature",
    rarity: "rare",
    color_identity: ["blue"],
    frame_style: { template },
    rendered_image_url: `${HOST}/${owner}/${id}.png?v=1`,
    rendered_thumb_url: `${HOST}/${owner}/${id}.thumb.webp?v=1`,
    rendered_back_thumb_url: null,
  };
};
const cardReads = () => s.calls.filter((call) => call.table === "cards");

beforeEach(() => {
  s.pool = [];
  s.admins = new Set([ADMIN]);
  s.rpcFails = false;
  s.calls = [];
  s.ownerChecks = [];
});

describe("the examples leave staff cards out (migration 0091's owner_is_admin)", () => {
  it("passes over an admin's card for a community one, and a frame with only staff cards has no example", async () => {
    const staffBorderless = [card(ADMIN, "m15borderless"), card(ADMIN, "m15borderless")];
    const staffM15 = card(ADMIN, "m15");
    const makers = card(MAKER, "m15");
    // The staff cards are the most liked: they come first.
    s.pool = [...staffBorderless, staffM15, makers];

    const { examples } = await getFrameGallery();
    expect(examples.m15?.id).toBe(makers.id);
    expect(examples.m15?.ownerUsername).toBe("maker");
    // Only staff cards on the borderless frame: its tile shows the empty master.
    expect(examples.m15borderless).toBeUndefined();
    // Each owner asked once.
    expect([...s.ownerChecks].sort()).toEqual([ADMIN, MAKER].sort());
  });

  it("a full page of staff cards: the next read leaves the admin out and finds the community card", async () => {
    s.pool = [...Array.from({ length: EXAMPLE_PAGE }, () => card(ADMIN, "m15")), card(MAKER, "m15")];
    const makers = s.pool[EXAMPLE_PAGE];

    const { examples } = await getFrameGallery();
    expect(examples.m15?.id).toBe(makers.id);
    const reads = cardReads();
    expect(reads.length).toBe(2);
    expect(reads[0].ops.some(([op, column]) => op === "not" && column === "owner_id")).toBe(false);
    expect(reads[1].ops).toContainEqual(["not", "owner_id", "in", `(${ADMIN})`]);
  });

  it("fails closed: an owner whose check failed is no example", async () => {
    s.rpcFails = true;
    s.pool = [card(MAKER, "m15")];
    const { examples } = await getFrameGallery();
    expect(examples).toEqual({});
  });

  it("a community card is an example as before", async () => {
    s.admins = new Set();
    const makers = card(MAKER, "m15borderless");
    s.pool = [makers];
    const { examples } = await getFrameGallery();
    expect(examples.m15borderless?.id).toBe(makers.id);
    expect(examples.m15borderless?.path).toBe(`/card/maker/${makers.slug}`);
  });
});

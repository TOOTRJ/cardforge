import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/admin/unlisted-cards.ts — a user's UNLISTED cards for an admin (the
// profile page's debugging section, owner 2026-11-11). An unlisted card is
// on no list anywhere else, so the gate is the reader's own: for anyone who
// is not an admin it answers null and asks the database nothing.
// ---------------------------------------------------------------------------

type Step = [string, ...unknown[]];

const db = vi.hoisted(() => ({
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often the reader asked who the viewer is. */
  gate: 0,
  /** Every query built: the table, then each call made on it. */
  queries: [] as Array<{ table: string; steps: Step[] }>,
  answer: { data: [] as unknown[] | null, count: 0 as number | null, error: null as null | { message: string } },
}));

function fakeAdmin() {
  return {
    from(table: string) {
      const query = { table, steps: [] as Step[] };
      db.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, ...args]);
          return builder;
        };
      }
      builder.range = async (...args: unknown[]) => {
        query.steps.push(["range", ...args]);
        return db.answer;
      };
      return builder;
    },
  };
}

vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    return db.admin ? fakeAdmin() : null;
  },
}));

import {
  ADMIN_UNLISTED_PAGE_SIZE,
  ADMIN_UNLISTED_PARAM,
  listUnlistedCardsForAdmin,
  parseUnlistedPage,
} from "@/lib/admin/unlisted-cards";

const OWNER = "0b1e2f3a-aaaa-4bbb-8ccc-0123456789ab";

/** A stored card row, as the table hands it back. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  owner_id: OWNER,
  slug: "night-ferry",
  title: "Night Ferry",
  visibility: "unlisted",
  rarity: "rare",
  card_type: "creature",
  color_identity: ["blue", "nonsense"],
  face_content: null,
  watermark: null,
  frame_style: { template: "m15" },
  updated_at: "2026-11-10T03:00:00+00:00",
  ...over,
});

beforeEach(() => {
  db.admin = true;
  db.gate = 0;
  db.queries = [];
  db.answer = { data: [], count: 0, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listUnlistedCardsForAdmin — the gate", () => {
  it("answers null for a viewer who is not an admin, and asks the database nothing", async () => {
    db.admin = false;
    db.answer = { data: [row()], count: 1, error: null };
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toBeNull();
    expect(db.gate).toBe(1);
    expect(db.queries).toEqual([]);
  });

  it("asks who the viewer is on EVERY call — never once and remembered", async () => {
    await listUnlistedCardsForAdmin(OWNER, 1);
    db.admin = false;
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toBeNull();
    expect(db.gate).toBe(2);
    expect(db.queries).toHaveLength(1);
  });

  it("is a server-only module that reaches the service client through requireAdminClient alone", () => {
    const source = readFileSync("lib/admin/unlisted-cards.ts", "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).toContain('import { requireAdminClient } from "@/lib/admin/users-queries";');
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain("@/lib/supabase/admin");
  });
});

describe("listUnlistedCardsForAdmin — the read", () => {
  it("reads THIS owner's UNLISTED cards, most recently edited first, one page with its exact count", async () => {
    db.answer = { data: [row(), row({ id: "c2", slug: "lamplighter", title: "Lamplighter" })], count: 31, error: null };
    const result = await listUnlistedCardsForAdmin(OWNER, 1);
    expect(db.queries).toEqual([
      {
        table: "cards",
        steps: [
          ["select", "*", { count: "exact" }],
          ["eq", "owner_id", OWNER],
          ["eq", "visibility", "unlisted"],
          ["order", "updated_at", { ascending: false }],
          ["order", "id", { ascending: true }],
          ["range", 0, ADMIN_UNLISTED_PAGE_SIZE - 1],
        ],
      },
    ]);
    expect(result).toMatchObject({ ok: true, total: 31, page: 1, pageSize: 24 });
    if (!result?.ok) throw new Error("expected a read");
    expect(result.cards.map((card) => card.title)).toEqual(["Night Ferry", "Lamplighter"]);
    // Rows come back narrowed like every other card read (narrowCard).
    expect(result.cards[0].color_identity).toEqual(["blue"]);
    expect(result.cards[0].visibility).toBe("unlisted");
  });

  it("never asks for a private card — the one visibility named is unlisted", async () => {
    await listUnlistedCardsForAdmin(OWNER, 1);
    const visibility = db.queries[0].steps.filter((step) => step[0] === "eq" && step[1] === "visibility");
    expect(visibility).toEqual([["eq", "visibility", "unlisted"]]);
    const source = readFileSync("lib/admin/unlisted-cards.ts", "utf8");
    expect(source.match(/\.eq\("visibility", "[a-z]+"\)/g)).toEqual(['.eq("visibility", "unlisted")']);
    expect(source).not.toMatch(/\.in\("visibility"|\.neq\("visibility"|\.or\(/);
  });

  it("pages by 24: page 3 is rows 48–71", async () => {
    const result = await listUnlistedCardsForAdmin(OWNER, 3);
    expect(db.queries[0].steps.at(-1)).toEqual(["range", 48, 71]);
    expect(result).toMatchObject({ ok: true, page: 3 });
  });

  it("a page that is no page is the first", async () => {
    for (const page of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      db.queries = [];
      const result = await listUnlistedCardsForAdmin(OWNER, page);
      expect(db.queries[0].steps.at(-1), String(page)).toEqual(["range", 0, 23]);
      expect(result).toMatchObject({ ok: true, page: 1 });
    }
  });

  it("a failed read says so — never an empty list, which would read as “none”", async () => {
    db.answer = { data: null, count: null, error: { message: "boom" } };
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith("[admin/unlisted-cards] read failed:", "boom");
  });

  it("no rows is a read of none", async () => {
    db.answer = { data: null, count: null, error: null };
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toEqual({ ok: true, cards: [], total: 0, page: 1, pageSize: 24 });
  });
});

describe("parseUnlistedPage — the section's page in the address", () => {
  it("reads ?unlisted=N", () => {
    expect(ADMIN_UNLISTED_PARAM).toBe("unlisted");
    expect(parseUnlistedPage("2")).toBe(2);
    expect(parseUnlistedPage(["3", "9"])).toBe(3);
    expect(parseUnlistedPage("9999")).toBe(9999);
  });

  it("anything else is the first page", () => {
    for (const raw of [undefined, "", "0", "-1", "abc", "1e3", "2.5", " 2", "02", "10000", []]) {
      expect(parseUnlistedPage(raw as string | string[] | undefined), JSON.stringify(raw)).toBe(1);
    }
  });
});

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/admin/unlisted-cards.ts — a user's UNLISTED cards for an admin (the
// profile page's debugging section, owner 2026-11-11). An unlisted card is
// on no list of the app's anywhere else, so the gate is the reader's own:
// for anyone who is not an admin it answers null and reads no card.
//
// Two gates, in order: the database's `viewer_is_admin()` (one small call,
// asked as the viewer — it is what every signed-in non-admin costs), then
// the app's own `requireAdminClient`. The READ is a signed-out visitor's
// (the cookie-free client), never the service role's: RLS hands an unlisted
// card to anyone and keeps every private one out.
// ---------------------------------------------------------------------------

type Step = [string, ...unknown[]];

type Answer = { data: unknown[] | null; count: number | null; error: null | { message: string; code?: string } };

const db = vi.hoisted(() => ({
  /** What the DATABASE says of the viewer (viewer_is_admin), and how often it was asked. */
  databaseSays: true as boolean | "error" | "throws",
  asked: 0,
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often the reader asked the app's own gate. */
  gate: 0,
  /** Every query the cookie-free client built: the table, then each call made on it. */
  queries: [] as Array<{ table: string; steps: Step[] }>,
  /** How often each client was made. */
  publicClients: 0,
  /** What a page read answers, and what the count-only read answers. */
  answer: { data: [], count: 0, error: null } as Answer,
  countAnswer: { data: null, count: 0, error: null } as Answer,
}));

/** The cookie-free client: a chain that answers when awaited. */
function fakePublic() {
  return {
    from(table: string) {
      const query = { table, steps: [] as Step[] };
      db.queries.push(query);
      const isCountOnly = () => query.steps.some((step) => step[0] === "select" && (step[2] as { head?: boolean } | undefined)?.head === true);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "range"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: Answer) => unknown) => resolve(isCountOnly() ? db.countAnswer : db.answer);
      return builder;
    },
  };
}

// The app's gate hands back the service client — which the reader must
// never read with: this one has no `from` at all.
vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    return db.admin ? { serviceRole: true } : null;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (db.databaseSays === "throws") throw new Error("no session store");
    return {
      rpc: async (name: string) => {
        db.asked += 1;
        if (name !== "viewer_is_admin") throw new Error(`unexpected rpc ${name}`);
        return db.databaseSays === "error" ? { data: null, error: { message: "boom" } } : { data: db.databaseSays, error: null };
      },
    };
  },
}));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    db.publicClients += 1;
    return fakePublic();
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
  db.databaseSays = true;
  db.asked = 0;
  db.admin = true;
  db.gate = 0;
  db.queries = [];
  db.publicClients = 0;
  db.answer = { data: [], count: 0, error: null };
  db.countAnswer = { data: null, count: 0, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listUnlistedCardsForAdmin — the gate", () => {
  it("a viewer the DATABASE says is no admin gets null for ONE small call — no app gate, no card read", async () => {
    for (const answer of [false, "error", "throws"] as const) {
      db.databaseSays = answer;
      db.answer = { data: [row()], count: 1, error: null };
      expect(await listUnlistedCardsForAdmin(OWNER, 1), String(answer)).toBeNull();
    }
    expect(db.asked).toBe(2); // the third never got a client to ask with
    expect(db.gate).toBe(0);
    expect(db.publicClients).toBe(0);
    expect(db.queries).toEqual([]);
  });

  it("the database's yes is not enough: the app's own gate is asked too, and its no is null with no card read", async () => {
    db.admin = false;
    db.answer = { data: [row()], count: 1, error: null };
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toBeNull();
    expect(db.asked).toBe(1);
    expect(db.gate).toBe(1);
    expect(db.queries).toEqual([]);
  });

  it("asks who the viewer is on EVERY call — never once and remembered", async () => {
    await listUnlistedCardsForAdmin(OWNER, 1);
    db.databaseSays = false;
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toBeNull();
    expect(db.asked).toBe(2);
    expect(db.queries).toHaveLength(1);
  });

  it("is a server-only module that never reads a card with the service role", () => {
    const source = readFileSync("lib/admin/unlisted-cards.ts", "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).toContain('import { requireAdminClient } from "@/lib/admin/users-queries";');
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain("@/lib/supabase/admin");
    // The gate's client is asked for and dropped; the read is the cookie-free client's.
    expect(source).toContain("if (!(await requireAdminClient())) return null;");
    expect(source).toContain("const reader = createPublicClient();");
    expect(source.match(/\.from\("cards"\)/g)).toHaveLength(2);
    expect(source).not.toMatch(/admin\s*\.from\(/);
  });
});

describe("listUnlistedCardsForAdmin — the read", () => {
  it("reads as a signed-out visitor would — RLS, not this module's filter, is what keeps a private card out", async () => {
    await listUnlistedCardsForAdmin(OWNER, 1);
    expect(db.publicClients).toBe(1);
    expect(db.queries).toHaveLength(1);
  });

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
    expect([...new Set(source.match(/\.eq\("visibility", "[a-z]+"\)/g))]).toEqual(['.eq("visibility", "unlisted")']);
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

  // PostgREST refuses a range that starts past the last row (HTTP 416) —
  // it does not answer an empty page. A creator published ten cards while an
  // admin sat on page 2: that is "past the end", and it said "couldn't load".
  it("a page past the last card is an empty page with the real total — never a failure", async () => {
    db.answer = { data: null, count: null, error: { message: "An offset of 48 was requested, but there are only 31 rows.", code: "PGRST103" } };
    db.countAnswer = { data: null, count: 31, error: null };
    expect(await listUnlistedCardsForAdmin(OWNER, 3)).toEqual({ ok: true, cards: [], total: 31, page: 3, pageSize: 24 });
    // The count alone, for the same owner and the same visibility.
    expect(db.queries[1]).toEqual({
      table: "cards",
      steps: [
        ["select", "id", { count: "exact", head: true }],
        ["eq", "owner_id", OWNER],
        ["eq", "visibility", "unlisted"],
      ],
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("…with none at all it is an empty page of zero; and if the count fails too, that is a failure", async () => {
    db.answer = { data: null, count: null, error: { message: "range", code: "PGRST103" } };
    expect(await listUnlistedCardsForAdmin(OWNER, 2)).toEqual({ ok: true, cards: [], total: 0, page: 2, pageSize: 24 });
    db.countAnswer = { data: null, count: null, error: { message: "down" } };
    expect(await listUnlistedCardsForAdmin(OWNER, 2)).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith("[admin/unlisted-cards] count read failed:", "down");
  });

  it("that code on the FIRST page is a failure like any other (nothing is past the start)", async () => {
    db.answer = { data: null, count: null, error: { message: "range", code: "PGRST103" } };
    expect(await listUnlistedCardsForAdmin(OWNER, 1)).toEqual({ ok: false });
    expect(db.queries).toHaveLength(1);
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

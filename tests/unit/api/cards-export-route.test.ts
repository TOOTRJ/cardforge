import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// POST /api/cards/export — the manifest of "Print / download selected"
// (TODO 6.15): the deck export's entitlement (signed in, Pro), the cards in
// the order asked, copies budgeted, unreadable ids skipped.
// ---------------------------------------------------------------------------

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tierOk: true,
  rows: [] as Array<Record<string, unknown>>,
  askedIds: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
  createClient: async () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => {
          state.askedIds = ids;
          return { data: state.rows.filter((r) => ids.includes(r.id as string)), error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/billing/entitlements", () => {
  class UpgradeRequiredError extends Error {}
  return {
    UpgradeRequiredError,
    requireTier: async () => {
      if (!state.tierOk) throw new UpgradeRequiredError("UPGRADE_REQUIRED");
      return {};
    },
  };
});

import { POST } from "@/app/api/cards/export/route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/cards/export", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  slug: `card-${n}`,
  title: `Card ${n}`,
  visibility: "public",
  owner_id: OTHER,
  ...extra,
});

beforeEach(() => {
  state.user = { id: ME };
  state.tierOk = true;
  state.rows = [row(1), row(2, { visibility: "private", owner_id: ME }), row(3, { visibility: "private" }), row(4, { visibility: "unlisted" })];
  state.askedIds = [];
});

describe("POST /api/cards/export", () => {
  it("401 signed out", async () => {
    state.user = null;
    expect((await post({ cards: [{ id: id(1), copies: 1 }] })).status).toBe(401);
  });

  it("403 UPGRADE_REQUIRED below Pro — the deck export's gate", async () => {
    state.tierOk = false;
    const res = await post({ cards: [{ id: id(1), copies: 1 }] });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "UPGRADE_REQUIRED" });
  });

  it("400 on a bad body", async () => {
    expect((await post({ cards: [{ id: "x", copies: 1 }] })).status).toBe(400);
    expect((await post({ cards: [] })).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });

  it("lists the printable cards in the order asked; another user's private card and a missing id are skipped", async () => {
    const res = await post({
      cards: [
        { id: id(4), copies: 2 },
        { id: id(3), copies: 1 },
        { id: id(1), copies: 3 },
        { id: id(9), copies: 1 },
        { id: id(2), copies: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      cards: [
        { id: id(4), slug: "card-4", title: "Card 4", copies: 2 },
        { id: id(1), slug: "card-1", title: "Card 1", copies: 3 },
        // Your own private card prints.
        { id: id(2), slug: "card-2", title: "Card 2", copies: 1 },
      ],
      skipped: [id(3), id(9)],
      totalCopies: 6,
    });
  });

  it("budgets the copies to 150 physical cards before reading", async () => {
    state.rows = [row(1), row(2)];
    const res = await post({
      cards: [
        { id: id(1), copies: 99 },
        { id: id(2), copies: 99 },
      ],
    });
    const body = await res.json();
    expect(body.cards.map((c: { copies: number }) => c.copies)).toEqual([99, 51]);
    expect(body.totalCopies).toBe(150);
    expect(state.askedIds).toEqual([id(1), id(2)]);
  });

  it("404 when nothing can be printed", async () => {
    const res = await post({ cards: [{ id: id(3), copies: 1 }] });
    expect(res.status).toBe(404);
  });
});

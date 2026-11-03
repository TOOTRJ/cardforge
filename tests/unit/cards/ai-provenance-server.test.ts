import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The server's half of AI provenance (TODO CP1, lib/cards/ai-provenance-server.ts):
// a claim is kept only where a receipt of the same owner holds the same text;
// a remix inherits only its parent's unchanged AI parts; the writer adds
// known parts through the service role's RPC.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  configured: true,
  receipts: [] as { owner_id: string; values: unknown; created_at: string }[],
  inserted: [] as Record<string, unknown>[],
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  filters: [] as [string, string, unknown][],
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.configured,
  createAdminClient: () => ({
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      let since = "";
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          eqs[column] = value;
          s.filters.push([table, column, value]);
          return chain;
        },
        gte: (_column: string, value: string) => {
          since = value;
          return chain;
        },
        order: () => chain,
        limit: async () => ({
          data: s.receipts.filter((r) => r.owner_id === eqs.owner_id && r.created_at >= since).map((r) => ({ values: r.values })),
          error: null,
        }),
        insert: async (row: Record<string, unknown>) => {
          s.inserted.push({ table, ...row });
          return { error: null };
        },
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpc.push({ name, args });
      return { data: null, error: null };
    },
  }),
}));

import {
  addCardAiFields,
  generatedCardParts,
  inheritedAiParts,
  recordAiReceipt,
  verifiedAiClaims,
} from "@/lib/cards/ai-provenance-server";

const now = () => new Date().toISOString();

beforeEach(() => {
  s.configured = true;
  s.receipts = [];
  s.inserted = [];
  s.rpc = [];
  s.filters = [];
});

describe("verifiedAiClaims", () => {
  const saved = { title: "Urza’s Spark", rules_text: "Haste", flavor_text: "Mine.", power: "2", toughness: "1" };

  it("keeps a claim whose receipt holds the same text (typography folded as print sets it)", async () => {
    s.receipts = [{ owner_id: OWNER, created_at: now(), values: [{ title: "Urza's Spark", rules_text: "Haste", power: "2", toughness: "1" }] }];
    expect(await verifiedAiClaims(OWNER, ["title", "rules_text", "stats"], saved)).toEqual(["title", "rules_text", "stats"]);
  });

  it("drops a claim no receipt backs — a hand-written field claimed as AI", async () => {
    s.receipts = [{ owner_id: OWNER, created_at: now(), values: [{ title: "Urza's Spark" }] }];
    expect(await verifiedAiClaims(OWNER, ["title", "flavor_text"], saved)).toEqual(["title"]);
  });

  it("drops a claim whose text the maker changed after the AI wrote it", async () => {
    s.receipts = [{ owner_id: OWNER, created_at: now(), values: [{ rules_text: "Haste, trample" }] }];
    expect(await verifiedAiClaims(OWNER, ["rules_text"], saved)).toEqual([]);
  });

  it("reads only the claimer's own receipts, from the last 30 days", async () => {
    s.receipts = [
      { owner_id: "22222222-2222-4222-8222-222222222222", created_at: now(), values: [{ title: "Urza's Spark" }] },
      { owner_id: OWNER, created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), values: [{ title: "Urza's Spark" }] },
    ];
    expect(await verifiedAiClaims(OWNER, ["title"], saved)).toEqual([]);
    expect(s.filters).toContainEqual(["card_ai_receipts", "owner_id", OWNER]);
  });

  it("any idea of a batch backs its own fields (an idea mixes groups)", async () => {
    s.receipts = [{ owner_id: OWNER, created_at: now(), values: [{ title: "Other" }, { title: "Urza's Spark" }] }];
    expect(await verifiedAiClaims(OWNER, ["title"], saved)).toEqual(["title"]);
  });

  it("ignores unknown or empty parts and reads nothing for no claim", async () => {
    expect(await verifiedAiClaims(OWNER, ["art", "bogus", "cost"], saved)).toEqual([]);
    expect(await verifiedAiClaims(OWNER, undefined, saved)).toEqual([]);
    expect(s.filters).toEqual([]);
  });
});

describe("inheritedAiParts", () => {
  const parent = { title: "Glimmer", rules_text: "Draw two cards.", flavor_text: "Hm.", ai_fields: ["title", "rules_text", "flavor_text", "art"] };

  it("a remix keeps the parent's AI parts it still holds as they were", () => {
    expect(inheritedAiParts(parent, { title: "Glimmer (remix)", rules_text: "Draw two cards.", flavor_text: "Hm." })).toEqual([
      "rules_text",
      "flavor_text",
    ]);
  });

  it("nothing from a hand-made parent, or none at all", () => {
    expect(inheritedAiParts({ ...parent, ai_fields: [] }, parent)).toEqual([]);
    expect(inheritedAiParts(null, parent)).toEqual([]);
  });
});

describe("the writers", () => {
  it("addCardAiFields sends the known text parts, once each, sorted", async () => {
    await addCardAiFields("card-1", OWNER, ["title", "rules_text", "title", "art" as never]);
    expect(s.rpc).toEqual([{ name: "add_card_ai_fields", args: { p_card_id: "card-1", p_owner_id: OWNER, p_fields: ["rules_text", "title"] } }]);
  });

  it("writes nothing for no part, or without the service role", async () => {
    await addCardAiFields("card-1", OWNER, []);
    s.configured = false;
    await addCardAiFields("card-1", OWNER, ["title"]);
    await recordAiReceipt(OWNER, "fill", [{ title: "X" }]);
    expect(s.rpc).toEqual([]);
    expect(s.inserted).toEqual([]);
  });

  it("recordAiReceipt keeps only the text columns, the second face's too", async () => {
    await recordAiReceipt(OWNER, "fill", [
      { title: "X", rules_text: "Y", art_url: "https://x/ai-1.png", back_face: { title: "B", art_url: "https://x/ai-2.png" } } as never,
    ]);
    expect(s.inserted).toEqual([
      { table: "card_ai_receipts", owner_id: OWNER, source: "fill", values: [{ title: "X", rules_text: "Y", back_face: { title: "B" } }] },
    ]);
  });

  it("generatedCardParts = every text part the card has", () => {
    expect(generatedCardParts({ title: "T", card_type: "instant", rules_text: "R", flavor_text: null, power: null })).toEqual([
      "title",
      "type_line",
      "rules_text",
    ]);
  });
});

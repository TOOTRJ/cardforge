import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// lib/pips/remove-pip.ts — the steps of the owner's pip "Remove"
// (deleteCustomPipAction), shared with the flagged-file rescan (a pip whose
// picture was flagged is removed the same way): the row — with a
// compare-and-set on the picture when the caller decided from an earlier
// read — then the object, then the caches and, after the response, the
// re-bake of the owner's cards that draw the symbol (read with the caller's
// client: the owner's session, or the service role for the rescan).
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  after: [] as Array<() => unknown>,
  removed: [] as string[][],
  baked: [] as string[],
  sessionReads: 0,
}));
vi.mock("next/server", () => ({ after: (task: () => unknown) => void s.after.push(task) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    s.sessionReads += 1;
    return chainClient(() => ({ data: [] })).client;
  },
}));
vi.mock("@/lib/media/user-storage", () => ({
  isUserStorageConfigured: () => true,
  userFolder: (bucket: string, owner: string) => ({
    remove: async (names: string[]) => {
      s.removed.push([bucket, owner, ...names]);
      return { error: null };
    },
  }),
}));
vi.mock("@/lib/cards/bake-render", () => ({
  bakeAndPersistCardRender: async (id: string) => void s.baked.push(id),
}));

import { deleteCustomPipRow, finishPipChange, removeCustomPipObject } from "@/lib/pips/remove-pip";

beforeEach(() => {
  s.after = [];
  s.removed = [];
  s.baked = [];
  s.sessionReads = 0;
});

describe("removing a custom pip", () => {
  it("deletes the owner's row for the symbol — only while it names the picture, when asked — and says how many went", async () => {
    const stub = chainClient((_t: string, calls: ChainCall[]): ChainAnswer => ({ data: called(calls, "eq", "image_url") ? [] : [{ id: "p" }] }));
    expect(await deleteCustomPipRow(stub.client as never, OWNER, "R")).toEqual({ error: null, deleted: 1 });
    expect(await deleteCustomPipRow(stub.client as never, OWNER, "R", { onlyIfImageUrl: "https://x/p.png?v=1" })).toEqual({ error: null, deleted: 0 });
    const [plain, cas] = stub.forTable("custom_pips");
    expect(plain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["owner_id", OWNER],
      ["symbol", "R"],
    ]);
    expect(called(plain.calls, "delete")).toBe(true);
    expect(cas.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual(["image_url", "https://x/p.png?v=1"]);

    const failing = chainClient(() => ({ error: { message: "locked" } }));
    expect(await deleteCustomPipRow(failing.client as never, OWNER, "R")).toEqual({ error: "locked", deleted: null });
  });

  it("removes {owner}/{SYMBOL}.png from the owner's custom-pips folder", async () => {
    await removeCustomPipObject(OWNER, "G");
    expect(s.removed).toEqual([["custom-pips", OWNER, "G.png"]]);
  });

  it("re-bakes the owner's cards that draw the symbol after the response — listed with the client it is given", async () => {
    const cards = chainClient(() => ({
      data: [
        { id: "cost", cost: "{2}{R}", rules_text: null, back_face: null },
        { id: "rules", cost: "{1}", rules_text: "{T}: Add {R}.", back_face: null },
        { id: "back", cost: null, rules_text: null, back_face: { cost: "{R}{R}" } },
        { id: "other", cost: "{G}", rules_text: "Trample", back_face: null },
      ],
    }));
    finishPipChange(OWNER, "R", { cardsClient: cards.client as never });
    expect(s.baked).toEqual([]);
    for (const task of s.after) await task();
    expect(s.baked).toEqual(["cost", "rules", "back"]);
    expect(s.sessionReads).toBe(0);
    const [read] = cards.forTable("cards");
    expect(read.calls.find((c) => c.method === "eq")?.args).toEqual(["owner_id", OWNER]);

    // Without one: the request's own client (the owner's session in the pip actions).
    s.after = [];
    finishPipChange(OWNER, "R");
    for (const task of s.after) await task();
    expect(s.sessionReads).toBe(1);
  });
});

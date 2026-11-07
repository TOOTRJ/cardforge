import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import { isExactCopyOfImport } from "@/lib/cards/exact-copy";
import { allHeldBackMessage, exactCopySkippedLine } from "@/lib/cards/bulk-visibility-copy";
import { describeNotification } from "@/lib/notifications/describe";

// ---------------------------------------------------------------------------
// Exact copies of real cards (owner 2026-11-06, lib/cards/exact-copy.ts): the
// one rule, the bulk bar's words, the owner's notice, migration 0183 and the
// hourly sweep that moves a public one to unlisted. The create refusal and
// the edit's cap: tests/unit/cards/import-provenance-save.test.ts.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
const revalidate = vi.hoisted(() => ({
  lists: vi.fn(),
  pages: vi.fn(),
  path: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate.path }));
vi.mock("@/lib/cards/revalidate", () => ({
  revalidateCardListSurfaces: revalidate.lists,
  revalidateCardPages: revalidate.pages,
}));

import { unlistPublicExactCopies } from "@/lib/cards/exact-copy-sweep";

const SOURCE = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

function imported(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    title: "Llanowar Elves",
    cost: "{G}",
    color_identity: ["green"],
    card_type: "creature",
    subtypes: ["Elf", "Druid"],
    rules_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/a.png",
    frame_style: { template: "m15", finish: "regular" },
    lang: "en",
    import_scryfall_id: SOURCE,
  };
  // Not a fingerprinted column: the sweep holds its UPDATE to it.
  const stamp = { updated_at: "2026-11-01T00:00:00+00:00" };
  row.import_fingerprint = importFingerprintOf(row);
  return { ...row, ...stamp, ...overrides };
}

describe("isExactCopyOfImport — the deck pages' \"Imported\", one answer", () => {
  it("a stored fingerprint its columns still hash to: the real card", () => {
    expect(isExactCopyOfImport(imported())).toBe(true);
  });

  it("what isn't the card (visibility, tags, slug) never makes it the maker's own", () => {
    expect(isExactCopyOfImport({ ...imported(), visibility: "public", tags: ["elves"], slug: "x" } as never)).toBe(true);
  });

  it("any change to the card itself does", () => {
    expect(isExactCopyOfImport(imported({ title: "Llanowar Elder" }))).toBe(false);
    expect(isExactCopyOfImport(imported({ frame_style: { template: "m15", finish: "foil" } }))).toBe(false);
  });

  it("no fingerprint — from scratch, a remix, an import changed before its first save, a card before 0144 — is never one", () => {
    expect(isExactCopyOfImport(imported({ import_fingerprint: null }))).toBe(false);
    expect(isExactCopyOfImport(imported({ import_scryfall_id: null }))).toBe(false);
    expect(isExactCopyOfImport({ title: "Mine" })).toBe(false);
  });
});

describe("the bulk bar's words", () => {
  it("names the cards a publish left as they were, and nothing when there were none", () => {
    expect(exactCopySkippedLine(0)).toBe("");
    expect(exactCopySkippedLine(undefined)).toBe("");
    expect(exactCopySkippedLine(1)).toContain("1 card stayed as it was: it's still exactly the real card");
    expect(exactCopySkippedLine(3)).toContain("3 cards stayed as they were");
  });

  it("says why nothing was published, beside the other reasons", () => {
    expect(allHeldBackMessage("public", { strongLanguage: 0, previews: 0, exactCopy: 1 })).toBe(
      "Nothing was published: the selected card is still exactly the real card. Change something on a copy to publish it.",
    );
    expect(allHeldBackMessage("public", { strongLanguage: 0, previews: 0, artless: 1, exactCopy: 2 })).toBe(
      "Nothing was published: 1 card has no artwork yet and 2 cards are still exactly the real card. Add artwork before publishing. Change something on a copy to publish it.",
    );
  });
});

describe("the owner's notice (exact_copy_unlisted)", () => {
  const describeIt = (payload: Record<string, unknown>) =>
    describeNotification({ type: "exact_copy_unlisted", payload, actor: null } as never, { isAdmin: false });

  it("one card, by name, with where to find it", () => {
    const d = describeIt({ count: 1, titles: ["Llanowar Elves"] });
    expect(d.body).toContain("moved “Llanowar Elves” to unlisted: it's still exactly the real card");
    expect(d.body).toContain("Its link keeps working");
    expect(d.href).toBe("/dashboard/cards?show=unlisted");
  });

  it("several, counted, a few named", () => {
    const d = describeIt({ count: 5, titles: ["A", "B", "C"] });
    expect(d.body).toContain("moved 5 of your cards (A, B, C…) to unlisted: they're still exactly the real card");
    expect(d.body).toContain("Their links keep working");
  });
});

describe("migration 0183", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const kinds = (text: string) => {
    const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
    return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  const file = readdirSync(dir).find((f) => f.startsWith("0183_"))!;
  const sql = readFileSync(join(dir, file), "utf8");

  it("keeps every kind the CHECK before it allowed and adds exact_copy_unlisted", () => {
    const before = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < file)
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((text) => text.includes("notifications_type_check"))
      .at(-1)!;
    expect(kinds(sql)).toEqual([...kinds(before).filter((k) => k !== "tool_access"), "tool_access", "exact_copy_unlisted"]);
    expect(kinds(sql)).toEqual(expect.arrayContaining(["banked_days", "referral_reward", "tool_access"]));
  });

  it("no later migration redefines the CHECK without it", () => {
    for (const f of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name > file)) {
      const text = readFileSync(join(dir, f), "utf8");
      if (text.includes("notifications_type_check")) expect(kinds(text), f).toContain("exact_copy_unlisted");
    }
  });

  it("the new kind has words of its own, not the generic fallback's", () => {
    const own = describeNotification({ type: "exact_copy_unlisted", payload: { count: 1, titles: ["X"] }, actor: null } as never, { isAdmin: false });
    const fallback = describeNotification({ type: "no_such_kind", payload: {}, actor: null } as never, { isAdmin: false });
    expect(own.body).not.toBe(fallback.body);
    expect(own.subject).toBe("PipGlyph team");
  });
});

describe("unlistPublicExactCopies — the hourly sweep", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    revalidate.lists.mockReset();
    revalidate.pages.mockReset();
    revalidate.path.mockReset();
  });

  function harness(
    rows: Array<Record<string, unknown>>,
    options: { stillPublic?: (id: string) => boolean } = {},
  ) {
    return chainClient((table, calls): ChainAnswer => {
      if (table === "cards" && called(calls, "select") && !called(calls, "update")) {
        // Keyset paging as PostgREST would answer it: ids after `gt`, `limit` of them.
        const after = calls.find((c) => c.method === "gt")?.args[1] as string | undefined;
        const limit = calls.find((c) => c.method === "limit")?.args[0] as number;
        const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return { data: sorted.filter((r) => after === undefined || String(r.id) > after).slice(0, limit) };
      }
      if (table === "cards" && called(calls, "update")) {
        const id = calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
        return { data: (options.stillPublic?.(id) ?? true) ? [{ id }] : [] };
      }
      if (table === "profiles") return { data: [{ id: OWNER, username: "tester" }, { id: OTHER, username: "other" }] };
      return { data: null };
    });
  }

  it("moves the public exact copies to unlisted, tells each owner once, refreshes what listed them", async () => {
    const rows = [
      { ...imported(), id: "a", owner_id: OWNER, slug: "llanowar-elves" },
      { ...imported(), id: "b", owner_id: OWNER, slug: "llanowar-elves-2" },
      { ...imported({ title: "Mine now" }), id: "c", owner_id: OWNER, slug: "mine-now" },
      { ...imported(), id: "d", owner_id: OTHER, slug: "elves" },
    ];
    const stub = harness(rows);
    const result = await unlistPublicExactCopies(stub.client as never);
    expect(result).toMatchObject({ scanned: 4, exactCopies: 3, unlisted: 3, notified: 2, errors: 0, more: false });

    const [scan] = stub.forTable("cards");
    expect(called(scan!.calls, "eq", "visibility")).toBe(true);
    expect(scan!.calls).toContainEqual({ method: "not", args: ["import_fingerprint", "is", null] });

    const updates = stub.forTable("cards").filter((e) => called(e.calls, "update"));
    expect(updates.map((u) => u.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1])).toEqual(["a", "b", "d"]);
    for (const update of updates) {
      expect(payloadOf(update.calls, "update")).toEqual({ visibility: "unlisted" });
      // Only while still public AND unedited since the scan: an owner's own
      // change meanwhile wins.
      expect(update.calls).toContainEqual({ method: "eq", args: ["visibility", "public"] });
      expect(update.calls).toContainEqual({ method: "eq", args: ["updated_at", "2026-11-01T00:00:00+00:00"] });
    }

    const notes = stub.forTable("notifications").map((e) => payloadOf(e.calls, "insert") as Record<string, unknown>);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ recipient_id: OWNER, type: "exact_copy_unlisted", payload: { count: 2 } });
    expect(notes[1]).toMatchObject({ recipient_id: OTHER, payload: { count: 1, titles: ["Llanowar Elves"] } });

    expect(revalidate.lists).toHaveBeenCalledTimes(1);
    expect(revalidate.pages).toHaveBeenCalledWith([
      { id: "a", slug: "llanowar-elves", ownerUsername: "tester" },
      { id: "b", slug: "llanowar-elves-2", ownerUsername: "tester" },
      { id: "d", slug: "elves", ownerUsername: "other" },
    ]);
    expect(revalidate.path).toHaveBeenCalledWith("/profile/tester");
  });

  it("a card its owner moved meanwhile is neither counted nor told about", async () => {
    const rows = [{ ...imported(), id: "a", owner_id: OWNER, slug: "s" }];
    const stub = harness(rows, { stillPublic: () => false });
    const result = await unlistPublicExactCopies(stub.client as never);
    expect(result).toMatchObject({ exactCopies: 1, unlisted: 0, notified: 0 });
    expect(stub.forTable("notifications")).toHaveLength(0);
    expect(revalidate.lists).not.toHaveBeenCalled();
  });

  it("pages through every public fingerprinted card by id (500 a page)", async () => {
    const base = imported();
    const id = (i: number) => `id-${String(i).padStart(4, "0")}`;
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ...base, id: id(i), owner_id: OWNER, slug: `s${i}` }));
    const stub = harness(rows);
    const result = await unlistPublicExactCopies(stub.client as never);
    expect(result).toMatchObject({ scanned: 1001, exactCopies: 1001, unlisted: 1001, notified: 1, more: false });
    const scans = stub.forTable("cards").filter((e) => !called(e.calls, "update"));
    expect(scans.map((e) => e.calls.find((c) => c.method === "gt")?.args[1] ?? null)).toEqual([null, id(499), id(999)]);
  });

  it("nothing to move: one read, nothing written", async () => {
    const stub = harness([{ ...imported({ title: "Changed" }), id: "a", owner_id: OWNER, slug: "s" }]);
    const result = await unlistPublicExactCopies(stub.client as never);
    expect(result).toMatchObject({ scanned: 1, exactCopies: 0, unlisted: 0 });
    expect(stub.log).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";
import { isDefaultProfileMedia } from "@/lib/profile/default-media";

// ---------------------------------------------------------------------------
// The rows that use a file the moderation rescan flagged (owner answer
// 2026-09-29), acted on by the APP (lib/moderation/flagged-file.ts, behind
// POST /api/admin/storage-sweep) through its own code paths:
//   * a card → the moderation hide (hideCard);
//   * an avatar / banner → a built-in of that kind (isDefaultProfileMedia);
//   * a deck cover → cleared;
//   * a custom pip → removed like the owner's "Remove".
// Each action re-reads its row and acts only while the row still DRAWS the
// file — our storage host, its bucket, its key — with a compare-and-set
// write; then every URL that named it is purged from Image Optimization.
// ---------------------------------------------------------------------------

const U1 = "11111111-1111-4111-8111-111111111111";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DECK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PIP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST = "https://auth.pipglyph.com/storage/v1/object/public";
const FILE = { bucket: "card-art" as const, path: `${U1}/My-Photo.jpg` };
const URL_OF = (bucket: string, key: string, q = "") => `${HOST}/${bucket}/${key}${q}`;
const FLAGGED_URL = URL_OF("card-art", `${U1}/My-Photo.jpg`, "?v=3");

const s = vi.hoisted(() => ({
  seq: [] as string[],
  rows: {} as Record<string, unknown>,
  writeAnswer: {} as Record<string, ChainAnswer>,
  hide: vi.fn(),
  deleteRow: vi.fn(),
  removeObject: vi.fn(async () => {}),
  finish: vi.fn(),
  revalidateProfile: vi.fn(async () => {}),
  revalidateDeck: vi.fn(),
  purgeSources: vi.fn(async (srcs: readonly string[]) => void srcs),
}));

vi.mock("@/lib/moderation/hide-card", () => ({ hideCard: s.hide }));
vi.mock("@/lib/pips/remove-pip", () => ({
  deleteCustomPipRow: s.deleteRow,
  removeCustomPipObject: s.removeObject,
  finishPipChange: s.finish,
}));
vi.mock("@/lib/profile/username", () => ({
  lookupUsername: async () => "owner-handle",
  revalidateProfileMedia: s.revalidateProfile,
}));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: s.revalidateDeck }));
vi.mock("@/lib/cards/cache-purge", () => ({ purgeImageSources: s.purgeSources }));

import { actOnFlaggedFile, urlsNamingFile, type FlaggedFileAction } from "@/lib/moderation/flagged-file";

function admin() {
  return chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (called(calls, "update")) {
      s.seq.push(`update ${table}`);
      return s.writeAnswer[table] ?? { data: [{ id: "written" }] };
    }
    s.seq.push(`read ${table}`);
    return { data: s.rows[table] ?? null };
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  s.seq = [];
  s.rows = {};
  s.writeAnswer = {};
  s.hide.mockReset().mockResolvedValue({ ok: true, ownerId: U1 });
  s.deleteRow.mockReset().mockResolvedValue({ error: null, deleted: 1 });
  s.removeObject.mockClear();
  s.finish.mockClear();
  s.revalidateProfile.mockClear();
  s.revalidateDeck.mockClear();
  s.purgeSources.mockClear();
});

const act = (stub: ReturnType<typeof admin>, ...actions: FlaggedFileAction[]) => actOnFlaggedFile(stub.client as never, FILE, actions);

describe("urlsNamingFile — does this value DRAW the file?", () => {
  it("a public URL of the file on our storage host (either), in its bucket, any query, any case — at any JSON depth", () => {
    expect(urlsNamingFile(FLAGGED_URL, FILE)).toEqual([FLAGGED_URL]);
    const legacy = `https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-art/${U1}/my-photo.JPG`;
    expect(urlsNamingFile(legacy, FILE)).toEqual([legacy]);
    expect(urlsNamingFile({ art_url: FLAGGED_URL, faces: [{ url: FLAGGED_URL }] }, FILE)).toEqual([FLAGGED_URL, FLAGGED_URL]);
  });

  it("never another bucket, an outside host, a longer name, a bare key or a URL inside text", () => {
    for (const value of [
      URL_OF("profile-media", `${U1}/My-Photo.jpg`),
      `https://evil.example/storage/v1/object/public/card-art/${U1}/My-Photo.jpg`,
      URL_OF("card-art", `${U1}/My-Photo.jpg.bak`),
      URL_OF("card-art", `${U1}/My-Photo.jpgx`),
      `${U1}/My-Photo.jpg`,
      `see ${FLAGGED_URL}`,
      null,
      42,
    ]) {
      expect(urlsNamingFile(value, FILE), String(value)).toEqual([]);
    }
  });
});

describe("a card that draws the file → the moderation hide", () => {
  it("hides it through hideCard (no resolver: not an admin session) — art, second face, watermark, set icon or bake", async () => {
    for (const row of [
      { art_url: FLAGGED_URL },
      { back_face: { title: "Back", art_url: FLAGGED_URL } },
      { watermark: { kind: "custom", url: FLAGGED_URL } },
      { set_icon_url: FLAGGED_URL },
    ]) {
      s.hide.mockClear();
      s.rows.cards = { id: CARD, visibility: "public", ...row };
      const [result] = await act(admin(), { kind: "hide-card", cardId: CARD });
      expect(result).toMatchObject({ status: "done", detail: "hidden (was public)" });
      expect(s.hide).toHaveBeenCalledWith(expect.anything(), CARD, { resolvedBy: null });
    }
  });

  it("a card that only mentions it in text, one that's gone, and a failed hide", async () => {
    s.rows.cards = { id: CARD, visibility: "public", art_url: URL_OF("card-art", `${U1}/other.jpg`), back_face: { rules_text: `see ${FLAGGED_URL}` } };
    expect((await act(admin(), { kind: "hide-card", cardId: CARD }))[0]).toMatchObject({ status: "skipped", detail: "the row no longer draws this file" });
    s.rows.cards = null;
    expect((await act(admin(), { kind: "hide-card", cardId: CARD }))[0]).toMatchObject({ status: "skipped", detail: "no such card" });
    expect(s.hide).not.toHaveBeenCalled();

    s.rows.cards = { id: CARD, visibility: "public", art_url: FLAGGED_URL };
    s.hide.mockResolvedValue({ ok: false, error: "Couldn't hide the card: nope" });
    expect((await act(admin(), { kind: "hide-card", cardId: CARD }))[0]).toMatchObject({ status: "failed", detail: "Couldn't hide the card: nope" });
  });
});

describe("an avatar / banner → a built-in of that kind", () => {
  it("writes a built-in only while the row still holds the flagged URL, then revalidates the profile surfaces", async () => {
    s.rows.profiles = { id: U1, banner_url: FLAGGED_URL };
    const stub = admin();
    const [result] = await act(stub, { kind: "profile-default", userId: U1, column: "banner_url" });
    expect(result.status).toBe("done");
    const write = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    const payload = payloadOf(write.calls, "update") as { banner_url: string };
    expect(Object.keys(payload)).toEqual(["banner_url"]);
    expect(isDefaultProfileMedia(payload.banner_url, "banner")).toBe(true);
    expect(result.detail).toBe(`banner → ${payload.banner_url}`);
    // Compare-and-set on the value it read.
    expect(write.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", U1],
      ["banner_url", FLAGGED_URL],
    ]);
    expect(s.revalidateProfile).toHaveBeenCalledWith(stub.client, U1);
  });

  it("changed since the read, or no longer the flagged file → skipped, nothing revalidated", async () => {
    s.rows.profiles = { id: U1, avatar_url: FLAGGED_URL };
    s.writeAnswer.profiles = { data: [] };
    expect((await act(admin(), { kind: "profile-default", userId: U1, column: "avatar_url" }))[0]).toMatchObject({
      status: "skipped",
      detail: "the row no longer draws this file (changed since it was read)",
    });
    s.rows.profiles = { id: U1, avatar_url: "/defaults/avatars/avatar-03.webp" };
    const stub = admin();
    expect((await act(stub, { kind: "profile-default", userId: U1, column: "avatar_url" }))[0].status).toBe("skipped");
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
    expect(s.revalidateProfile).not.toHaveBeenCalled();
  });
});

describe("a deck cover → cleared", () => {
  it("clears it (compare-and-set) and revalidates the deck's pages", async () => {
    s.rows.decks = { id: DECK, slug: "my-deck", owner_id: U1, cover_url: FLAGGED_URL };
    const stub = admin();
    expect((await act(stub, { kind: "clear-deck-cover", deckId: DECK }))[0]).toMatchObject({ status: "done", detail: "cover cleared" });
    const write = stub.forTable("decks").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(write.calls, "update")).toEqual({ cover_url: null });
    expect(write.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", DECK],
      ["cover_url", FLAGGED_URL],
    ]);
    expect(s.revalidateDeck).toHaveBeenCalledWith("my-deck", "owner-handle");
  });
});

describe("a custom pip → removed like the owner's Remove", () => {
  it("row (only while it names the file), object, caches + re-bake of the owner's cards (read with the service role)", async () => {
    s.rows.custom_pips = { id: PIP, owner_id: U1, symbol: "R", image_url: FLAGGED_URL };
    const stub = admin();
    expect((await act(stub, { kind: "remove-custom-pip", pipId: PIP }))[0]).toMatchObject({ status: "done", detail: "R pip removed" });
    expect(s.deleteRow).toHaveBeenCalledWith(stub.client, U1, "R", { onlyIfImageUrl: FLAGGED_URL });
    expect(s.removeObject).toHaveBeenCalledWith(U1, "R");
    expect(s.finish).toHaveBeenCalledWith(U1, "R", { cardsClient: stub.client });
  });

  it("a pip changed since the read is skipped; an unknown symbol fails; a delete error fails", async () => {
    s.rows.custom_pips = { id: PIP, owner_id: U1, symbol: "R", image_url: FLAGGED_URL };
    s.deleteRow.mockResolvedValueOnce({ error: null, deleted: 0 });
    expect((await act(admin(), { kind: "remove-custom-pip", pipId: PIP }))[0].status).toBe("skipped");
    s.deleteRow.mockResolvedValueOnce({ error: "locked", deleted: null });
    expect((await act(admin(), { kind: "remove-custom-pip", pipId: PIP }))[0]).toMatchObject({ status: "failed", detail: "delete failed: locked" });
    s.rows.custom_pips = { id: PIP, owner_id: U1, symbol: "X", image_url: FLAGGED_URL };
    expect((await act(admin(), { kind: "remove-custom-pip", pipId: PIP }))[0].status).toBe("failed");
    expect(s.removeObject).not.toHaveBeenCalled();
    expect(s.finish).not.toHaveBeenCalled();
  });
});

describe("the run", () => {
  it("acts in order, one failure doesn't stop the rest, then purges every URL that named the file + its bare URL", async () => {
    s.rows.cards = { id: CARD, visibility: "unlisted", art_url: FLAGGED_URL };
    s.rows.decks = { id: DECK, slug: "d", owner_id: U1, cover_url: URL_OF("card-art", `${U1}/my-photo.jpg`) };
    s.hide.mockRejectedValueOnce(new Error("network"));
    const results = await act(admin(), { kind: "hide-card", cardId: CARD }, { kind: "clear-deck-cover", deckId: DECK });
    expect(results.map((r) => [r.action.kind, r.status, r.detail])).toEqual([
      ["hide-card", "failed", "network"],
      ["clear-deck-cover", "done", "cover cleared"],
    ]);
    expect(s.purgeSources).toHaveBeenCalledTimes(1);
    expect(s.purgeSources.mock.calls[0][0]).toEqual([
      FLAGGED_URL,
      URL_OF("card-art", `${U1}/my-photo.jpg`),
      URL_OF("card-art", `${U1}/My-Photo.jpg`),
    ]);
  });
});

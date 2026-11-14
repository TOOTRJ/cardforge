import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// One Re-art step (lib/tools/re-art/step.ts). The plan is the owner's to
// insert, so the step trusts nothing in it: the tool's gate, the deck's
// STORED style (a run priced in another style stops before any charge), the
// entry from the caller's own deck, the card from their own session. A real
// card goes through Bulk Customize's one-card core with the deck's style as
// its prompt; the maker's own card gets its art EDITED (art + fit alone),
// its earlier art kept for "Put the old art back"; another creator's card
// and an emblem are never touched; a card in the style already — still
// SHOWING the picture Re-art painted — is never painted (or charged) twice;
// a card painted in the style that shows other art now, or was given its
// own art back, is left as it is unless the plan names it; the paint's row
// is written BEFORE the card's edit (the art to put back is named there
// before the card stops showing it) and put back if the edit is refused;
// a picture a re-roll replaced is removed only through the guarded discard
// (never while another card of the maker's still shows it:
// re-art-server.test.ts).
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  styleAdmin: vi.fn(),
  paintedAdmin: vi.fn(),
  paintedRows: vi.fn(),
  madeForEntry: vi.fn(),
  link: vi.fn(),
  writePainted: vi.fn(),
  customize: vi.fn(),
  update: vi.fn(),
  credited: vi.fn(),
  image: vi.fn(),
  persist: vi.fn(),
  discard: vi.fn(),
  discardUnused: vi.fn(),
  revert: vi.fn(),
  words: vi.fn(),
  bakedBack: vi.fn(),
  restyle: vi.fn(),
  getCard: vi.fn(),
  scryfallRate: vi.fn(),
  scryfallLog: vi.fn(),
  artCrop: vi.fn(),
  storedArt: vi.fn(),
  rows: { deck_cards: null as unknown, cards: null as unknown },
  /** The API's own refusal of the entry's read, and what the step selected. */
  entry: { error: null as null | { code: string; message: string }, select: "" },
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: "deck_cards" | "cards") => {
      const chain = {
        select: (columns: string) => {
          if (table === "deck_cards") m.entry.select = columns;
          return chain;
        },
        eq: () => chain,
        maybeSingle: async () =>
          table === "deck_cards" && m.entry.error ? { data: null, error: m.entry.error } : { data: m.rows[table], error: null },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/tools/re-art/server", () => ({
  readDeckStyleAdmin: m.styleAdmin,
  readPaintedCardAdmin: m.paintedAdmin,
  readPaintedRowsForCardAdmin: m.paintedRows,
  readMadeForEntryAdmin: m.madeForEntry,
  writePaintedCard: m.writePainted,
  discardReartArtIfUnused: m.discardUnused,
  revertPaintedCard: m.revert,
  readCardWordsAdmin: m.words,
  reartBulkChoices: (style: { preset: string }, visibility: string) => ({ art: "ai", artStyle: style.preset, visibility }),
}));
vi.mock("@/lib/tools/bulk-customize/step", () => ({ customizeSourceStep: m.customize }));
vi.mock("@/lib/cards/actions", () => ({ updateCardAction: m.update }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: m.link }));
vi.mock("@/lib/cards/faces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/faces")>()),
  rowHasBakedBack: m.bakedBack,
}));
vi.mock("@/lib/ai/credited-step", () => ({ withCreditedStep: m.credited }));
vi.mock("@/lib/ai/rate-limit", () => ({ logAiCall: vi.fn() }));
vi.mock("@/lib/ai/image-gen", () => ({ generateImageWithFallbacks: m.image, restyleWithFallbacks: m.restyle }));
vi.mock("@/lib/scryfall/client", () => ({ getCardById: m.getCard }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: m.scryfallLog }));
vi.mock("@/lib/scryfall/art-crop", () => ({ fetchScryfallArtCrop: m.artCrop }));
vi.mock("@/lib/tools/re-art/restyle-source", () => ({ fetchStoredArt: m.storedArt }));
vi.mock("@/lib/ai/random-art", () => ({ persistGeneratedArt: m.persist, discardGeneratedArt: m.discard }));

import { REART_STYLE_CHANGED, runReartStep } from "@/lib/tools/re-art/step";

const DECK = "00000000-0000-4000-8000-0000000000d1";
const ENTRY = "00000000-0000-4000-8000-000000000001";
const DEPS = { gameSystemId: async () => "gs-1", artistCredit: async () => "AI" };
const STEP: JobStep = { key: "reart:0", label: "Archivist", status: "running" };
const STYLE = { preset: "storybook", theme: "a goblin warren", version: 3 };
const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;

function planOf(kind: "own" | "printing" = "own", repaint = false) {
  return {
    deck_id: DECK,
    style: STYLE,
    visibility: "public",
    entries: [{ entry_id: ENTRY, name: "Archivist", kind, credits: 1, repaint }],
  };
}

const OWN_CARD = {
  id: "card-1",
  owner_id: "u1",
  title: "Archivist of Lost Hours",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human", "Wizard"],
  cost: "{2}{U}",
  color_identity: ["blue"],
  rules_text: "Flying",
  flavor_text: "Every hour is filed.",
  frame_style: { template: "m15" },
  back_face: null,
  artist_credit: "Jane Painter",
  art_url: ART("mine.png"),
  art_position: { x: 0.5, y: 0.5, zoom: 1.2 },
};

const ROW = (over: Record<string, unknown> = {}) => ({
  cardId: "card-1",
  entryId: null,
  styleVersion: 3,
  artUrl: ART("ai-old.jpg"),
  backArtUrl: null,
  made: false,
  previousArtUrl: ART("mine.png"),
  previousArtPosition: null,
  previousBackArtUrl: null,
  previousBackArtPosition: null,
  previousArtistCredit: "Jane Painter",
  previousBackArtistCredit: null,
  paintedAt: "",
  imageModel: null,
  method: null,
  ...over,
});

const run = (plan: unknown, step: JobStep = STEP) => runReartStep("u1", "job-1", plan, step, 0, DEPS);

beforeEach(() => {
  for (const fn of Object.values(m)) if (typeof fn === "function") (fn as ReturnType<typeof vi.fn>).mockReset();
  m.access.mockResolvedValue({ userId: "u1", via: "grant" });
  m.styleAdmin.mockResolvedValue(STYLE);
  m.paintedAdmin.mockResolvedValue(null);
  m.paintedRows.mockResolvedValue([]);
  m.madeForEntry.mockResolvedValue(null);
  m.words.mockResolvedValue({ ok: true, words: null });
  m.link.mockResolvedValue({ ok: true });
  m.writePainted.mockResolvedValue(true);
  m.entry.error = null;
  m.entry.select = "";
  m.rows.deck_cards = { id: ENTRY, name: "Archivist", board: "main", card_id: "card-1", scryfall_id: null };
  m.rows.cards = OWN_CARD;
  m.bakedBack.mockReturnValue(false);
  m.image.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: "flux" });
  m.persist.mockResolvedValue({ ok: true, publicUrl: ART("ai-new.jpg") });
  m.update.mockResolvedValue({ ok: true, cardId: "card-1", slug: "archivist" });
  m.customize.mockResolvedValue({ ...STEP, status: "done", card_id: "made-1" });
  m.credited.mockImplementation(async (_u, _j, _amount, _reason, _step, body: () => Promise<JobStep>) => body());
  m.restyle.mockResolvedValue({ ok: true, bytes: new Uint8Array([2]), contentType: "image/png", model: "google/gemini-2.5-flash-image", promptIndex: 0 });
  m.scryfallRate.mockResolvedValue({ ok: true });
  m.getCard.mockResolvedValue({ id: "sf-1", name: "Krenko, Mob Boss" });
  m.artCrop.mockResolvedValue({ ok: true, bytes: new Uint8Array([5]), contentType: "image/jpeg" });
  m.storedArt.mockResolvedValue({ bytes: new Uint8Array([6]), contentType: "image/png" });
});

describe("the step trusts nothing in the plan", () => {
  it("a closed tool, another user or a plan that doesn't read fail before any read", async () => {
    m.access.mockResolvedValueOnce(null);
    expect((await run(planOf())).status).toBe("failed");
    m.access.mockResolvedValueOnce({ userId: "someone", via: "grant" });
    expect((await run(planOf())).status).toBe("failed");
    expect((await run({ deck_id: DECK, entries: [] })).status).toBe("failed");
    expect(m.styleAdmin).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("a run priced in a style the deck no longer has stops before any charge", async () => {
    m.styleAdmin.mockResolvedValue({ ...STYLE, version: 4 });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "failed", error: REART_STYLE_CHANGED });
    m.styleAdmin.mockResolvedValue({ ...STYLE, theme: "something else" });
    expect((await run(planOf())).status).toBe("failed");
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("an entry no longer in the caller's deck fails", async () => {
    m.rows.deck_cards = null;
    expect(await run(planOf())).toMatchObject({ status: "failed", error: "This card is no longer in your deck." });
    expect(m.credited).not.toHaveBeenCalled();
  });

  // 2026-11-13: migration 0209's table read to the API as a second link
  // between decks and deck_cards; the unnamed embed was refused (PGRST201)
  // and every card of every run was told it had left its deck.
  it("reads the entry's deck by its foreign key's NAME, and a read the API refuses is said as one — never “no longer in your deck”", async () => {
    await run(planOf());
    expect(m.entry.select).toContain("decks!deck_cards_deck_id_fkey!inner(owner_id)");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.entry.error = { code: "PGRST201", message: "Could not embed because more than one relationship was found" };
    m.credited.mockClear();
    m.image.mockClear();
    const result = await run(planOf());
    expect(result.status).toBe("failed");
    expect(result.error).toBe("We couldn't read this card's deck entry — try it again.");
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
    expect(String(logged.mock.calls[0][0])).toMatch(/^\[re-art\] deck entry .* not read: PGRST201 /);
    logged.mockRestore();
  });
});

describe("the maker's own card", () => {
  it("gets its ART edited — the picture, its fit and the AI's credit alone — under the Re-art label, one credit", async () => {
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited.mock.calls[0][2]).toBe(1);
    expect(m.credited.mock.calls[0][3]).toBe("deck_reart_art");
    const [cardId, payload] = m.update.mock.calls[0];
    expect(cardId).toBe("card-1");
    expect(Object.keys(payload).sort()).toEqual(["art_position", "art_url", "artist_credit"]);
    expect(payload.art_url).toBe(ART("ai-new.jpg"));
    expect(payload.artist_credit).toBe("AI");
  });

  it("paints the card's own subject in the deck's style", async () => {
    await run(planOf());
    const ladder: string[] = m.image.mock.calls[0][0];
    expect(ladder[0]).toContain("Archivist of Lost Hours");
    expect(ladder[0]).toContain("a goblin warren");
    expect(ladder[0]).toContain("storybook");
  });

  it("keeps the picture it had, so it can be put back", async () => {
    await run(planOf());
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({
      cardId: "card-1",
      styleVersion: 3,
      artUrl: ART("ai-new.jpg"),
      made: false,
      previousArtUrl: ART("mine.png"),
      previousArtPosition: OWN_CARD.art_position,
      previousArtistCredit: "Jane Painter",
    });
    expect(m.discard).not.toHaveBeenCalled();
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("a re-roll replaces Re-art's own picture (handed to the guarded discard) and keeps the maker's earlier art", async () => {
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-old.jpg"), artist_credit: "AI" };
    m.paintedAdmin.mockResolvedValue(ROW());
    m.paintedRows.mockResolvedValue([ROW()]);
    await run(planOf("own", true));
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({
      previousArtUrl: ART("mine.png"),
      previousArtistCredit: "Jane Painter",
      artUrl: ART("ai-new.jpg"),
    });
    // Never removed outright: only the guarded discard may take it (a remix
    // of this card, or the card in another deck, can still show it).
    expect(m.discardUnused).toHaveBeenCalledWith("u1", ART("ai-old.jpg"));
    expect(m.discardUnused).not.toHaveBeenCalledWith("u1", ART("mine.png"));
    expect(m.discard).not.toHaveBeenCalled();
    // The row FIRST (the art to put back is named there before the card
    // stops showing it — another step's guard may be asking right then),
    // the card's edit, and only then the guard, so the card itself no
    // longer counts.
    const [row] = m.writePainted.mock.invocationCallOrder;
    const [cardEdit] = m.update.mock.invocationCallOrder;
    const [guard] = m.discardUnused.mock.invocationCallOrder;
    expect(row).toBeLessThan(cardEdit);
    expect(cardEdit).toBeLessThan(guard);
    expect(m.revert).not.toHaveBeenCalled();
  });

  it("a two-faced re-roll hands BOTH replaced pictures to the guarded discard", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = {
      ...OWN_CARD,
      art_url: ART("ai-old.jpg"),
      artist_credit: "AI",
      back_face: { title: "Back", card_type: "creature", subtypes: [], art_url: ART("ai-old-back.jpg"), artist_credit: "AI" },
    };
    const row = ROW({ backArtUrl: ART("ai-old-back.jpg"), previousBackArtUrl: ART("back.png") });
    m.paintedAdmin.mockResolvedValue(row);
    m.paintedRows.mockResolvedValue([row]);
    m.persist.mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-front.jpg") }).mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-back.jpg") });
    await run(planOf("own", true));
    expect(m.discardUnused.mock.calls).toEqual([
      ["u1", ART("ai-old.jpg")],
      ["u1", ART("ai-old-back.jpg")],
    ]);
    // The maker's own earlier back art stays the art to put back.
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousArtUrl: ART("mine.png"), previousBackArtUrl: ART("back.png") });
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("a card painted from ANOTHER deck keeps the maker's original as the art to put back (never the AI picture)", async () => {
    // Deck B painted X over the original; this deck has no row yet.
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-x.jpg"), artist_credit: "AI" };
    m.paintedRows.mockResolvedValue([ROW({ artUrl: ART("ai-x.jpg") })]);
    await run(planOf());
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousArtUrl: ART("mine.png"), previousArtistCredit: "Jane Painter" });
    expect(m.discardUnused).toHaveBeenCalledWith("u1", ART("ai-x.jpg"));
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("art the maker set by hand since a paint becomes the art to put back", async () => {
    m.rows.cards = { ...OWN_CARD, art_url: ART("hand.png"), artist_credit: "Me" };
    m.paintedAdmin.mockResolvedValue(ROW());
    m.paintedRows.mockResolvedValue([ROW()]);
    await run(planOf("own", true));
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousArtUrl: ART("hand.png"), previousArtistCredit: "Me" });
    expect(m.discard).not.toHaveBeenCalled();
    expect(m.discardUnused).not.toHaveBeenCalledWith("u1", ART("hand.png"));
  });

  it("is never painted (or charged) twice: in the style already and still showing it → done, no charge", async () => {
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-old.jpg"), artist_credit: "AI" };
    m.paintedAdmin.mockResolvedValue({ cardId: "card-1", styleVersion: 3, artUrl: ART("ai-old.jpg"), made: false });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("painted in this style but showing OTHER art now, or given its own art back: left as it is, no charge — unless named", async () => {
    // The maker changed its art in the editor (or a run of another deck
    // repainted it) after this deck's paint: their choice stands.
    m.rows.cards = { ...OWN_CARD, art_url: ART("hand.png"), artist_credit: "Me" };
    m.paintedAdmin.mockResolvedValue(ROW());
    m.paintedRows.mockResolvedValue([ROW()]);
    const changed = await run(planOf());
    expect(changed).toMatchObject({ status: "done", card_id: "card-1" });
    expect(changed.note).toMatch(/has other art now/);
    // "Kept": its old art was put back from the tool (the row holds no picture).
    m.paintedAdmin.mockResolvedValue(ROW({ artUrl: null, previousArtUrl: null }));
    const kept = await run(planOf());
    expect(kept).toMatchObject({ status: "done", card_id: "card-1" });
    expect(kept.note).toMatch(/keeps its own art/);
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.writePainted).not.toHaveBeenCalled();

    // Named (a re-roll): painted, and the art of the moment is the art to
    // put back.
    m.paintedAdmin.mockResolvedValue(ROW());
    const named = await run(planOf("own", true));
    expect(named).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][1].art_url).toBe(ART("ai-new.jpg"));
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-new.jpg"), previousArtUrl: ART("hand.png") });
  });

  it("a two-faced card paints both faces for two credits", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = {
      ...OWN_CARD,
      back_face: { title: "Back", card_type: "creature", subtypes: [], art_url: ART("back.png"), artist_credit: "Back Artist" },
    };
    m.persist.mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-front.jpg") }).mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-back.jpg") });
    await run(planOf());
    expect(m.credited.mock.calls[0][2]).toBe(2);
    const payload = m.update.mock.calls[0][1];
    expect(payload.back_face).toMatchObject({ title: "Back", art_url: ART("ai-back.jpg"), artist_credit: "AI" });
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousBackArtUrl: ART("back.png"), previousBackArtistCredit: "Back Artist" });
  });

  it("a stored back the card action would refuse is found before anything is paid for", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = { ...OWN_CARD, back_face: { title: "Back", not_a_back_key: true } };
    expect((await run(planOf())).status).toBe("failed");
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("a refused edit discards the new picture, puts the row back and fails (the wrapper refunds)", async () => {
    m.update.mockResolvedValue({ ok: false, formError: "Nope." });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "failed", error: "Nope." });
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-new.jpg"));
    // The row was written first; the paint never landed, so it goes back to
    // what it said — here: no row at all.
    expect(m.writePainted).toHaveBeenCalledTimes(1);
    expect(m.revert).toHaveBeenCalledWith("u1", DECK, "card-1", null);
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("a refused re-roll puts the earlier row back as it was, and removes nothing the card still shows", async () => {
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-old.jpg"), artist_credit: "AI" };
    const before = ROW();
    m.paintedAdmin.mockResolvedValue(before);
    m.paintedRows.mockResolvedValue([before]);
    m.update.mockResolvedValue({ ok: false, formError: "Nope." });
    expect((await run(planOf("own", true))).status).toBe("failed");
    expect(m.revert).toHaveBeenCalledWith("u1", DECK, "card-1", before);
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-new.jpg"));
    expect(m.discard).not.toHaveBeenCalledWith("u1", ART("ai-old.jpg"));
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("an edit that THROWS is undone the same way, and the throw goes on to the credit wrapper", async () => {
    m.update.mockRejectedValue(new Error("boom"));
    await expect(run(planOf())).rejects.toThrow("boom");
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-new.jpg"));
    expect(m.revert).toHaveBeenCalledWith("u1", DECK, "card-1", null);
    expect(m.discardUnused).not.toHaveBeenCalled();
  });

  it("finishes a paint of its OWN run that never reached the card (the function was killed after the row)", async () => {
    // The row says this run painted ai-lost.jpg; the card still shows the
    // maker's art. Read as "has other art now" it was reported done with
    // the card never painted.
    const lost = ROW({ artUrl: ART("ai-lost.jpg"), jobId: "job-1" });
    m.paintedAdmin.mockResolvedValue(lost);
    m.paintedRows.mockResolvedValue([lost]);
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][1].art_url).toBe(ART("ai-new.jpg"));
    // The art to put back is the card's own; the lost try's picture goes.
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ artUrl: ART("ai-new.jpg"), previousArtUrl: ART("mine.png") });
    expect(m.discardUnused).toHaveBeenCalledWith("u1", ART("ai-lost.jpg"));
  });

  it("the same row from ANOTHER run is someone's later choice: left as it is", async () => {
    m.paintedAdmin.mockResolvedValue(ROW({ artUrl: ART("ai-lost.jpg"), jobId: "job-0" }));
    const other = await run(planOf());
    expect(other.note).toMatch(/has other art now/);
    m.paintedAdmin.mockResolvedValue(ROW({ artUrl: ART("ai-lost.jpg"), jobId: null }));
    expect((await run(planOf())).note).toMatch(/has other art now/);
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("a row that couldn't be written is not reverted; the edit still goes ahead, with a note", async () => {
    m.writePainted.mockResolvedValue(false);
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(result.note).toMatch(/can't be put back/);
    m.update.mockResolvedValue({ ok: false, formError: "Nope." });
    expect((await run(planOf())).status).toBe("failed");
    expect(m.revert).not.toHaveBeenCalled();
  });

  it("another creator's card and an emblem are never touched", async () => {
    m.rows.cards = { ...OWN_CARD, owner_id: "someone" };
    expect((await run(planOf())).status).toBe("failed");
    m.rows.cards = { ...OWN_CARD, card_type: "emblem" };
    expect((await run(planOf())).status).toBe("failed");
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe("the deck's rules at step time", () => {
  it("an entry moved to the maybeboard is not painted", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Archivist", board: "maybe", card_id: "card-1", scryfall_id: null };
    expect((await run(planOf())).status).toBe("failed");
    expect(m.credited).not.toHaveBeenCalled();
  });
});

describe("a real card", () => {
  beforeEach(() => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: null, scryfall_id: "sf-1" };
  });

  it("goes through Bulk Customize's core with the deck's style as its prompt and label", async () => {
    await run(planOf("printing"));
    const [, , , options] = m.customize.mock.calls[0];
    expect(options.source).toEqual({ kind: "deck_entry", id: ENTRY });
    expect(options.aiLabel).toBe("deck_reart_art");
    expect(options.choices).toMatchObject({ art: "ai", visibility: "public" });
    const { prompt } = options.artPrompt({ title: "Krenko, Mob Boss", subtypes: ["Goblin"], card_type: "creature" }, "front");
    expect(prompt).toContain("Krenko, Mob Boss");
    expect(prompt).toContain("a goblin warren");
    expect(options.refusePlanned({ card_type: "emblem" })).toBeTruthy();
    expect(options.refusePlanned({ card_type: "creature" })).toBeNull();
  });

  it("records the card it made as painted in the style, with nothing to put back", async () => {
    await run(planOf("printing"));
    const [, , , options] = m.customize.mock.calls[0];
    await options.onSaved("made-1", { front: ART("ai-1.jpg"), back: null }, ["bfl/flux-2-flex"]);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({
      cardId: "made-1",
      styleVersion: 3,
      made: true,
      previousArtUrl: null,
      imageModel: "bfl/flux-2-flex",
    });
    // A card whose art no model painted (none was asked for) names none.
    await options.onSaved("made-2", { front: null, back: null }, []);
    expect(m.writePainted.mock.calls[1][3]).toMatchObject({ cardId: "made-2", imageModel: null });
  });

  it("a card an earlier run MADE whose link didn't land is linked again, never made twice", async () => {
    m.madeForEntry.mockResolvedValue("made-0");
    m.rows.cards = { ...OWN_CARD, id: "made-0", art_url: ART("ai-0.jpg"), artist_credit: "AI" };
    m.paintedAdmin.mockResolvedValue(ROW({ cardId: "made-0", made: true, artUrl: ART("ai-0.jpg") }));
    const result = await run(planOf("printing"));
    expect(m.link).toHaveBeenCalledWith(ENTRY, "made-0", { surface: "deck" });
    expect(m.customize).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
    expect(result.status).toBe("done");
  });

  it("an entry another run already made is the own-card path (found in the style, no charge)", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: "card-1", scryfall_id: "sf-1" };
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-1.jpg"), artist_credit: "AI" };
    m.paintedAdmin.mockResolvedValue({ cardId: "card-1", styleVersion: 3, artUrl: ART("ai-1.jpg"), made: true });
    const result = await run(planOf("printing"));
    expect(result.status).toBe("done");
    expect(m.customize).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
  });
});

describe("the maker's own prompts (0209)", () => {
  const OWN_STYLE = { ...STYLE, mode: "custom" as const, prompt: "An oil painting of {card}, candle-lit, thick paint" };
  const NO_FRAME = "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.";
  const planIn = (style: Record<string, unknown>, kind: "own" | "printing" = "own") => ({ ...planOf(kind), style });
  const ladder = (call = 0): string[] => m.image.mock.calls[call][0];

  it("a card's own words are read by ENTRY from the server — the plan names none — and paint its subject in the deck's style", async () => {
    m.words.mockResolvedValue({ ok: true, words: { text: "an old goblin librarian asleep on a heap of books", only: false } });
    await run(planOf());
    expect(m.words).toHaveBeenCalledWith("u1", DECK, ENTRY);
    const [first] = ladder();
    expect(first.startsWith("an old goblin librarian asleep on a heap of books. Rendered strictly in storybook style.")).toBe(true);
    expect(first).toContain("a goblin warren");
    expect(first).not.toMatch(/Trading-card illustration|Archivist of Lost Hours/);
    expect(first.endsWith(NO_FRAME)).toBe(true);
  });

  it("words that couldn't be READ stop the step before any charge — never painted as “no words”", async () => {
    // Read as none, a card with words of its own was painted from the
    // deck's prompt, charged, and recorded as in the style.
    m.words.mockResolvedValue({ ok: false });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "failed" });
    expect(result.error).toMatch(/own words couldn't be read/);
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    // A real card's entry: the same, before the card is made.
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: null, scryfall_id: "sf-1" };
    expect((await run(planOf("printing"))).status).toBe("failed");
    expect(m.customize).not.toHaveBeenCalled();
  });

  it("“only these words” is the card's whole prompt", async () => {
    m.words.mockResolvedValue({ ok: true, words: { text: "A lone lighthouse in a storm, woodcut", only: true } });
    await run(planOf());
    expect(ladder()[0]).toBe(`A lone lighthouse in a storm, woodcut. ${NO_FRAME}`);
  });

  it("the maker's own deck prompt replaces the template, filled in for the card", async () => {
    m.styleAdmin.mockResolvedValue(OWN_STYLE);
    await run(planIn(OWN_STYLE));
    expect(ladder()[0]).toBe(
      `An oil painting of "Archivist of Lost Hours", a Creature — Human Wizard, candle-lit, thick paint. ${NO_FRAME}`,
    );
  });

  it("the maker's words are dressed if refused, never swapped for a picture built from the card's name", async () => {
    m.words.mockResolvedValue({ ok: true, words: { text: "a goblin chef", only: false } });
    await run(planOf());
    expect(ladder()).toHaveLength(2);
    expect(ladder().join(" ")).not.toMatch(/Symbolic fantasy|evoking/);
    // The same for the maker's own deck prompt…
    m.words.mockResolvedValue({ ok: true, words: null });
    m.styleAdmin.mockResolvedValue(OWN_STYLE);
    await run(planIn(OWN_STYLE));
    expect(ladder(1)).toHaveLength(2);
    // …while the template alone keeps its three rungs, ending on the card's name.
    m.styleAdmin.mockResolvedValue(STYLE);
    await run(planOf());
    expect(ladder(2)).toHaveLength(3);
    expect(ladder(2)[2]).toMatch(/Symbolic fantasy/);
    // A retry sends the maker's words AS WRITTEN first again (a slow
    // provider refused nothing): the same two rungs on every try.
    m.words.mockResolvedValue({ ok: true, words: { text: "a goblin chef", only: false } });
    await run(planOf(), { ...STEP, attempts: 2 });
    expect(ladder(3)).toEqual(ladder(0));
  });

  it("a run priced in the template stops before any charge once the deck has the maker's own prompt (and the other way)", async () => {
    m.styleAdmin.mockResolvedValue(OWN_STYLE);
    expect(await run(planOf())).toMatchObject({ status: "failed", error: REART_STYLE_CHANGED });
    m.styleAdmin.mockResolvedValue(STYLE);
    expect(await run(planIn(OWN_STYLE))).toMatchObject({ status: "failed", error: REART_STYLE_CHANGED });
    m.styleAdmin.mockResolvedValue({ ...OWN_STYLE, prompt: "Another prompt altogether, in gouache" });
    expect(await run(planIn(OWN_STYLE))).toMatchObject({ status: "failed", error: REART_STYLE_CHANGED });
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("a card's own words are its FRONT's: a back face is painted from the deck's prompt", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = {
      ...OWN_CARD,
      back_face: { title: "The Hour Unbound", card_type: "creature", subtypes: ["Spirit"], art_url: ART("back.png") },
    };
    m.words.mockResolvedValue({ ok: true, words: { text: "a goblin chef juggling knives", only: true } });
    m.persist.mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-front.jpg") }).mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-back.jpg") });
    await run(planOf());
    expect(ladder(0)[0]).toBe(`a goblin chef juggling knives. ${NO_FRAME}`);
    expect(ladder(1)[0]).toContain("The Hour Unbound");
    expect(ladder(1)[0]).not.toContain("goblin chef");
    // The back's prompt is the template's: its own three rungs.
    expect(ladder(1)).toHaveLength(3);
  });

  it("a real card is made with the same prompt rules, and says when the prompt is the maker's", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: null, scryfall_id: "sf-1" };
    m.words.mockResolvedValue({ ok: true, words: { text: "a goblin boss on a throne of crates", only: false } });
    await run(planOf("printing"));
    const [, , , options] = m.customize.mock.calls[0];
    const payload = { title: "Krenko, Mob Boss", subtypes: ["Goblin"], card_type: "creature", back_face: { title: "Back", subtypes: [] } };
    const front = options.artPrompt(payload, "front");
    expect(front.exact).toBe(true);
    expect(front.prompt.startsWith("a goblin boss on a throne of crates. Rendered strictly in storybook style.")).toBe(true);
    const back = options.artPrompt(payload, "back");
    expect(back.exact).toBe(false);
    expect(back.prompt).not.toContain("throne of crates");
    // No words, the template: the bulk core keeps its own ladder.
    m.words.mockResolvedValue({ ok: true, words: null });
    await run(planOf("printing"));
    expect(m.customize.mock.calls[1][3].artPrompt(payload, "front").exact).toBe(false);
  });
});

describe("the model that paints (0211)", () => {
  const KONTEXT = "bfl/flux-kontext-pro";
  const PLAIN_CLOSING =
    "The painting covers the entire image from edge to edge: no white margin, paper edge, border or frame, and no text, letters, signature, title or caption anywhere.";
  const planWith = (model: unknown, kind: "own" | "printing" = "own") => ({ ...planOf(kind), model });
  const ladder = (call = 0): string[] => m.image.mock.calls[call][0];
  const options = (call = 0): { budgetMs: number; model?: string } => m.image.mock.calls[call][2];

  it("a plan that names none (every run before 0211) is Automatic: the image door's own default, the wording as it was", async () => {
    await run(planOf());
    expect(options().model).toBeUndefined();
    expect(options().budgetMs).toBeGreaterThan(0);
    expect(ladder()).toHaveLength(3);
    expect(ladder()[0].startsWith('Trading-card illustration of "Archivist of Lost Hours", a Creature — Human Wizard.')).toBe(true);
    // Automatic by name is the same run.
    await run(planWith("auto"));
    expect(options(1).model).toBeUndefined();
    expect(ladder(1)).toEqual(ladder(0));
  });

  it("a named model paints alone, and the row says who painted", async () => {
    m.image.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: KONTEXT });
    const result = await run(planWith(KONTEXT));
    expect(result).toMatchObject({ status: "done", image_model: KONTEXT });
    expect(options().model).toBe(KONTEXT);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ cardId: "card-1", imageModel: KONTEXT });
    // Still one credit, under the tool's own label.
    expect(m.credited.mock.calls[0][2]).toBe(1);
    expect(m.credited.mock.calls[0][3]).toBe("deck_reart_art");
  });

  it("FLUX.2 [pro] by name is sent FLUX.2's wording and its three rungs", async () => {
    await run(planWith("bfl/flux-2-pro"));
    expect(options().model).toBe("bfl/flux-2-pro");
    expect(ladder()).toHaveLength(3);
    expect(ladder()[0]).toContain("Trading-card illustration of");
    expect(ladder()[0]).toContain("NO frame, NO borders");
  });

  it("any other model is sent the PLAIN wording: no quoted title, no “trading-card”, the edge-to-edge closing line", async () => {
    await run(planWith(KONTEXT));
    const [first] = ladder();
    expect(first.startsWith("Fantasy illustration of Archivist of Lost Hours, a Creature — Human Wizard. Its mood: Every hour is filed.")).toBe(true);
    expect(first).toContain("The world and look: a goblin warren.");
    expect(first.endsWith(PLAIN_CLOSING)).toBe(true);
    expect(first).not.toMatch(/Trading-card|"|NO frame|deck/);
  });

  it("…and is never swapped for the ladder's generic rung (FLUX.2's wording): dressed once, then the step fails", async () => {
    await run(planWith("google/gemini-3.1-flash-image"));
    expect(ladder()).toHaveLength(2);
    expect(ladder().join(" ")).not.toMatch(/Symbolic fantasy|evoking|Trading-card/);
    // The same two rungs on a retry.
    await run(planWith("google/gemini-3.1-flash-image"), { ...STEP, attempts: 2 });
    expect(ladder(1)).toEqual(ladder(0));
  });

  it("a model that reads a shorter prompt is sent a shorter one: the closing line stays inside what it reads", async () => {
    const LONG = { ...STYLE, mode: "custom" as const, prompt: Array.from({ length: 60 }, () => "{card} in thick oil paint, candle-lit").join(", ") };
    m.styleAdmin.mockResolvedValue(LONG);
    await run({ ...planWith(KONTEXT), style: LONG });
    const [kontext] = ladder();
    expect(kontext.endsWith(PLAIN_CLOSING)).toBe(true);
    expect(kontext.length).toBeLessThanOrEqual(1400 + 2 + PLAIN_CLOSING.length);
    // The same prompt on a model with no limit of its own is sent whole.
    await run({ ...planWith("spacexai/grok-imagine-image-2.0"), style: LONG });
    expect(ladder(1)[0].length).toBeGreaterThan(2400);
    expect(ladder(1)[0].endsWith(PLAIN_CLOSING)).toBe(true);
  });

  it("the maker's own words go to a named model in its wording too", async () => {
    m.words.mockResolvedValue({ ok: true, words: { text: "A lone lighthouse in a storm, woodcut", only: true } });
    await run(planWith("spacexai/grok-imagine-image"));
    expect(ladder()[0]).toBe(`A lone lighthouse in a storm, woodcut. ${PLAIN_CLOSING}`);
  });

  it("a model the tool doesn't list is refused before any read or charge — the plan is its owner's to write", async () => {
    for (const model of ["openai/gpt-image-1", "xai/grok-imagine-image", "", 7, null]) {
      expect((await run(planWith(model))).status).toBe("failed");
    }
    expect(m.styleAdmin).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
  });

  it("naming a model is for admins and testers: a plan's audience is refused before any read or charge — and still paints on Automatic", async () => {
    // The tool released to a plan: this maker came in through theirs.
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: null });
    const refused = await run(planWith(KONTEXT));
    expect(refused.status).toBe("failed");
    expect(refused.error).toMatch(/testers/);
    expect(m.styleAdmin).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
    // A run that names none is theirs as it always was.
    expect((await run(planOf())).status).toBe("done");
    expect(options().model).toBeUndefined();
    // A tester of a released tool still holds the grant: they may name one.
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: { grantedAt: "2026-11-01T00:00:00Z", expiresAt: null } });
    expect((await run(planWith(KONTEXT))).status).toBe("done");
    expect(options(1).model).toBe(KONTEXT);
    // …and an admin.
    m.access.mockResolvedValue({ userId: "u1", via: "admin", grant: null });
    expect((await run(planWith(KONTEXT))).status).toBe("done");
  });

  it("a two-faced card says both models when two painted it, one when one did", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = {
      ...OWN_CARD,
      back_face: { title: "The Hour Unbound", card_type: "creature", subtypes: ["Spirit"], art_url: ART("back.png") },
    };
    // Automatic: the default painted the front, its backup the back.
    m.image
      .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: "bfl/flux-2-flex" })
      .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: "bfl/flux-2-pro" });
    await run(planOf());
    expect(m.writePainted.mock.calls[0][3].imageModel).toBe("bfl/flux-2-flex + bfl/flux-2-pro");
    // A named model painted both: said once.
    m.image.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: KONTEXT });
    await run(planWith(KONTEXT));
    expect(m.writePainted.mock.calls[1][3].imageModel).toBe(KONTEXT);
    expect(options(2).model).toBe(KONTEXT);
    expect(options(3).model).toBe(KONTEXT);
  });

  it("a real card is made by the named model, in its wording, and never on the bulk core's generic rung", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: null, scryfall_id: "sf-1" };
    await run(planWith(KONTEXT, "printing"));
    const [, , , made] = m.customize.mock.calls[0];
    expect(made.imageModel).toBe(KONTEXT);
    const payload = { title: "Krenko, Mob Boss", subtypes: ["Goblin"], card_type: "creature" };
    const front = made.artPrompt(payload, "front");
    expect(front.exact).toBe(true);
    expect(front.prompt.startsWith("Fantasy illustration of Krenko, Mob Boss, a Creature — Goblin.")).toBe(true);
    expect(front.prompt.endsWith(PLAIN_CLOSING)).toBe(true);
    await made.onSaved("made-1", { front: ART("ai-1.jpg"), back: ART("ai-2.jpg") }, [KONTEXT]);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ cardId: "made-1", imageModel: KONTEXT });
    // Automatic: no model named, the bulk core's own ladder.
    await run(planOf("printing"));
    const [, , , auto] = m.customize.mock.calls[1];
    expect(auto.imageModel).toBeUndefined();
    expect(auto.artPrompt(payload, "front").exact).toBe(false);
    expect(auto.artPrompt(payload, "front").prompt).toContain('Trading-card illustration of "Krenko, Mob Boss"');
  });
});

describe("a picture that starts from the card's own art (0212 restyle)", () => {
  const LEAD = "Repaint this exact picture in a new art style.";
  const PLAIN_CLOSING =
    "The painting covers the entire image from edge to edge: no white margin, paper edge, border or frame, and no text, letters, signature, title or caption anywhere.";
  const restylePlan = (kind: "own" | "printing" = "own", model?: string) => ({ ...planOf(kind), method: "restyle", ...(model ? { model } : {}) });
  const ladder = (call = 0): string[] => m.restyle.mock.calls[call][0];
  const sourceOf = (call = 0): { bytes: Uint8Array; contentType: string } => m.restyle.mock.calls[call][1];
  const optionsOf = (call = 0): { budgetMs: number; model?: string } => m.restyle.mock.calls[call][3];
  const linkedToPrinting = () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: "card-1", scryfall_id: "sf-1" };
  };

  it("a plan that names none (every run before 0212) paints from the prompt alone, and the row says so", async () => {
    await run(planOf());
    expect(m.restyle).not.toHaveBeenCalled();
    expect(m.image).toHaveBeenCalledTimes(1);
    expect(m.getCard).not.toHaveBeenCalled();
    expect(m.storedArt).not.toHaveBeenCalled();
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ method: "paint" });
  });

  it("the maker's own version of a REAL card starts from the real card's art, read on their own Scryfall quota", async () => {
    linkedToPrinting();
    const result = await run(restylePlan());
    expect(result).toMatchObject({ status: "done", image_model: "google/gemini-2.5-flash-image" });
    expect(result.note).toBe("Restyled from the real card's art.");
    // The lookup, then the art — the restyle's own quota, never the one for
    // art a maker imports and keeps: both asked before either call.
    expect(m.scryfallRate.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["u1", "named"],
      ["u1", "restyle_art"],
    ]);
    expect(m.scryfallLog).toHaveBeenCalledWith("u1", "named");
    expect(m.getCard).toHaveBeenCalledWith("sf-1");
    expect(m.artCrop).toHaveBeenCalledTimes(1);
    expect(m.artCrop.mock.calls[0].slice(0, 3)).toEqual(["u1", { id: "sf-1", name: "Krenko, Mob Boss" }, "front"]);
    // Never the card's own stored art, and never a picture from the prompt alone.
    expect(m.storedArt).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
    expect([...sourceOf().bytes]).toEqual([5]);
    // One credit, under the tool's label; the row says how it was made.
    expect(m.credited.mock.calls[0][2]).toBe(1);
    expect(m.credited.mock.calls[0][3]).toBe("deck_reart_art");
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ method: "restyle", imageModel: "google/gemini-2.5-flash-image", previousArtUrl: ART("mine.png") });
  });

  it("the prompt goes with the picture: the opening, the deck's look, the closing line — as written, dressed once if refused", async () => {
    linkedToPrinting();
    await run(restylePlan());
    expect(ladder()).toHaveLength(2);
    const [first] = ladder();
    expect(first.startsWith(`${LEAD} Keep every character and object`)).toBe(true);
    expect(first).toContain("Rendered strictly in storybook style.");
    expect(first).toContain("The world and look: a goblin warren.");
    expect(first.endsWith(PLAIN_CLOSING)).toBe(true);
    // The picture is the subject: nothing of the card's name, type or text.
    expect(first).not.toMatch(/Archivist|Human Wizard|Every hour|Trading-card|Fantasy illustration/);
    expect(ladder().join(" ")).not.toMatch(/Symbolic fantasy|evoking/);
  });

  it("Automatic names no model (the image door's own restyle model); a picked model repaints alone", async () => {
    linkedToPrinting();
    await run(restylePlan());
    expect(optionsOf().model).toBeUndefined();
    expect(optionsOf().budgetMs).toBeGreaterThan(0);
    m.restyle.mockResolvedValue({ ok: true, bytes: new Uint8Array([2]), contentType: "image/png", model: "bfl/flux-kontext-pro", promptIndex: 0 });
    await run(restylePlan("own", "bfl/flux-kontext-pro"));
    expect(optionsOf(1).model).toBe("bfl/flux-kontext-pro");
    expect(m.writePainted.mock.calls[1][3]).toMatchObject({ method: "restyle", imageModel: "bfl/flux-kontext-pro" });
    // Kontext reads a shorter prompt: a long one of the maker's is cut so the closing line is inside it.
    const LONG = { ...STYLE, mode: "custom" as const, prompt: Array.from({ length: 60 }, () => "{card} in thick oil paint, candle-lit").join(", ") };
    m.styleAdmin.mockResolvedValue(LONG);
    await run({ ...restylePlan("own", "bfl/flux-kontext-pro"), style: LONG });
    expect(ladder(2)[0].length).toBeLessThanOrEqual(1400 + 2 + PLAIN_CLOSING.length);
    expect(ladder(2)[0].endsWith(PLAIN_CLOSING)).toBe(true);
  });

  it("a card of the maker's own with NO printing starts from its own art", async () => {
    const result = await run(restylePlan());
    expect(result).toMatchObject({ status: "done" });
    expect(result.note).toBe("Restyled from the art it had before Re-art.");
    expect(m.storedArt).toHaveBeenCalledWith(ART("mine.png"));
    expect([...sourceOf().bytes]).toEqual([6]);
    // No Scryfall call: there is no printing to ask about.
    expect(m.scryfallRate).not.toHaveBeenCalled();
    expect(m.getCard).not.toHaveBeenCalled();
    expect(m.artCrop).not.toHaveBeenCalled();
  });

  it("…the art it had BEFORE Re-art: a re-roll never restyles a picture Re-art painted", async () => {
    // The card shows a picture this deck's run painted; its own art is the row's art to put back.
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-old.jpg"), artist_credit: "AI" };
    m.paintedAdmin.mockResolvedValue(ROW());
    m.paintedRows.mockResolvedValue([ROW()]);
    await run({ ...restylePlan(), entries: [{ entry_id: ENTRY, name: "Archivist", kind: "own", credits: 1, repaint: true }] });
    expect(m.storedArt).toHaveBeenCalledWith(ART("mine.png"));
    expect(m.storedArt).not.toHaveBeenCalledWith(ART("ai-old.jpg"));
    // …and it stays the art to put back.
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ method: "restyle", previousArtUrl: ART("mine.png") });
  });

  it("no art to start from: the card is told so before anything is reserved, and nothing is charged", async () => {
    m.storedArt.mockResolvedValue(null);
    const result = await run(restylePlan());
    expect(result).toMatchObject({ status: "failed", error: "No art of its own to restyle — paint it from the prompt instead." });
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.restyle).not.toHaveBeenCalled();
    expect(m.image).not.toHaveBeenCalled();
    expect(m.writePainted).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("Scryfall's limits and silences stop it before any charge: a spent minute waits, a spent day fails, no answer fails", async () => {
    linkedToPrinting();
    m.scryfallRate.mockResolvedValueOnce({ ok: false, reason: "per_minute", message: "Slow down.", retryAfterSeconds: 31 });
    expect(await run(restylePlan())).toMatchObject({ status: "pending", error_code: "RATE_LIMITED", retry_after_seconds: 31 });
    // The art's limit, after the lookup's passed.
    m.scryfallRate.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "per_day", message: "That's the day's art." });
    expect(await run(restylePlan())).toMatchObject({ status: "failed", error: "That's the day's art." });
    m.getCard.mockResolvedValueOnce(null);
    expect(await run(restylePlan())).toMatchObject({ status: "failed", error: "Scryfall didn't answer for this card — try it again." });
    m.artCrop.mockResolvedValueOnce({ ok: false, error: "Scryfall has no art for this card to restyle." });
    expect(await run(restylePlan())).toMatchObject({ status: "failed", error: "Scryfall has no art for this card to restyle." });
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.restyle).not.toHaveBeenCalled();
  });

  it("a two-faced card starts each face from its own art; a back with none stops before any charge", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = {
      ...OWN_CARD,
      back_face: { title: "The Hour Unbound", card_type: "creature", subtypes: ["Spirit"], art_url: ART("back.png") },
    };
    m.storedArt.mockImplementation(async (address: string) => ({ bytes: new Uint8Array([address.includes("back") ? 8 : 6]), contentType: "image/png" }));
    m.persist.mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-front.jpg") }).mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-back.jpg") });
    const result = await run(restylePlan());
    expect(result.status).toBe("done");
    expect(m.credited.mock.calls[0][2]).toBe(2);
    expect(m.storedArt.mock.calls.map(([address]) => address)).toEqual([ART("mine.png"), ART("back.png")]);
    expect([[...sourceOf(0).bytes], [...sourceOf(1).bytes]]).toEqual([[6], [8]]);

    // From a printing: its back's art — and a printing with one face can't give a two-faced card a back.
    m.credited.mockClear();
    linkedToPrinting();
    m.artCrop.mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([5]), contentType: "image/jpeg" }).mockResolvedValueOnce({ ok: false, error: "This card has no back face." });
    const stopped = await run(restylePlan());
    expect(stopped.status).toBe("failed");
    expect(stopped.error).toMatch(/its printing has no art for the back/);
    expect(m.artCrop.mock.calls.map((call) => call[2])).toEqual(["front", "back"]);
    expect(m.credited).not.toHaveBeenCalled();
  });

  it("a restyle the provider declines fails the card in the door's own words, and the wrapper refunds", async () => {
    linkedToPrinting();
    m.restyle.mockResolvedValue({ ok: false, error: "The image service declined to repaint this picture. Try another model, or paint the card from the prompt instead.", failure: "art_blocked", safetyBlocked: true });
    const result = await run(restylePlan());
    expect(result).toMatchObject({ status: "failed", failure: "art_blocked" });
    expect(result.error).toMatch(/declined to repaint this picture/);
    // Reserved (the wrapper, mocked here, refunds a failed body), never recorded or saved.
    expect(m.credited).toHaveBeenCalledTimes(1);
    expect(m.writePainted).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("is for admins and testers: a plan's audience is refused before any read or charge, on Automatic too", async () => {
    m.access.mockResolvedValue({ userId: "u1", via: "release", grant: null });
    const refused = await run(restylePlan());
    expect(refused.status).toBe("failed");
    expect(refused.error).toMatch(/testers/);
    expect(m.styleAdmin).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.restyle).not.toHaveBeenCalled();
    // A method the tool doesn't know is no plan at all.
    m.access.mockResolvedValue({ userId: "u1", via: "grant" });
    expect((await run({ ...planOf(), method: "sketch" })).status).toBe("failed");
    expect(m.styleAdmin).not.toHaveBeenCalled();
  });

  it("a real card not yet the maker's own is made through the shared core, told to start from the printing's art", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: null, scryfall_id: "sf-1" };
    await run(restylePlan("printing", "spacexai/grok-imagine-image-2.0"));
    const [, , , made] = m.customize.mock.calls[0];
    expect(made).toMatchObject({ restyle: true, imageModel: "spacexai/grok-imagine-image-2.0", aiLabel: "deck_reart_art" });
    const payload = { title: "Krenko, Mob Boss", subtypes: ["Goblin"], card_type: "creature" };
    const front = made.artPrompt(payload, "front");
    expect(front.exact).toBe(true);
    expect(front.prompt.startsWith(LEAD)).toBe(true);
    expect(front.prompt).not.toMatch(/Krenko/);
    await made.onSaved("made-1", { front: ART("ai-1.jpg"), back: null }, ["spacexai/grok-imagine-image-2.0"]);
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ cardId: "made-1", made: true, method: "restyle", imageModel: "spacexai/grok-imagine-image-2.0" });
    // From the prompt alone: the core is told no such thing, and the row says "paint".
    await run(planOf("printing"));
    const [, , , painted] = m.customize.mock.calls[1];
    expect(painted.restyle).toBe(false);
    await painted.onSaved("made-2", { front: ART("ai-2.jpg"), back: null }, ["bfl/flux-2-flex"]);
    expect(m.writePainted.mock.calls[1][3]).toMatchObject({ cardId: "made-2", method: "paint" });
  });
});

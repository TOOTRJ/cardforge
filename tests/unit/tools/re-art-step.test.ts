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
  bakedBack: vi.fn(),
  rows: { deck_cards: null as unknown, cards: null as unknown },
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: "deck_cards" | "cards") => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: m.rows[table], error: null }),
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
vi.mock("@/lib/ai/image-gen", () => ({ generateImageWithFallbacks: m.image }));
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
  m.link.mockResolvedValue({ ok: true });
  m.writePainted.mockResolvedValue(true);
  m.rows.deck_cards = { id: ENTRY, name: "Archivist", board: "main", card_id: "card-1", scryfall_id: null };
  m.rows.cards = OWN_CARD;
  m.bakedBack.mockReturnValue(false);
  m.image.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: "flux" });
  m.persist.mockResolvedValue({ ok: true, publicUrl: ART("ai-new.jpg") });
  m.update.mockResolvedValue({ ok: true, cardId: "card-1", slug: "archivist" });
  m.customize.mockResolvedValue({ ...STEP, status: "done", card_id: "made-1" });
  m.credited.mockImplementation(async (_u, _j, _amount, _reason, _step, body: () => Promise<JobStep>) => body());
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
    expect((await run(planOf())).status).toBe("failed");
    expect(m.credited).not.toHaveBeenCalled();
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
    await options.onSaved("made-1", { front: ART("ai-1.jpg"), back: null });
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ cardId: "made-1", styleVersion: 3, made: true, previousArtUrl: null });
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

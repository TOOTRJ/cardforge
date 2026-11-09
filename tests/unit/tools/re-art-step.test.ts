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
// and an emblem are never touched; a card in the style already is never
// painted (or charged) twice.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  styleAdmin: vi.fn(),
  paintedAdmin: vi.fn(),
  writePainted: vi.fn(),
  customize: vi.fn(),
  update: vi.fn(),
  credited: vi.fn(),
  image: vi.fn(),
  persist: vi.fn(),
  discard: vi.fn(),
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
  writePaintedCard: m.writePainted,
  reartBulkChoices: (style: { preset: string }, visibility: string) => ({ art: "ai", artStyle: style.preset, visibility }),
}));
vi.mock("@/lib/tools/bulk-customize/step", () => ({ customizeSourceStep: m.customize }));
vi.mock("@/lib/cards/actions", () => ({ updateCardAction: m.update }));
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
  art_url: ART("mine.png"),
  art_position: { x: 0.5, y: 0.5, zoom: 1.2 },
};

const run = (plan: unknown, step: JobStep = STEP) => runReartStep("u1", "job-1", plan, step, 0, DEPS);

beforeEach(() => {
  for (const fn of Object.values(m)) if (typeof fn === "function") (fn as ReturnType<typeof vi.fn>).mockReset();
  m.access.mockResolvedValue({ userId: "u1", via: "grant" });
  m.styleAdmin.mockResolvedValue(STYLE);
  m.paintedAdmin.mockResolvedValue(null);
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
  it("gets its art edited — the art and its fit alone — under the Re-art label, one credit", async () => {
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited.mock.calls[0][2]).toBe(1);
    expect(m.credited.mock.calls[0][3]).toBe("deck_reart_art");
    const [cardId, payload] = m.update.mock.calls[0];
    expect(cardId).toBe("card-1");
    expect(Object.keys(payload).sort()).toEqual(["art_position", "art_url"]);
    expect(payload.art_url).toBe(ART("ai-new.jpg"));
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
    });
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("a re-roll replaces Re-art's own picture (discarded) and keeps the maker's earlier art", async () => {
    m.rows.cards = { ...OWN_CARD, art_url: ART("ai-old.jpg") };
    m.paintedAdmin.mockResolvedValue({
      cardId: "card-1",
      styleVersion: 3,
      artUrl: ART("ai-old.jpg"),
      backArtUrl: null,
      made: false,
      previousArtUrl: ART("mine.png"),
      previousArtPosition: null,
      previousBackArtUrl: null,
      previousBackArtPosition: null,
      paintedAt: "",
    });
    await run(planOf("own", true));
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousArtUrl: ART("mine.png"), artUrl: ART("ai-new.jpg") });
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-old.jpg"));
    expect(m.discard).not.toHaveBeenCalledWith("u1", ART("mine.png"));
  });

  it("is never painted (or charged) twice: in the style already → done, no charge", async () => {
    m.paintedAdmin.mockResolvedValue({ cardId: "card-1", styleVersion: 3, artUrl: ART("ai-old.jpg"), made: false });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "done", card_id: "card-1" });
    expect(m.credited).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("a two-faced card paints both faces for two credits", async () => {
    m.bakedBack.mockReturnValue(true);
    m.rows.cards = { ...OWN_CARD, back_face: { title: "Back", card_type: "creature", art_url: ART("back.png") } };
    m.persist.mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-front.jpg") }).mockResolvedValueOnce({ ok: true, publicUrl: ART("ai-back.jpg") });
    await run(planOf());
    expect(m.credited.mock.calls[0][2]).toBe(2);
    const payload = m.update.mock.calls[0][1];
    expect(payload.back_face).toMatchObject({ title: "Back", art_url: ART("ai-back.jpg") });
    expect(m.writePainted.mock.calls[0][3]).toMatchObject({ previousBackArtUrl: ART("back.png") });
  });

  it("a refused edit discards the new picture and fails (the wrapper refunds)", async () => {
    m.update.mockResolvedValue({ ok: false, formError: "Nope." });
    const result = await run(planOf());
    expect(result).toMatchObject({ status: "failed", error: "Nope." });
    expect(m.discard).toHaveBeenCalledWith("u1", ART("ai-new.jpg"));
    expect(m.writePainted).not.toHaveBeenCalled();
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

  it("an entry another run already made is the own-card path (found in the style, no charge)", async () => {
    m.rows.deck_cards = { id: ENTRY, name: "Krenko", board: "commander", card_id: "card-1", scryfall_id: "sf-1" };
    m.paintedAdmin.mockResolvedValue({ cardId: "card-1", styleVersion: 3, artUrl: ART("ai-1.jpg"), made: true });
    const result = await run(planOf("printing"));
    expect(result.status).toBe("done");
    expect(m.customize).not.toHaveBeenCalled();
    expect(m.credited).not.toHaveBeenCalled();
  });
});

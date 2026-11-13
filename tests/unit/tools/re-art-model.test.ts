import { describe, expect, it } from "vitest";
import {
  REART_DEFAULT_VISIBILITY,
  REART_SAMPLE_MAX,
  classifyReartEntry,
  cleanReartTheme,
  reartArtIsOnCard,
  reartArtPrompt,
  reartCostDetail,
  reartCostLine,
  reartEntryState,
  reartRunSchema,
  reartStateIsSettled,
  reartStateLabel,
  reartStyleBlock,
  reartStyleProblem,
  sameReartStyle,
  scopeTakes,
  suggestReartSample,
  typeBucketOf,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's pure model (lib/tools/re-art/model.ts): ONE style block every
// picture shares, each card's own subject before it, what each entry of a
// deck becomes (another creator's card, an emblem and the maybeboard are
// never painted), the cost line said before anything is charged, and a
// varied sample with the commander first.
// ---------------------------------------------------------------------------

const ME = "u1";

describe("the style", () => {
  it("is a preset or the deck's own words — style first", () => {
    expect(reartStyleProblem({ preset: "surprise", theme: "" })).not.toBeNull();
    expect(reartStyleProblem({ preset: "surprise", theme: "  !! " })).not.toBeNull();
    expect(reartStyleProblem({ preset: "watercolor", theme: "" })).toBeNull();
    expect(reartStyleProblem({ preset: "surprise", theme: "sunken city" })).toBeNull();
  });

  it("one block names the preset's look, the deck's world and the one-set rule", () => {
    const block = reartStyleBlock({ preset: "watercolor", theme: "a drowned city, teal light" });
    expect(block).toContain("Rendered strictly in watercolor style.");
    expect(block).toContain("Art direction:");
    expect(block).toContain("The deck's world and look: a drowned city, teal light.");
    expect(block).toContain("one cohesive set");
  });

  it("cleans the maker's words (control and bidi characters, spacing, the limit)", () => {
    expect(cleanReartTheme("a‮ drowned\n\n city ")).toBe("a drowned city");
    expect(cleanReartTheme("x".repeat(400)).length).toBe(300);
  });

  it("compares styles as stored (an unknown preset reads as none)", () => {
    expect(sameReartStyle({ preset: "anime", theme: " a  b " }, { preset: "anime", theme: "a b" })).toBe(true);
    expect(sameReartStyle({ preset: "nope", theme: "x" }, { preset: "surprise", theme: "x" })).toBe(true);
    expect(sameReartStyle({ preset: "anime", theme: "a" }, { preset: "anime", theme: "b" })).toBe(false);
    expect(sameReartStyle(null, { preset: "anime", theme: "a" })).toBe(false);
  });
});

describe("one card's prompt", () => {
  const style = { preset: "storybook", theme: "a goblin warren at dusk" };

  it("puts the card's own subject before the shared block, and asks for no text", () => {
    const prompt = reartArtPrompt(
      { title: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", rulesText: "{T}: Create X 1/1 red Goblin creature tokens." },
      style,
    );
    expect(prompt.indexOf("Krenko, Mob Boss")).toBeLessThan(prompt.indexOf(reartStyleBlock(style)));
    expect(prompt).toContain("Legendary Creature — Goblin Warrior");
    expect(prompt).not.toContain("{T}");
    expect(prompt).toContain("NO text or lettering");
  });

  it("prefers the flavour's mood to the rules, and drops reminder text", () => {
    const withFlavor = reartArtPrompt({ title: "A", typeLine: null, rulesText: "Flying", flavorText: "The sky remembers." }, style);
    expect(withFlavor).toContain("Its mood: The sky remembers.");
    expect(withFlavor).not.toContain("Flying");
    const reminder = reartArtPrompt({ title: "B", typeLine: null, rulesText: "Ward {2} (Whenever this becomes the target…)" }, style);
    expect(reminder).not.toContain("Whenever");
  });

  it("every card of a deck shares the same style block", () => {
    const a = reartArtPrompt({ title: "Sol Ring", typeLine: "Artifact" }, style);
    const b = reartArtPrompt({ title: "Forest", typeLine: "Basic Land — Forest" }, style);
    const block = reartStyleBlock(style);
    expect(a).toContain(block);
    expect(b).toContain(block);
  });
});

describe("what each entry becomes", () => {
  const base = { board: "main", cardId: null, scryfallId: "824b2d73-2151-4e5e-9f05-8f63e2bdcaa9", card: null, ownerId: ME };

  it("a real card's entry is made the maker's own", () => {
    expect(classifyReartEntry(base).kind).toBe("printing");
  });

  it("the maker's own card gets new art; another creator's card never", () => {
    expect(classifyReartEntry({ ...base, cardId: "c1", card: { owner_id: ME, card_type: "creature" } }).kind).toBe("own");
    const other = classifyReartEntry({ ...base, cardId: "c2", card: { owner_id: "someone", card_type: "creature" } });
    expect(other).toMatchObject({ kind: "skip", reason: "other_creator" });
  });

  it("emblems (own or printed), the maybeboard, a gone card and a placeholder are left alone", () => {
    expect(classifyReartEntry({ ...base, cardId: "c3", card: { owner_id: ME, card_type: "emblem" } })).toMatchObject({ reason: "emblem" });
    expect(classifyReartEntry({ ...base, typeLine: "Emblem — Kaito" })).toMatchObject({ reason: "emblem" });
    expect(classifyReartEntry({ ...base, board: "maybe" })).toMatchObject({ reason: "maybeboard" });
    expect(classifyReartEntry({ ...base, cardId: "c4", card: null })).toMatchObject({ reason: "gone" });
    expect(classifyReartEntry({ ...base, scryfallId: null })).toMatchObject({ reason: "not_real" });
  });

  it("a scope takes only its kind", () => {
    expect(scopeTakes("all", "printing")).toBe(true);
    expect(scopeTakes("own", "printing")).toBe(false);
    expect(scopeTakes("printings", "own")).toBe(false);
    expect(scopeTakes("all", "skip")).toBe(false);
  });
});

describe("the cost line", () => {
  it("says cards, credits and slots left before anything is charged", () => {
    expect(reartCostLine({ cards: 64, makes: 40, credits: 66, slotsLeftAfter: 12 })).toBe("Re-arts 64 cards · 66 credits · 12 slots left");
    expect(reartCostLine({ cards: 1, makes: 0, credits: 1, slotsLeftAfter: null })).toBe("Re-arts 1 card · 1 credit");
    expect(reartCostLine({ cards: 3, makes: 3, credits: 3, slotsLeftAfter: -2 })).toContain("0 slots left");
    expect(reartCostDetail({ cards: 64, makes: 40, credits: 66, slotsLeftAfter: 12 })).toBe(
      "40 real cards become your own (40 slots) · 24 cards of yours get new art",
    );
  });
});

describe("the sample", () => {
  it("takes the commander first, then one of each kind of card", () => {
    const picked = suggestReartSample([
      { id: "a", board: "main", bucket: "creature", inStyle: false },
      { id: "b", board: "main", bucket: "creature", inStyle: false },
      { id: "c", board: "main", bucket: "land", inStyle: false },
      { id: "d", board: "commander", bucket: "creature", inStyle: false },
      { id: "e", board: "main", bucket: "spell", inStyle: false },
    ]);
    expect(picked).toEqual(["d", "e", "c"]);
    expect(picked.length).toBe(REART_SAMPLE_MAX);
  });

  it("leaves cards already in the style for last", () => {
    expect(
      suggestReartSample([
        { id: "a", board: "main", bucket: "creature", inStyle: true },
        { id: "b", board: "main", bucket: "creature", inStyle: false },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("buckets a card by its type words", () => {
    expect(typeBucketOf("Artifact Creature — Golem")).toBe("creature");
    expect(typeBucketOf("Basic Land — Forest")).toBe("land");
    expect(typeBucketOf("Instant")).toBe("spell");
    expect(typeBucketOf(null, "enchantment")).toBe("permanent");
  });
});

describe("a run's request", () => {
  it("takes a deck, a style or none, and up to the run's limit of named entries", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(reartRunSchema.safeParse({ deckId: id }).success).toBe(true);
    expect(reartRunSchema.safeParse({ deckId: id, style: { preset: "anime", theme: "x" }, entryIds: [id], sample: true }).success).toBe(true);
    expect(reartRunSchema.safeParse({ deckId: "nope" }).success).toBe(false);
    expect(reartRunSchema.safeParse({ deckId: id, style: { preset: "not-a-preset", theme: "" } }).success).toBe(false);
    expect(reartRunSchema.safeParse({ deckId: id, entryIds: [] }).success).toBe(false);
    expect(reartRunSchema.safeParse({ deckId: id, extra: 1 }).success).toBe(false);
  });

  // Owner 2026-11-10: a run turns up to 150 real cards into the maker's own
  // near-copies. Public by default put every one — samples included — in
  // the gallery, the hubs and the sitemap without anyone choosing that.
  it("makes the new cards PRIVATE unless the maker picks otherwise", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(REART_DEFAULT_VISIBILITY).toBe("private");
    expect(reartRunSchema.parse({ deckId: id }).visibility).toBe("private");
    expect(reartRunSchema.parse({ deckId: id, entryIds: [id], sample: true }).visibility).toBe("private");
    for (const visibility of ["public", "unlisted", "private"] as const) {
      expect(reartRunSchema.parse({ deckId: id, visibility }).visibility).toBe(visibility);
    }
  });
});

describe("a back face resent with new art", () => {
  it("replaces the picture, fit and credit, and keeps a null OUT of the back (its schema takes no null)", async () => {
    const { withBackArt } = await import("@/lib/tools/re-art/model");
    const back = { title: "B", card_type: "creature" as const, subtypes: [], art_url: "x", art_position: { x: 1 }, artist_credit: "AI" };
    const restored = withBackArt(back as never, null, null, null);
    expect(restored).toEqual({ title: "B", card_type: "creature", subtypes: [] });
    expect(withBackArt(back as never, "y", { x: 0.5 } as never, "Me")).toMatchObject({ art_url: "y", art_position: { x: 0.5 }, artist_credit: "Me" });
  });

  it("a sample names at most three cards", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(reartRunSchema.safeParse({ deckId: id, sample: true, entryIds: [id, id, id, id] }).success).toBe(false);
    expect(reartRunSchema.safeParse({ deckId: id, sample: true }).success).toBe(false);
  });
});

describe("where a card stands against the deck's style", () => {
  const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
  const painted = { styleVersion: 3, artUrl: ART("ai-1.jpg") };

  it("is in the style only while Re-art's picture is still on the card", () => {
    expect(reartEntryState({ painted, styleVersion: 3, cardArtUrl: ART("ai-1.jpg") })).toBe("in_style");
    // The maker changed its art in the editor, or a run of another deck
    // that holds the card repainted it: a record of a paint is not the paint.
    expect(reartEntryState({ painted, styleVersion: 3, cardArtUrl: ART("hand.png") })).toBe("changed");
    expect(reartEntryState({ painted, styleVersion: 3, cardArtUrl: ART("ai-other-deck.jpg") })).toBe("changed");
    expect(reartEntryState({ painted, styleVersion: 3, cardArtUrl: null })).toBe("changed");
  });

  it("a card given its own art back is kept; an older version is an earlier style; no record is never painted", () => {
    expect(reartEntryState({ painted: { styleVersion: 3, artUrl: null }, styleVersion: 3, cardArtUrl: ART("mine.png") })).toBe("kept");
    expect(reartEntryState({ painted, styleVersion: 4, cardArtUrl: ART("ai-1.jpg") })).toBe("earlier");
    expect(reartEntryState({ painted, styleVersion: null, cardArtUrl: ART("ai-1.jpg") })).toBe("earlier");
    expect(reartEntryState({ painted: undefined, styleVersion: 3, cardArtUrl: ART("mine.png") })).toBeNull();
    expect(reartEntryState({ painted: null, styleVersion: 3, cardArtUrl: null })).toBeNull();
  });

  it("a run over the deck leaves alone what is in the style or kept — and paints the rest", () => {
    expect(reartStateIsSettled("in_style")).toBe(true);
    expect(reartStateIsSettled("kept")).toBe(true);
    expect(reartStateIsSettled("changed")).toBe(false);
    expect(reartStateIsSettled("earlier")).toBe(false);
    expect(reartStateIsSettled(null)).toBe(false);
  });

  it("the picture on the card is Re-art's only when the two addresses are the same", () => {
    expect(reartArtIsOnCard(painted, ART("ai-1.jpg"))).toBe(true);
    expect(reartArtIsOnCard(painted, ART("ai-2.jpg"))).toBe(false);
    expect(reartArtIsOnCard({ artUrl: null }, null)).toBe(false);
    expect(reartArtIsOnCard(null, ART("ai-1.jpg"))).toBe(false);
    expect(reartArtIsOnCard(undefined, undefined)).toBe(false);
  });

  it("each state has its own words", () => {
    const label = (state: Parameters<typeof reartStateLabel>[0]["state"]) => reartStateLabel({ kind: "own", state, skipMessage: null });
    expect(label("in_style")).toBe("In this style");
    expect(label("kept")).toBe("Kept its own art");
    expect(label("changed")).toBe("Has other art now");
    expect(label("earlier")).toBe("Painted in an earlier style");
    expect(label(null)).toBe("Your card — not painted yet");
  });
});

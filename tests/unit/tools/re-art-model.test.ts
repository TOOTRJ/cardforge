import { describe, expect, it } from "vitest";
import {
  REART_CARD_WORDS_MAX,
  REART_CHANGED_COPY,
  REART_DEFAULT_VISIBILITY,
  REART_NO_FRAME_LINE,
  REART_PLACEHOLDERS,
  REART_PROMPT_MAX,
  REART_SAMPLE_MAX,
  classifyReartEntry,
  cleanReartCardWords,
  cleanReartPrompt,
  cleanReartTheme,
  normalizeReartStyle,
  reartArtIsOnCard,
  reartArtPrompt,
  reartCardFacts,
  reartCostDetail,
  reartCostLine,
  reartEntryState,
  reartPromptIsMakers,
  reartPromptNamesCard,
  reartRunSchema,
  reartStateCountsInStyle,
  reartStateIsSettled,
  reartStateLabel,
  reartStyleBlock,
  reartStyleProblem,
  reartStyleSchema,
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

  it("a run over the deck leaves a settled card as it is — in the style, kept, or showing other art now", () => {
    expect(reartStateIsSettled("in_style")).toBe(true);
    expect(reartStateIsSettled("kept")).toBe(true);
    // Someone's later choice stands (and nothing is charged for it): only a
    // re-roll paints it.
    expect(reartStateIsSettled("changed")).toBe(true);
    expect(reartStateIsSettled("earlier")).toBe(false);
    expect(reartStateIsSettled(null)).toBe(false);
    expect(REART_CHANGED_COPY).toMatch(/re-roll it/);
  });

  it("a card that shows other art now is never counted as in the deck's style", () => {
    expect(reartStateCountsInStyle("in_style")).toBe(true);
    expect(reartStateCountsInStyle("kept")).toBe(true);
    expect(reartStateCountsInStyle("changed")).toBe(false);
    expect(reartStateCountsInStyle("earlier")).toBe(false);
    expect(reartStateCountsInStyle(null)).toBe(false);
  });

  describe("what the studio says about one of the maker's cards", () => {
    const row = (over: Record<string, unknown> = {}) => ({
      styleVersion: 3,
      artUrl: ART("ai-1.jpg") as string | null,
      made: false,
      previousArtUrl: ART("mine.png") as string | null,
      ...over,
    });
    const facts = (over: Partial<Parameters<typeof reartCardFacts>[0]> = {}) =>
      reartCardFacts({ painted: row(), styleVersion: 3, cardArtUrl: ART("ai-1.jpg"), reartPictures: [ART("ai-1.jpg")], ...over });

    it("painted here and still showing it: in the style, its old art can be put back, a re-roll replaces Re-art's picture", () => {
      expect(facts()).toEqual({ state: "in_style", canRestore: true, artNow: "reart" });
    });

    it("\"Put the old art back\" is offered only while it can work", () => {
      // The action refuses a card Re-art made, one with no earlier art, and
      // one that shows other art now.
      expect(facts({ painted: row({ made: true, previousArtUrl: null }) }).canRestore).toBe(false);
      expect(facts({ painted: row({ previousArtUrl: null }) }).canRestore).toBe(false);
      expect(facts({ cardArtUrl: ART("hand.png"), reartPictures: [ART("ai-1.jpg")] })).toEqual({
        state: "changed",
        canRestore: false,
        artNow: "own",
      });
      expect(facts({ painted: null, cardArtUrl: ART("mine.png"), reartPictures: [] })).toEqual({ state: null, canRestore: false, artNow: "own" });
    });

    it("a picture ANOTHER deck's run painted is Re-art's too: painting here replaces it for good", () => {
      // This deck has no row (or an older one); the card shows deck B's picture.
      expect(facts({ painted: null, cardArtUrl: ART("ai-b.jpg"), reartPictures: [ART("ai-b.jpg")] })).toEqual({
        state: null,
        canRestore: false,
        artNow: "reart",
      });
      expect(facts({ cardArtUrl: ART("ai-b.jpg"), reartPictures: [ART("ai-1.jpg"), ART("ai-b.jpg")] })).toEqual({
        state: "changed",
        canRestore: false,
        artNow: "reart",
      });
    });

    it("a card with no art has nothing to put back", () => {
      expect(facts({ painted: null, cardArtUrl: null, reartPictures: [] })).toEqual({ state: null, canRestore: false, artNow: "none" });
    });

    it("this deck's own row is enough to know the picture is Re-art's — whatever the other read says", () => {
      // The read of the other decks came back empty, or failed: a re-roll of
      // an in-style card must still say its picture can't be brought back.
      expect(facts({ reartPictures: [] }).artNow).toBe("reart");
      expect(facts({ reartPictures: [], reartPicturesKnown: false }).artNow).toBe("reart");
    });

    it("when the other decks couldn't be asked, nothing is promised about a picture this deck didn't paint", () => {
      expect(facts({ painted: null, cardArtUrl: ART("mine.png"), reartPictures: [], reartPicturesKnown: false }).artNow).toBe("unknown");
      expect(facts({ cardArtUrl: ART("hand.png"), reartPictures: [], reartPicturesKnown: false }).artNow).toBe("unknown");
      // No art is no art either way.
      expect(facts({ painted: null, cardArtUrl: null, reartPictures: [], reartPicturesKnown: false }).artNow).toBe("none");
    });
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

describe("the maker's own prompts (migration 0209)", () => {
  const KRENKO = {
    title: "Krenko, Mob Boss",
    typeLine: "Legendary Creature — Goblin Warrior",
    rulesText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
    flavorText: "“He displays a negotiator's sense of fairness.”",
  };
  const RING = { title: "Sol Ring", typeLine: "Artifact", rulesText: "{T}: Add {C}{C}.", flavorText: null };
  const TEMPLATE = { preset: "watercolor", theme: "a drowned city, teal light" };
  const own = (prompt: string) => ({ ...TEMPLATE, mode: "custom" as const, prompt });

  describe("the deck's style", () => {
    it("a style saved before 0209 — or a run's plan from before it — is the template", () => {
      expect(normalizeReartStyle(TEMPLATE)).toEqual({ ...TEMPLATE, mode: "preset", prompt: "" });
      const parsed = reartStyleSchema.parse(TEMPLATE);
      expect(parsed).toEqual({ ...TEMPLATE, mode: "preset", prompt: "" });
      expect(reartStyleSchema.safeParse({ ...TEMPLATE, mode: "freehand" }).success).toBe(false);
      expect(reartStyleSchema.safeParse(own("x".repeat(REART_PROMPT_MAX * 2 + 1))).success).toBe(false);
    });

    it("the maker's prompt is stored clean and clipped to its limit", () => {
      expect(cleanReartPrompt("  An oil\n\npainting\u200b of   {card}.  ")).toBe("An oil painting of {card}.");
      expect(cleanReartPrompt("w".repeat(2000))).toHaveLength(REART_PROMPT_MAX);
      expect(normalizeReartStyle(own("  thick   paint ")).prompt).toBe("thick paint");
      expect(cleanReartCardWords("c".repeat(900))).toHaveLength(REART_CARD_WORDS_MAX);
      expect(cleanReartCardWords(null)).toBe("");
    });

    it("the same look is the same mode and what THAT mode paints with", () => {
      expect(sameReartStyle(own("thick paint"), own("thick paint"))).toBe(true);
      expect(sameReartStyle(own("thick paint"), own("thin washes"))).toBe(false);
      // Switching how the prompt is made is a new look, whatever the words.
      expect(sameReartStyle(TEMPLATE, own("thick paint"))).toBe(false);
      // What the OTHER mode holds is kept for a switch back and changes nothing.
      expect(sameReartStyle(own("thick paint"), { ...own("thick paint"), preset: "anime", theme: "elsewhere" })).toBe(true);
      expect(sameReartStyle(TEMPLATE, { ...TEMPLATE, prompt: "an old draft" })).toBe(true);
    });

    it("the maker's own prompt has to be written — braces alone are no words", () => {
      expect(reartStyleProblem(own(""))).not.toBeNull();
      expect(reartStyleProblem(own("{card}. {flavor}"))).not.toBeNull();
      expect(reartStyleProblem(own("{card}. Thick oil paint, candle light."))).toBeNull();
      // The template's own rule is as it was.
      expect(reartStyleProblem({ preset: "surprise", theme: "" })).not.toBeNull();
    });

    it("names the card or doesn't", () => {
      expect(reartPromptNamesCard("An oil painting of {card}")).toBe(true);
      expect(reartPromptNamesCard("An oil painting of {NAME}, a {Type}")).toBe(true);
      expect(reartPromptNamesCard("An oil painting of a storm")).toBe(false);
      expect(reartPromptNamesCard("An oil painting of {subject}")).toBe(false);
      expect(reartPromptNamesCard(null)).toBe(false);
      // Asked twice: the answer doesn't depend on the last one.
      expect(reartPromptNamesCard("{card}")).toBe(true);
      expect(reartPromptNamesCard("{card}")).toBe(true);
      expect(REART_PLACEHOLDERS.map((name) => name.token)).toEqual(["{card}", "{name}", "{type}", "{flavor}", "{rules}"]);
      for (const name of REART_PLACEHOLDERS) expect(reartPromptNamesCard(name.token)).toBe(true);
    });
  });

  describe("one picture's prompt", () => {
    it("the maker's own deck prompt REPLACES the template: its braces filled in, then the no-frame line", () => {
      const prompt = reartArtPrompt(KRENKO, own("An oil painting of {card}, candle-lit. Its mood: {flavor}"));
      expect(prompt).toBe(
        `An oil painting of "Krenko, Mob Boss", a Legendary Creature — Goblin Warrior, candle-lit. Its mood: “He displays a negotiator's sense of fairness.” ${REART_NO_FRAME_LINE}`,
      );
      // Nothing of the template: no "Trading-card illustration", no style block.
      expect(prompt).not.toMatch(/Trading-card illustration|Rendered strictly|cohesive set|drowned city/);
    });

    it("fills each name on its own, whatever its case, and cleans a card's text as the template does", () => {
      const prompt = reartArtPrompt(KRENKO, own("{Name} / {TYPE} / {rules} / {flavour}"));
      // Symbols are out of the card's own text, with the colon one leaves
      // behind ("{T}: Create…").
      expect(prompt).toBe(
        `Krenko, Mob Boss / Legendary Creature — Goblin Warrior / Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control / “He displays a negotiator's sense of fairness.” ${REART_NO_FRAME_LINE}`,
      );
      expect(prompt).not.toContain("{T}");
      // A brace name the tool doesn't know is the maker's own text.
      expect(reartArtPrompt(RING, own("{card} beside a {lamp}"))).toContain('"Sol Ring", an Artifact beside a {lamp}.');
    });

    it("a name the card has nothing for leaves no stray comma behind", () => {
      expect(reartArtPrompt(RING, own("A painting of {name}, {flavor}, in gold leaf."))).toBe(
        `A painting of Sol Ring, in gold leaf. ${REART_NO_FRAME_LINE}`,
      );
      expect(reartArtPrompt({ title: "", typeLine: null }, own("{card}: {type}"))).toBe(`"an unnamed card". ${REART_NO_FRAME_LINE}`);
    });

    it("a card's own words stand where {card} stands — or first, when the prompt has no {card}", () => {
      const words = { text: "A goblin chef juggling knives.", only: false };
      expect(reartArtPrompt(KRENKO, own("An oil painting of {card}, candle-lit"), words)).toBe(
        `An oil painting of A goblin chef juggling knives, candle-lit. ${REART_NO_FRAME_LINE}`,
      );
      expect(reartArtPrompt(KRENKO, own("Thick oil paint, candle light"), words)).toBe(
        `A goblin chef juggling knives. Thick oil paint, candle light. ${REART_NO_FRAME_LINE}`,
      );
      // {name} is still the card's name: only {card} is its subject.
      expect(reartArtPrompt(KRENKO, own("{card}, signed “{name}”"), words)).toContain("A goblin chef juggling knives, signed “Krenko, Mob Boss”");
    });

    it("in the template a card's own words replace its subject, and the deck's style block stays", () => {
      const prompt = reartArtPrompt(KRENKO, TEMPLATE, { text: "a goblin chef juggling knives", only: false });
      expect(prompt.startsWith("a goblin chef juggling knives. Rendered strictly in watercolor style.")).toBe(true);
      expect(prompt).toContain("a drowned city, teal light");
      expect(prompt).not.toMatch(/Trading-card illustration|Krenko|Its mood/);
      expect(prompt.endsWith(REART_NO_FRAME_LINE)).toBe(true);
    });

    it("“only these words” is the card's whole prompt, in either mode", () => {
      const words = { text: "A lone lighthouse in a storm, woodcut", only: true };
      const expected = `A lone lighthouse in a storm, woodcut. ${REART_NO_FRAME_LINE}`;
      expect(reartArtPrompt(KRENKO, TEMPLATE, words)).toBe(expected);
      expect(reartArtPrompt(KRENKO, own("An oil painting of {card}"), words)).toBe(expected);
      // No words: the switch means nothing.
      expect(reartArtPrompt(KRENKO, TEMPLATE, { text: "  ", only: true })).toBe(reartArtPrompt(KRENKO, TEMPLATE));
    });

    it("without words of its own a card's template prompt is exactly what it was", () => {
      expect(reartArtPrompt(KRENKO, TEMPLATE, null)).toBe(reartArtPrompt(KRENKO, TEMPLATE));
      const prompt = reartArtPrompt(KRENKO, TEMPLATE);
      expect(prompt.startsWith('Trading-card illustration of "Krenko, Mob Boss", a Legendary Creature — Goblin Warrior. Its mood:')).toBe(true);
      expect(prompt).toContain(reartStyleBlock(TEMPLATE));
      expect(prompt.endsWith(REART_NO_FRAME_LINE)).toBe(true);
    });

    it("every prompt ends with the no-frame line, whoever wrote the rest", () => {
      const words = { text: "a storm", only: false };
      for (const prompt of [
        reartArtPrompt(KRENKO, TEMPLATE),
        reartArtPrompt(KRENKO, TEMPLATE, words),
        reartArtPrompt(KRENKO, own("{card} in oils")),
        reartArtPrompt(KRENKO, own("{card} in oils"), { ...words, only: true }),
      ]) {
        expect(prompt.endsWith(REART_NO_FRAME_LINE)).toBe(true);
      }
    });

    it("a prompt is the maker's when they wrote the deck's, or the card has words", () => {
      expect(reartPromptIsMakers(TEMPLATE)).toBe(false);
      expect(reartPromptIsMakers(TEMPLATE, { text: "  ", only: true })).toBe(false);
      expect(reartPromptIsMakers(TEMPLATE, { text: "a storm", only: false })).toBe(true);
      expect(reartPromptIsMakers(own("{card} in oils"))).toBe(true);
    });
  });
});

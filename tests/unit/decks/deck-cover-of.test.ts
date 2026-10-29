import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DECK_COVERS,
  deckCoverColors,
  deckCoverIdentity,
  deckCoverOf,
  defaultDeckCoverFor,
  isDefaultDeckCover,
} from "@/lib/decks/cover";
import { BRAND } from "@/lib/brand/constants";

// ---------------------------------------------------------------------------
// TODO DK6.1 / DK6.2: a deck's cover is its upload or one of 16 built-in
// backgrounds picked by its colours and a stable hash of its id — ONE
// answer (deckCoverOf) for the page, the tiles, the share image and the
// export. Pure; the storage host comes from the env, as on the site.
// ---------------------------------------------------------------------------

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DECK = "33333333-3333-4333-8333-333333333333";
const upload = (owner: string, bucket = "set-covers") => `${HOST}/storage/v1/object/public/${bucket}/${owner}/cover.webp`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const deck = (cover_url: string | null, extra: Record<string, unknown> = {}) => ({
  id: DECK,
  owner_id: OWNER,
  cover_url,
  ...extra,
});

describe("the default set (DK6.1)", () => {
  it("is sixteen paths: two per colour identity, two neutrals", () => {
    expect(DEFAULT_DECK_COVERS).toHaveLength(16);
    expect(new Set(DEFAULT_DECK_COVERS).size).toBe(16);
    for (const identity of ["white", "blue", "black", "red", "green", "multicolor", "colorless", "neutral"]) {
      expect(DEFAULT_DECK_COVERS.filter((p) => p.startsWith(`/defaults/deck-covers/${identity}-`))).toHaveLength(2);
    }
  });

  it("every path is a committed 2400 × 1350 WebP under the size budget, and nothing else is in the folder", async () => {
    const dir = path.join(process.cwd(), "public/defaults/deck-covers");
    const files = readdirSync(dir).sort();
    expect(files).toEqual(DEFAULT_DECK_COVERS.map((p) => path.basename(p)).sort());
    for (const cover of DEFAULT_DECK_COVERS) {
      const file = path.join(process.cwd(), "public", cover);
      expect(existsSync(file), cover).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.byteLength, cover).toBeLessThanOrEqual(250 * 1024);
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height], cover).toEqual(["webp", 2400, 1350]);
    }
  });

  it("the generator's brand anchors are lib/brand's", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts/build-deck-covers.mjs"), "utf8");
    const anchor = (name: string) => new RegExp(`const ${name} = "(#[0-9a-f]{6})"`).exec(script)?.[1];
    expect(anchor("NAVY")).toBe(BRAND.navy);
    expect(anchor("SURFACE")).toBe(BRAND.surface);
    expect(anchor("PURPLE")).toBe(BRAND.purple);
    expect(anchor("PURPLE_DEEP")).toBe(BRAND.purpleDeep);
    expect(anchor("GOLD")).toBe(BRAND.gold);
    expect(anchor("GOLD_LIGHT")).toBe(BRAND.goldLight);
  });
});

describe("isDefaultDeckCover — only the list, never a lookalike", () => {
  it.each(DEFAULT_DECK_COVERS)("accepts %s", (cover) => {
    expect(isDefaultDeckCover(cover)).toBe(true);
  });

  it.each([
    "/defaults/deck-covers/red-3.webp",
    "/defaults/deck-covers/red-0.webp",
    "/defaults/deck-covers/purple-1.webp",
    "/defaults/deck-covers/red-1.webp?x=1",
    "/defaults/deck-covers/red-1.png",
    "/defaults/deck-covers/../avatars/avatar-01.webp",
    "/defaults/avatars/avatar-01.webp",
    "defaults/deck-covers/red-1.webp",
    "https://pipglyph.com/defaults/deck-covers/red-1.webp",
    "https://evil.example/defaults/deck-covers/red-1.webp",
    "",
    null,
    undefined,
  ])("refuses %s", (value) => {
    expect(isDefaultDeckCover(value as string | null | undefined)).toBe(false);
  });
});

describe("deckCoverIdentity — colour letters → the pair", () => {
  it.each([
    [["W"], "white"],
    [["U"], "blue"],
    [["B"], "black"],
    [["R"], "red"],
    [["G"], "green"],
    [["R", "G"], "multicolor"],
    [["W", "U", "B", "R", "G"], "multicolor"],
    [["M"], "multicolor"],
    [["G", "M"], "multicolor"],
    [[], "colorless"],
    [null, "neutral"],
    [undefined, "neutral"],
  ] as const)("%j → %s", (colors, identity) => {
    expect(deckCoverIdentity(colors as readonly string[] | null | undefined)).toBe(identity);
  });

  it("ignores letters it doesn't know (a stray C, a typo) — they are no colour", () => {
    expect(deckCoverIdentity(["C"])).toBe("colorless");
    expect(deckCoverIdentity(["R", "C", "x"])).toBe("red");
  });
});

describe("defaultDeckCoverFor — stable", () => {
  it("is the same path every call, inside the identity's pair", () => {
    const first = defaultDeckCoverFor(DECK, ["U"]);
    for (let i = 0; i < 5; i += 1) expect(defaultDeckCoverFor(DECK, ["U"])).toBe(first);
    expect(first).toMatch(/^\/defaults\/deck-covers\/blue-[12]\.webp$/);
  });

  it("spreads decks of one colour over both of its pictures", () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => defaultDeckCoverFor(`deck-${i}-${"x".repeat(i % 7)}`, ["R"])),
    );
    expect(picks).toEqual(new Set(["/defaults/deck-covers/red-1.webp", "/defaults/deck-covers/red-2.webp"]));
  });

  it("the colour order never changes the pick", () => {
    expect(defaultDeckCoverFor(DECK, ["G", "W"])).toBe(defaultDeckCoverFor(DECK, ["W", "G"]));
  });
});

describe("deckCoverOf", () => {
  it("draws the owner's own upload, at its focal point", () => {
    const cover = deckCoverOf(deck(upload(OWNER), { cover_position: { focalX: 0.25, focalY: 0.8 } }), ["R"]);
    expect(cover).toEqual({ src: upload(OWNER), kind: "upload", objectPosition: "25% 80%" });
  });

  it("an old AI cover in card-art is the owner's too", () => {
    expect(deckCoverOf(deck(upload(OWNER, "card-art")), null).kind).toBe("upload");
  });

  it.each([
    ["another user's object", upload(OTHER)],
    ["an outside host", "https://evil.example/cover.png"],
    ["a profile bucket", upload(OWNER, "profile-media")],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("never draws %s — the default instead", (_, url) => {
    const cover = deckCoverOf(deck(url), ["B"]);
    expect(cover.kind).toBe("default");
    expect(cover.src).toBe(defaultDeckCoverFor(DECK, ["B"]));
  });

  it("no cover: the default its colours pick, centred", () => {
    expect(deckCoverOf(deck(null), ["G"])).toEqual({
      src: defaultDeckCoverFor(DECK, ["G"]),
      kind: "default",
      objectPosition: undefined,
    });
    expect(deckCoverOf(deck(null), null).src).toMatch(/\/neutral-[12]\.webp$/);
  });

  it("a stored built-in path (the shuffle seam) is drawn only when it is on the list", () => {
    expect(deckCoverOf(deck("/defaults/deck-covers/gold-1.webp"), ["U"]).src).toBe(defaultDeckCoverFor(DECK, ["U"]));
    expect(deckCoverOf(deck("/defaults/deck-covers/red-2.webp"), ["U"])).toEqual({
      src: "/defaults/deck-covers/red-2.webp",
      kind: "default",
      objectPosition: undefined,
    });
  });
});

describe("deckCoverColors — from rows every viewer can read", () => {
  const entry = (board: string, extra: Record<string, unknown> = {}) => ({
    board,
    color_identity: [] as string[],
    scryfall_id: null as string | null,
    card_id: null as string | null,
    ...extra,
  });
  const printing = (board: string, colors: string[]) => ({
    entry: entry(board, { scryfall_id: `sf-${colors.join("")}`, color_identity: colors }),
    card: null,
  });
  const custom = (board: string, words: string[], visibility = "public") => ({
    entry: entry(board, { card_id: `card-${words.join("")}` }),
    card: { color_identity: words, visibility },
  });

  it("a commander deck is its commanders' colours, whatever the 99 hold", () => {
    expect(
      deckCoverColors([printing("commander", ["R"]), printing("main", ["U"]), printing("main", ["G"])]),
    ).toEqual(["R"]);
    expect(deckCoverColors([printing("commander", ["W"]), printing("commander", ["B"])])?.sort()).toEqual(["B", "W"]);
  });

  it("no commander: the union of the playable boards — never the maybeboard", () => {
    expect(deckCoverColors([printing("main", ["U"]), printing("side", ["R"]), printing("maybe", ["G"])])?.sort()).toEqual([
      "R",
      "U",
    ]);
  });

  it("a custom card counts by its colours — unless it is private (the owner and a visitor agree)", () => {
    expect(deckCoverColors([custom("commander", ["black", "green"])])?.sort()).toEqual(["B", "G"]);
    // The owner reads the private card; a visitor reads null. Both: unknown.
    expect(deckCoverColors([custom("commander", ["black"], "private")])).toBeNull();
    expect(deckCoverColors([{ entry: entry("commander", { card_id: "gone" }), card: null }])).toBeNull();
  });

  it("an unknown commander falls back to the rest of the deck", () => {
    expect(deckCoverColors([custom("commander", ["red"], "private"), printing("main", ["G"])])).toEqual(["G"]);
  });

  it("a multicolour custom card without colours is gold", () => {
    expect(deckCoverIdentity(deckCoverColors([custom("main", ["multicolor"])]))).toBe("multicolor");
  });

  it("a colourless printing is colourless; a placeholder or an empty deck is unknown", () => {
    expect(deckCoverColors([printing("main", [])])).toEqual([]);
    expect(deckCoverColors([{ entry: entry("main"), card: null }])).toBeNull();
    expect(deckCoverColors([])).toBeNull();
  });

  it("an entry's own letters win over its linked card's words", () => {
    expect(
      deckCoverColors([{ entry: entry("main", { card_id: "c", color_identity: ["U"] }), card: { color_identity: ["red"], visibility: "public" } }]),
    ).toEqual(["U"]);
  });
});

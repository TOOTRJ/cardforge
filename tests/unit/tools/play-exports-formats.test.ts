import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { buildCardsExport, buildDeckExport } from "@/lib/tools/play-exports/build";
import {
  buildCockatrice,
  cockatriceManaCost,
  cockatricePicturePath,
  cockatriceSetCode,
  cockatriceSimpleName,
  tableRowOf,
} from "@/lib/tools/play-exports/cockatrice";
import { buildDraftmancer } from "@/lib/tools/play-exports/draftmancer";
import { buildPlayDownload, sameOriginPicture, type PlayFetch } from "@/lib/tools/play-exports/files";
import { buildTts, realCardImage } from "@/lib/tools/play-exports/tts";
import { mainTypeOf, splitTypes } from "@/lib/tools/play-exports/card-words";
import { BASE_URL, CARD_BACK, CTX, OWNER, bake, cardId, cardRow, item } from "./play-exports-fixtures";

// ---------------------------------------------------------------------------
// The three play clients' files (lib/tools/play-exports): Cockatrice's card
// database v4 + .cod (the shapes of Cockatrice 3.1.2's cards.xsd / deck.xsd
// and Oracle's writer), Draftmancer's custom card list (cubeformat.html) and
// Tabletop Simulator's saved object — one real fixture deck through each.
// ---------------------------------------------------------------------------

const PRINTING = "44444444-4444-4444-8444-444444444444";
const TODAY = "2026-11-08";

function fixtureDeck() {
  const wolfId = cardId();
  const wolf = cardRow({
    id: wolfId,
    title: "Ember Wolf",
    frame_style: { template: "m15dfcfront" },
    back_face: { title: "Ash Wolf", card_type: "creature", subtypes: ["Wolf"], power: "3", toughness: "2", rules_text: "Trample", frame_style: { template: "m15dfcback" } },
    rendered_back_image_url: bake(OWNER, wolfId, `${wolfId}.back.png`),
    rendered_back_thumb_url: bake(OWNER, wolfId, `${wolfId}.back.thumb.webp`),
  });
  const walker = cardRow({ title: "Sela, Ash & Ember", card_type: "planeswalker", supertype: "Legendary", subtypes: ["Sela"], cost: "{2}{R/G}{R/G}", power: null, toughness: null, loyalty: "4", rules_text: "+1: Draw a card.", rarity: "mythic" });
  const secret = cardRow({ title: "Secret <Plan>", visibility: "private", card_type: "instant", subtypes: [], power: null, toughness: null, cost: "{U}", rules_text: "Counter target spell." });
  const token = cardRow({ title: "Wolf", card_type: "token", supertype: "Creature", subtypes: ["Wolf"], cost: null, rarity: "common" });
  return buildDeckExport(
    { title: "Wolf Pack", fileStem: "wolf-pack" },
    [
      item({ name: "Sela, Ash & Ember", board: "commander" }, walker),
      item({ name: "Ember Wolf", quantity: 4 }, wolf),
      item({ name: "Secret <Plan>", quantity: 2 }, secret),
      item({ name: "Wolf", quantity: 3 }, token),
      item({ name: "Forest", quantity: 10, scryfall_id: PRINTING, image_url: "https://cards.scryfall.io/normal/front/a/b/ab.jpg?1" }),
      item({ name: "Fire // Ice", board: "side", scryfall_id: PRINTING }),
    ],
    CTX,
  );
}

describe("card words", () => {
  it("splits a type line and finds its main type", () => {
    expect(splitTypes("Legendary Creature — Elf Druid")).toEqual({ types: "Legendary Creature", subtypes: ["Elf", "Druid"] });
    expect(splitTypes("Instant")).toEqual({ types: "Instant", subtypes: [] });
    expect(mainTypeOf("Artifact Creature — Golem")).toBe("Creature");
    expect(mainTypeOf("Enchantment Land — Urza's Saga")).toBe("Land");
    expect(mainTypeOf("Token Creature — Wolf")).toBe("Creature");
    expect(mainTypeOf("Kindred Instant — Elf")).toBe("Instant");
  });
});

describe("Cockatrice", () => {
  it("writes Oracle's mana cost notation", () => {
    expect(cockatriceManaCost("{1}{G}")).toBe("1G");
    expect(cockatriceManaCost("{2}{W/U}{G/P}{X}")).toBe("2{W/U}{G/P}X");
    expect(cockatriceManaCost(null)).toBe("");
  });

  it("names pictures the way its local picture loader looks them up", () => {
    // " // " goes entirely (card_info.cpp), so "Fire // Ice" is "FireIce".
    expect(cockatriceSimpleName('Ash: "Wolf"? // Ember')).toBe("Ash WolfEmber");
    expect(cockatriceSimpleName("Wear/Tear")).toBe("Wear Tear");
    expect(cockatricePicturePath("Ember Wolf", "PGABCD")).toBe("pictures/PGABCD/Ember Wolf_PGABCD.jpg");
    expect(cockatriceSetCode("wolf-pack")).toMatch(/^PG[A-Z]{4}$/);
    expect(cockatriceSetCode("wolf-pack")).toBe(cockatriceSetCode("wolf-pack"));
    expect(tableRowOf("Land")).toBe(0);
    expect(tableRowOf("Creature")).toBe(2);
    expect(tableRowOf("Sorcery")).toBe(3);
    expect(tableRowOf("Artifact")).toBe(1);
  });

  it("writes a v4 database and a .cod of the deck", () => {
    const exp = fixtureDeck();
    const files = buildCockatrice(exp, { today: TODAY });
    const { xml, cod } = files;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<cockatrice_carddatabase version="4">')).toBe(true);
    expect(xml).toContain(`<name>${files.setCode}</name>`);
    expect(xml).toContain("<settype>Custom</settype>");
    // The double-faced card: two cards, front and back, related by transform.
    expect(xml).toContain("<name>Ember Wolf</name>");
    expect(xml).toContain("<side>front</side>");
    expect(xml).toContain('<related attach="transform">Ash Wolf</related>');
    expect(xml).toContain("<name>Ash Wolf</name>");
    expect(xml).toContain("<side>back</side>");
    expect(xml).toContain('<related attach="transform">Ember Wolf</related>');
    // The walker: hybrid cost kept in braces, its loyalty, its colours.
    expect(xml).toContain("<manacost>2{R/G}{R/G}</manacost>");
    expect(xml).toContain("<loyalty>4</loyalty>");
    expect(xml).toContain("<colors>RG</colors>");
    expect(xml).toContain("<name>Sela, Ash &amp; Ember</name>");
    // The private card: escaped, and no picture URL.
    expect(xml).toContain("<name>Secret &lt;Plan&gt;</name>");
    const secretBlock = xml.slice(xml.indexOf("Secret &lt;Plan&gt;"));
    expect(secretBlock.slice(0, secretBlock.indexOf("</card>"))).not.toContain("picurl");
    // The token.
    expect(xml).toContain("<token>1</token>");
    // A public card's picture URL is its stored bake.
    expect(xml).toContain(`picurl="${BASE_URL}/render-cdn/${OWNER}/`);

    expect(cod).toContain('<cockatrice_deck version="1">');
    expect(cod).toContain("<deckname>Wolf Pack</deckname>");
    const main = cod!.slice(cod!.indexOf('<zone name="main">'), cod!.indexOf('<zone name="side">'));
    expect(main).toContain('<card number="1" name="Sela, Ash &amp; Ember"/>');
    expect(main).toContain('<card number="4" name="Ember Wolf"/>');
    expect(main).toContain('<card number="10" name="Forest"/>');
    expect(cod).toContain('<zone name="side">\n    <card number="1" name="Fire // Ice"/>');
    expect(cod).toContain('<zone name="tokens">\n    <card number="3" name="Wolf"/>');
  });

  it("asks for each pictured face's thumbnail, and none for a private card", () => {
    const files = buildCockatrice(fixtureDeck(), { today: TODAY });
    const paths = files.pictures.map((picture) => picture.path);
    expect(paths).toContain(`pictures/${files.setCode}/Ember Wolf_${files.setCode}.jpg`);
    expect(paths).toContain(`pictures/${files.setCode}/Ash Wolf_${files.setCode}.jpg`);
    expect(paths.some((path) => path.includes("Secret"))).toBe(false);
    expect(files.pictures.every((picture) => picture.url.includes(".thumb.webp"))).toBe(true);
  });

  it("writes no deck file for a selection", () => {
    const files = buildCockatrice(buildCardsExport([cardRow()], CTX), { today: TODAY });
    expect(files.cod).toBeNull();
    expect(files.readme).not.toContain(".cod");
  });

  it("merges a one-picture two-part card into one card, as Oracle does", () => {
    const split = cardRow({
      title: "Fire",
      cost: "{1}{R}",
      card_type: "instant",
      subtypes: [],
      power: null,
      toughness: null,
      rules_text: "Fire deals 2 damage divided as you choose.",
      frame_style: { template: "split" },
      back_face: { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent." },
    });
    const exp = buildCardsExport([split], CTX);
    expect(exp.cards[0].layout).toBe("split");
    const { xml } = buildCockatrice(exp, { today: TODAY });
    expect(xml).toContain("<name>Fire // Ice</name>");
    expect(xml).toContain("<manacost>1R // 1U</manacost>");
    expect(xml).toContain("Tap target permanent.");
  });
});

describe("Draftmancer", () => {
  it("writes [Settings], [CustomCards] and a pool sheet", () => {
    const { text, unpictured } = buildDraftmancer(fixtureDeck());
    const sections = text.split("\n").filter((line) => /^\[.*\]$/.test(line));
    expect(sections).toEqual(["[Settings]", "[CustomCards]", "[MainSlot]"]);
    const settings = JSON.parse(text.split("[Settings]\n")[1].split("\n")[0]);
    expect(settings).toEqual({ name: "Wolf Pack" });
    const custom = JSON.parse(text.slice(text.indexOf("[CustomCards]\n") + 14, text.indexOf("\n[MainSlot]")));
    expect(custom).toHaveLength(4);
    const wolf = custom.find((card: { name: string }) => card.name === "Ember Wolf");
    expect(wolf).toMatchObject({ mana_cost: "{1}{R}", type: "Creature", subtypes: ["Wolf"], rarity: "uncommon", power: "2", toughness: "1", colors: ["R"], set: "custom" });
    expect(wolf.image).toContain(".thumb.webp");
    expect(wolf.back).toMatchObject({ name: "Ash Wolf", type: "Creature", subtypes: ["Wolf"], power: "3", toughness: "2" });
    expect(wolf.backs).toBeUndefined();
    const walker = custom.find((card: { name: string }) => card.name === "Sela, Ash & Ember");
    expect(walker).toMatchObject({ type: "Legendary Planeswalker", loyalty: "4", rarity: "mythic" });
    const secret = custom.find((card: { name: string }) => card.name === "Secret <Plan>");
    expect(secret.image).toBeUndefined();
    expect(unpictured).toBe(1);

    const pool = text.slice(text.indexOf("[MainSlot]\n") + 11).trim().split("\n");
    const wolfNumber = custom.indexOf(wolf) + 1;
    expect(pool).toContain(`4 Ember Wolf (custom) ${wolfNumber}`);
    expect(pool).toContain("10 Forest");
    expect(pool).toContain("1 Fire // Ice");
  });
});

describe("Tabletop Simulator", () => {
  it("writes one pile per board, a picture per card, our own card back", () => {
    const tts = buildTts(fixtureDeck());
    const save = JSON.parse(tts.json);
    const [commander, deck, side] = save.ObjectStates;
    // The commander alone: a lone card, face up.
    expect(commander).toMatchObject({ Name: "Card", Nickname: "Sela, Ash & Ember" });
    expect(commander.Transform.rotZ).toBe(0);
    expect(deck.Name).toBe("DeckCustom");
    // 4 wolves + 3 tokens + 10 Forests; the 2 private cards left out.
    expect(deck.ContainedObjects).toHaveLength(17);
    expect(deck.DeckIDs).toEqual(deck.ContainedObjects.map((card: { CardID: number }) => card.CardID));
    expect(tts.leftOut).toBe(2);
    expect(tts.leftOutNames).toEqual(["Secret <Plan>"]);
    for (const card of deck.ContainedObjects) {
      const key = String(card.CardID / 100);
      expect(card.CustomDeck[key]).toMatchObject({ BackURL: CARD_BACK, NumWidth: 1, NumHeight: 1 });
      expect(deck.CustomDeck[key].FaceURL).toBe(card.CustomDeck[key].FaceURL);
    }
    // Copies share one picture.
    const wolves = deck.ContainedObjects.filter((card: { Nickname: string }) => card.Nickname === "Ember Wolf");
    expect(new Set(wolves.map((card: { CardID: number }) => card.CardID)).size).toBe(1);
    // The double-faced card's back is its second state.
    expect(wolves[0].States["2"]).toMatchObject({ Name: "Card", Nickname: "Ash Wolf" });
    expect(Object.values(wolves[0].States["2"].CustomDeck)[0]).toMatchObject({ FaceURL: expect.stringContaining(".back.png") });
    // A real card: the printing's picture at Scryfall's large size.
    const forest = deck.ContainedObjects.find((card: { Nickname: string }) => card.Nickname === "Forest");
    expect(Object.values(forest.CustomDeck)[0]).toMatchObject({ FaceURL: "https://cards.scryfall.io/large/front/a/b/ab.jpg?1" });
    // The sideboard of one: a lone card, its name's picture by Scryfall's redirect.
    expect(side).toMatchObject({ Name: "Card", Nickname: "Fire // Ice" });
    expect(Object.values(side.CustomDeck)[0]).toMatchObject({
      FaceURL: "https://api.scryfall.com/cards/named?format=image&version=large&exact=Fire%20%2F%2F%20Ice",
    });
    // Nothing points at a private card or a print render.
    expect(tts.json).not.toContain("Secret");
    expect(tts.json).not.toContain("/api/cards/");
  });

  it("asks Scryfall by name when the entry has no picture", () => {
    expect(realCardImage({ kind: "real", board: "main", quantity: 1, name: "Sol Ring", setCode: null, collectorNumber: null, image: null })).toBe(
      "https://api.scryfall.com/cards/named?format=image&version=large&exact=Sol%20Ring",
    );
  });
});

describe("buildPlayDownload", () => {
  it("zips the Cockatrice set with its pictures as JPEGs, from this site", async () => {
    const exp = fixtureDeck();
    const fetched: string[] = [];
    const fetchImpl: PlayFetch = vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: !url.includes("Ash"), blob: async () => new Blob(["webp"]) };
    });
    const progress: Array<[number, number]> = [];
    const download = await buildPlayDownload(exp, "cockatrice", {
      fetchImpl,
      toJpeg: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
      today: TODAY,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(download.filename).toBe("wolf-pack-cockatrice.zip");
    expect(fetched.every((url) => url.startsWith("/render-cdn/"))).toBe(true);
    expect(progress.at(-1)).toEqual([fetched.length, fetched.length]);
    const zip = await JSZip.loadAsync(await download.blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toContain("wolf-pack/wolf-pack.xml");
    expect(names).toContain("wolf-pack/wolf-pack.cod");
    expect(names).toContain("wolf-pack/HOW-TO-IMPORT.txt");
    expect(names.some((name) => name.endsWith("Ember Wolf_" + names.find((n) => n.includes("pictures/PG"))!.split("/")[2] + ".jpg"))).toBe(true);
    expect(download.summary).toMatchObject({ target: "cockatrice", customCards: 4, realCards: 11, unpictured: [{ name: "Secret <Plan>", reason: "private" }], hiddenEntries: 0 });
  });

  it("counts a picture that couldn't be fetched, never failing the file", async () => {
    const download = await buildPlayDownload(fixtureDeck(), "cockatrice", {
      fetchImpl: async () => ({ ok: false, blob: async () => new Blob([]) }),
      toJpeg: async (blob) => blob,
      today: TODAY,
    });
    expect(download.summary.picturesFailed).toBeGreaterThan(0);
  });

  it("writes Draftmancer's .txt and TTS's .json with no fetches", async () => {
    const fetchImpl = vi.fn();
    const deps = { fetchImpl, toJpeg: async (blob: Blob) => blob, today: TODAY };
    const dm = await buildPlayDownload(fixtureDeck(), "draftmancer", deps);
    expect(dm.filename).toBe("wolf-pack-draftmancer.txt");
    const tts = await buildPlayDownload(fixtureDeck(), "tts", deps);
    expect(tts.filename).toBe("wolf-pack-tts.json");
    expect(tts.summary.leftOutCards).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes an absolute /render-cdn URL same-origin and leaves others", () => {
    expect(sameOriginPicture(`${BASE_URL}/render-cdn/a/b.png?v=1`)).toBe("/render-cdn/a/b.png?v=1");
    expect(sameOriginPicture("https://cards.scryfall.io/x.jpg")).toBe("https://cards.scryfall.io/x.jpg");
  });
});

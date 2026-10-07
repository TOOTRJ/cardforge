import { describe, expect, it } from "vitest";
import censusData from "./fixtures/borderless-land-census.json";
import { importedAnatomy, pairColorIdentity } from "@/lib/cards/anatomy";
import { TWO_COLOR_PAIRS, frameComboKey, type TwoColorPair } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  BORDERLESS_LAND_DARK_PINS,
  BORDERLESS_LAND_DARK_TYPE_BAR_PINS,
  BORDERLESS_LAND_SHADOW_BOX_PINS,
  BORDERLESS_LAND_SHORT_BOX_PINS,
  landFrameColorRule,
} from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch, printingFacts } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// TODO 4.56's census, held (the skeptic pass, 2026-10-07): the two-colour
// gap on the borderless land is closed, so a two-colour printing the frame
// does NOT draw is `nearest` only because a hand-kept pin list names it —
// and nothing held those lists: taking Marvel's five MSH lands and the five
// SOS lands off BORDERLESS_LAND_SHADOW_BOX_PINS (ten printings) passed every
// test, each of them back to `exact` on a frame that tints a box they print
// see-through.
//
// The fixture is Scryfall's answer on 2026-10-07 to `border:borderless
// t:land -t:basic game:paper` (702 printings), trimmed to the fields the
// registry and the importer read: all 192 two-colour printings on the
// borderless land's rule, and the 46 other printings a pin list names. A
// printing is its key — set and collector number; its Oracle text and its
// name are kept only where a rule reads them (the fetch lands' two basic
// types, the one-basic-land test; LAND_FRAME_OVERRIDES, by name), and
// every other printing is given its key for a name (`cardOf`). Each
// carries the LOOK it prints, read by eye on its scan — the 192 by the
// builder and again by the skeptic (title bar, type bar and box side by
// side), the others by 4.34's two skeptic passes:
//   tinted            the frame's own look — grey bars, the pinline and a
//                     flat tinted box split between the two colours
//   short-box         the type bar at ~70 %H (4.37)
//   dark-type-and-box the spells' dark type bar and box
//   dark-type-bar     a dark type bar alone over the tinted box
//   shadow-box        2025's see-through box with a shadow behind the text
//   crown / nickname  a legendary crown or a nickname bar the frame lacks
// Every printing must resolve as its look says, every pin must be a
// printing here (so each exists on Scryfall under that set and number), and
// a pinned look here must be on its list. Tests never call Scryfall.
//
// Pinning a new printing: add it to its list AND here, as a row like its
// neighbours' — Scryfall's card object (api.scryfall.com/cards/<set>/<number>)
// cut to these fields, with the look read on its scan and `two` = two
// colours by the land rule (printingFacts).
// ---------------------------------------------------------------------------

type Look = "tinted" | "short-box" | "dark-type-and-box" | "dark-type-bar" | "shadow-box" | "crown" | "nickname";
type Entry = { look: Look; two: boolean } & Record<string, unknown>;
const census = (censusData as unknown as { printings: Record<string, Entry> }).printings;
const keys = Object.keys(census);
const cardOf = (key: string) => {
  const { look, two, ...printing } = census[key]!;
  void look;
  void two;
  return scryfallCardSchema.parse({ name: key, ...printing });
};
const withLook = (look: Look, two?: boolean) => keys.filter((key) => census[key]!.look === look && (two === undefined || census[key]!.two === two));
const pinIds = (pins: Readonly<Record<string, readonly string[]>>) =>
  Object.entries(pins).flatMap(([set, numbers]) => numbers.map((number) => `${set}-${number}`));

const PIN_LISTS: Readonly<Record<Exclude<Look, "tinted" | "crown" | "nickname">, Readonly<Record<string, readonly string[]>>>> = {
  "dark-type-and-box": BORDERLESS_LAND_DARK_PINS,
  "dark-type-bar": BORDERLESS_LAND_DARK_TYPE_BAR_PINS,
  "short-box": BORDERLESS_LAND_SHORT_BOX_PINS,
  "shadow-box": BORDERLESS_LAND_SHADOW_BOX_PINS,
};

describe("the borderless land census (TODO 4.56): what each printing prints, and what the registry answers", () => {
  it("is the 192 two-colour printings on the frame's rule and the 46 other pinned ones", () => {
    expect(keys).toHaveLength(238);
    expect(keys.filter((key) => census[key]!.two)).toHaveLength(192);
    expect(
      Object.fromEntries((["tinted", "short-box", "dark-type-and-box", "shadow-box", "crown", "nickname", "dark-type-bar"] as const).map((look) => [look, withLook(look, true).length])),
    ).toEqual({ tinted: 119, "short-box": 25, "dark-type-and-box": 10, "shadow-box": 31, crown: 4, nickname: 3, "dark-type-bar": 0 });
    expect(
      Object.fromEntries((["short-box", "dark-type-and-box", "dark-type-bar"] as const).map((look) => [look, withLook(look, false).length])),
    ).toEqual({ "short-box": 9, "dark-type-and-box": 31, "dark-type-bar": 6 });
    // Every printing is a borderless 2015-frame land, and a two-colour one
    // is two colours by the land rule (the mana it makes, or the two basic
    // types a fetch land searches for) — never by its identity alone.
    for (const key of keys) {
      const card = cardOf(key);
      expect({ border: card.border_color, frame: card.frame, id: `${card.set}-${card.collector_number}` }, key).toEqual({ border: "borderless", frame: "2015", id: key });
      expect(printingFacts(card).kind, key).toBe("land");
      expect(printingFacts(card).colors.length === 2, key).toBe(census[key]!.two);
    }
  });

  it("every pin of the four lists is a printing Scryfall lists, with the look its list names — and every such look here is pinned", () => {
    for (const [look, pins] of Object.entries(PIN_LISTS) as [Look, Readonly<Record<string, readonly string[]>>][]) {
      const pinned = pinIds(pins);
      expect(new Set(pinned).size, look).toBe(pinned.length);
      expect([...pinned].sort(), look).toEqual(withLook(look).sort());
    }
    expect({
      dark: pinIds(BORDERLESS_LAND_DARK_PINS).length,
      darkTypeBar: pinIds(BORDERLESS_LAND_DARK_TYPE_BAR_PINS).length,
      shortBox: pinIds(BORDERLESS_LAND_SHORT_BOX_PINS).length,
      shadowBox: pinIds(BORDERLESS_LAND_SHADOW_BOX_PINS).length,
    }).toEqual({ dark: 41, darkTypeBar: 6, shortBox: 34, shadowBox: 31 });
    // No printing sits on two lists.
    const all = Object.values(PIN_LISTS).flatMap(pinIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("the 119 tinted two-colour prints are the exact borderless land, landing on the bordered land frame; none carries a gap", () => {
    const bySet: Record<string, number> = {};
    const byPair: Record<string, number> = {};
    for (const key of withLook("tinted")) {
      const card = cardOf(key);
      const match = frameMatchFromScryfall(card);
      expect({ status: match.status, signature: match.signature, template: match.template, landOn: match.landOn, gaps: match.gaps, reason: match.reason }, key).toEqual({
        status: "exact",
        signature: "borderless/land",
        template: "m15borderlessland",
        landOn: "m15land",
        gaps: undefined,
        reason: null,
      });
      const patch = mapScryfallToFormPatch(card);
      expect(patch, key).toMatchObject({ frame_template: "m15land", kind: "land", color_identity: ["multicolor"], printed_two_color: true });
      expect(TWO_COLOR_PAIRS as readonly string[], key).toContain(patch.color_pair);
      // On either land frame the card carries the pair and the switch.
      for (const landed of ["m15land", "m15borderlessland"] as const) {
        expect(importedAnatomy(patch, landed), `${key} on ${landed}`).toEqual({
          style: expect.objectContaining({ twoColor: true }),
          colorIdentity: pairColorIdentity(patch.color_pair as TwoColorPair),
        });
      }
      bySet[card.set ?? ""] = (bySet[card.set ?? ""] ?? 0) + 1;
      byPair[patch.color_pair as string] = (byPair[patch.color_pair as string] ?? 0) + 1;
    }
    expect(bySet).toEqual({ mid: 5, vow: 5, "2x2": 10, dmu: 6, bro: 4, one: 5, cmm: 5, sld: 14, lci: 5, rvr: 10, mkm: 10, clu: 20, otj: 5, mh3: 5, dsk: 5, dft: 5 });
    expect(byPair).toEqual({ wu: 12, wb: 12, ub: 12, ur: 11, br: 12, bg: 13, rg: 11, rw: 14, gw: 11, gu: 11 });
  });

  it.each(["short-box", "dark-type-and-box", "dark-type-bar", "shadow-box", "crown", "nickname"] as const)(
    "every %s print stays nearest on that gap, whatever its colours",
    (look) => {
      const prints = withLook(look);
      expect(prints.length).toBeGreaterThan(0);
      for (const key of prints) {
        const match = frameMatchFromScryfall(cardOf(key));
        expect({ status: match.status, signature: match.signature, template: match.template, first: match.gaps?.[0] }, key).toEqual({
          status: "nearest",
          signature: `borderless/land+${look}`,
          template: "m15borderlessland",
          first: look,
        });
        // The two-colour gap is closed on this frame: no printing names it.
        expect(match.gaps ?? [], key).not.toContain("two-colour");
        expect(match.landOn, key).toBe("m15land");
      }
    },
  );

  it("the pair rides the gold `m` tick: a tinted print is exact only on a database that has verified m15borderlessland/m", () => {
    const land = ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15land", k));
    const verified = new Set([...land, ...["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15borderlessland", k))]);
    const withoutM = new Set([...verified].filter((k) => k !== frameComboKey("m15borderlessland", "m")));
    for (const key of withLook("tinted")) {
      const patch = mapScryfallToFormPatch(cardOf(key));
      expect(finalizeImportMatch(patch, verified).frame_match, key).toMatchObject({ status: "exact", template: "m15borderlessland", landOn: "m15land", reason: null });
      expect(finalizeImportMatch(patch, withoutM).frame_match, key).toMatchObject({
        status: "nearest",
        template: "m15borderlessland",
        landOn: "m15land",
        reason: "not yet verified in multicolor",
        unverified: true,
      });
      // Either way the import lands on the bordered land frame (1.18).
      expect(finalizeImportMatch(patch, verified).frame_template, key).toBe("m15land");
      expect(finalizeImportMatch(patch, withoutM).frame_template, key).toBe("m15land");
    }
  });

  it("the fifteen fetch lands take the two colours they search for: MH3's five print the tinted look, SPG's ten the shadow box", () => {
    const fetch = keys.filter((key) => {
      const card = cardOf(key);
      return census[key]!.two && (card.color_identity ?? []).length === 0 && (card.produced_mana ?? []).length === 0;
    });
    expect(fetch.map((key) => `${key}:${census[key]!.look}`).sort()).toEqual(
      [
        ...["352", "353", "356", "360", "361"].map((n) => `mh3-${n}:tinted`),
        ...["109", "110", "111", "112", "113", "114", "115", "116", "117", "118"].map((n) => `spg-${n}:shadow-box`),
      ].sort(),
    );
    for (const key of fetch) {
      const card = cardOf(key);
      expect(landFrameColorRule(card), key).toHaveLength(2);
      expect(TWO_COLOR_PAIRS as readonly string[], key).toContain(mapScryfallToFormPatch(card).color_pair);
    }
    expect(Object.fromEntries(["mh3-352", "mh3-353", "mh3-356", "mh3-360", "mh3-361"].map((key) => [key, mapScryfallToFormPatch(cardOf(key)).color_pair]))).toEqual({
      "mh3-352": "br",
      "mh3-353": "wu",
      "mh3-356": "ub",
      "mh3-360": "gw",
      "mh3-361": "rg",
    });
  });
});

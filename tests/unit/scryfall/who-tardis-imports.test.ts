import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/who-tardis-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, frontFacePairFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameAnatomyOf, importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { templateRefusesKind } from "@/lib/creator/card-kinds";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Doctor Who TARDIS showcase's imports. The run and its
// neighbours (fixtures/who-tardis-printings.json, captured 2026-10-28 and
// trimmed to what the import reads): WHO #535–564, the serialized twins
// #552z–564z and the surge-foil twins #1126–1155 — 73 printings, every one
// borderless — land on `tardis`: exact once the card's colour is verified,
// nearest until then. The neighbours (the extended-art lands #534 / #1125,
// the promo #565, the surge-foil basic #1156) and the same cards' other
// printings (the regular, etched, extended-art and surge-foil frames) keep
// their landing. The card's colour is the printing's, always; the
// two-colour dress, the stamp and the collector line follow the printing;
// the frame has no crown (its brace is on every print, so the masters draw
// it).
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const IDENTITY_OF: Record<string, ColorIdentity> = { w: "white", u: "blue", b: "black", r: "red", g: "green" };

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: parseInt(c.collector_number ?? "", 10), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const isRun = (n: number) => (n >= 535 && n <= 564) || (n >= 1126 && n <= 1155);
const run = rows.filter((r) => r.c.set === "who" && r.c.border_color === "borderless" && isRun(r.n));
const others = rows.filter((r) => !run.includes(r));

describe("the Doctor Who TARDIS imports", () => {
  it("covers the run: 73 borderless printings — 30 base, 13 serialized, 30 surge foil", () => {
    expect(run).toHaveLength(73);
    expect(run.filter((r) => /z$/.test(r.c.collector_number ?? ""))).toHaveLength(13);
    expect(run.filter((r) => (r.c.promo_types ?? []).includes("surgefoil"))).toHaveLength(30);
    // Every one single-faced on the 2015 frame with the `showcase` effect and
    // the triangle stamp; every one a creature but the TARDIS (a Vehicle);
    // no land, walker, saga or double-faced card.
    for (const r of run) {
      expect([r.c.layout, r.c.border_color, r.c.frame, r.c.security_stamp], r.key).toEqual(["normal", "borderless", "2015", "triangle"]);
      expect(r.c.frame_effects, r.key).toContain("showcase");
      expect(r.c.type_line, r.key).not.toMatch(/Land|Planeswalker|Saga|Battle/);
      if (r.c.name !== "TARDIS") expect(r.c.type_line, r.key).toMatch(/Creature/);
    }
    expect(run.filter((r) => r.c.name === "TARDIS").map((r) => r.key)).toEqual(["who-551", "who-1142"]);
    expect(others.length).toBe(11);
  });

  it("lands every printing of the run on `tardis`, exact, with no gap", () => {
    for (const r of run) {
      expect(r.match.signature, r.key).toBe("showcase/who/tardis");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "tardis"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
      expect(r.match.exactLabel, r.key).toBe("Doctor Who TARDIS showcase");
    }
    // Two colourless cards (Cyberman Patrol, TARDIS: artifacts), two
    // three-colour ones (gold), each in two finishes, and 55 two-colour printings.
    expect(run.filter((r) => r.colour === "c")).toHaveLength(4);
    expect(run.filter((r) => (r.c.colors ?? []).length >= 3)).toHaveLength(4);
    expect(run.filter((r) => (r.c.colors ?? []).length === 2)).toHaveLength(55);
    // Every kind its body draws but the land (no land master: the pack's 404s).
    for (const kind of ["creature", "instant", "sorcery", "enchantment", "artifact", "token"] as const) expect(templateRefusesKind("tardis", kind), kind).toBe(false);
    for (const kind of ["land", "planeswalker", "battle"] as const) expect(templateRefusesKind("tardis", kind), kind).toBe(true);
  });

  it("leaves the neighbours and the same cards' other frames where they were", () => {
    for (const r of others) {
      expect(r.match.template, r.key).not.toBe("tardis");
      expect(r.match.signature, r.key).not.toBe("showcase/who/tardis");
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["who-535", "who-537", "who-538", "who-539", "who-540", "who-548", "who-550", "who-551", "who-561z", "who-1155"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour), frameComboKey("m15artifact", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["tardis", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/who/tardis", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("tardis", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("tardis", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["tardis", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the two-colour dress on a pair, the triangle and the 2023 collector line — and no crown", () => {
    let pairs = 0;
    for (const r of run) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 1166 } as never });
      // The card's colour is the printing's — never a frame stand-in's: its
      // one colour, its PAIR (the frame draws the pair's dress), or gold.
      const pair = frontFacePairFromScryfall(r.c);
      const { style, colorIdentity } = importedAnatomy(patch, "tardis");
      expect(colorIdentity, r.key).toEqual(pair ? [...pair].map((l) => IDENTITY_OF[l]) : frameColorsFromScryfall(r.c));
      const saved = normalizeAnatomy({ ...style, template: "tardis" }, "tardis", patch.card_type ?? "creature");
      expect(saved.crown === true, r.key).toBe(false);
      const twoColour = (r.c.colors ?? []).length === 2;
      if (twoColour) pairs += 1;
      expect(saved.twoColor === true, r.key).toBe(twoColour);
      // Every printing wears the Universes Beyond triangle, the uncommons too.
      expect(saved.stamp, r.key).toBe("triangle");
      expect(saved.collector, r.key).toBe("2023");
    }
    expect(pairs).toBe(55);
    expect(frameAnatomyOf("tardis")).toMatchObject({ crown: false, twoColor: ["split"], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["blue"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("tardis")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("tardis", "w")])).has("tardis")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("tardis", "u")])).has("tardis")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "tardis");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("tardis"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on a land or a planeswalker never lands there.
    expect(resolveGeneratedFrame({ cardType: "land", requested: "tardis", colorIdentity: ["blue"], verifiedKeys: new Set([...every("tardis"), ...every("m15land")]), random: () => 0 })).not.toBe("tardis");
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "tardis", colorIdentity: ["blue"], verifiedKeys: new Set([...every("tardis"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});

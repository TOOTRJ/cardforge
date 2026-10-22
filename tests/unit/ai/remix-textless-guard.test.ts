import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_RULES, templatesOfRule } from "@/lib/scryfall/frame-signatures";
import { ownCardRemixFrame, ownCardTextStandIn, remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import {
  autoTokenTextBoxFrame,
  frameHidesRulesBoxText,
  remixSavedFrame,
  withoutTextlessFrames,
} from "@/lib/creator/frame-resolve";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameGateError } from "@/lib/cards/frame-availability";
import { FRAME_TEMPLATE_VALUES, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.24 — an AI remix never saves a text on a frame that draws none.
//
// Since #529 the deck remix lands where the IMPORT lands, "once verified"
// landings included, and since #533 an own card keeps its frame. A frame
// whose profile is `textless` hides the rules box in both renderers, so a
// remix that copies rules or writes a flavour line onto one saves a text
// nobody can read. The guard (remixSavedFrame, lib/creator/frame-resolve.ts)
// sits where both remix paths save; this file pins the pure half:
//   1. WHICH frames hide text, and which registry rules reach them;
//   2. the guard's three answers (stands / stand-in / nothing else);
//   3. a sweep over every recorded printing × the verified-list variants:
//      with production's list nothing differs from the code before the
//      guard, and where something differs it is a text that was hidden;
//   4. the same rule in resolveGeneratedFrame's random pool.
// The step's wiring is deck-remix-step-frame.test.ts and
// deck-remix-own-card-frame.test.ts; the frames that would join the list
// the day they gain the flag are remix-textless-guard-flagged.test.ts.
// ---------------------------------------------------------------------------

const TEXTLESS = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).textless);
const every = (templates: readonly string[], colours: readonly string[] = FRAME_COLOR_KEYS) =>
  templates.flatMap((t) => colours.map((c) => frameComboKey(t as FrameTemplate, c)));

function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const keys = new Set<string>(every([...everyColour.matchAll(/'([^']+)'/g)].map((m) => m[1])));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  return keys;
}
const PROD = productionVerifiedKeys();
const ALL = new Set(every(FRAME_TEMPLATE_VALUES));
const minus = (keys: ReadonlySet<string>, ...templates: string[]) =>
  new Set([...keys].filter((key) => !templates.some((t) => key.startsWith(`${t}/`))));
/** The textless promo pair (textless profiles since layout v58). */
const FAMILY: readonly string[] = ["m15textless", "m15textlessland"];
const HEIGHTS = ["m20tokentext", "m20tokentall", "m20tokenartifacttext", "m20tokenartifacttall"];
const ARCH_BOXES = ["m15tokentext", "m15tokenartifacttext"];

describe("which frames hide a card's text", () => {
  it("the profiles flagged `textless` are the full-art token's two textless heights and, since layout v58, the textless promo pair", () => {
    // A new `textless` profile is covered by the guard with no other change;
    // it belongs in docs/FRAMES.md's landings table (TODO 1.24) too.
    expect(TEXTLESS).toEqual(["m20token", "m20tokenartifact", "m20tokennyx", "m20tokenartifactnyx", "m15textless", "m15textlessland"]);
  });

  it("the test is the renderers': the flag AND rules-box text (rules or flavour, not blank)", () => {
    expect(frameHidesRulesBoxText("m20token", { rulesText: "Lifelink" })).toBe(true);
    expect(frameHidesRulesBoxText("m20token", { flavorText: "A line." })).toBe(true);
    expect(frameHidesRulesBoxText("m20token", { rulesText: "  ", flavorText: null })).toBe(false);
    expect(frameHidesRulesBoxText("m20tokentext", { rulesText: "Lifelink" })).toBe(false);
    // The 2014–19 arch has no box either, but DRAWS a text left on it (on
    // its scrim, TODO 4.49 (b)): never hidden.
    expect(frameHidesRulesBoxText("m15token", { rulesText: "Lifelink" })).toBe(false);
  });

  it("the 'M15 Textless' frames ARE textless profiles since layout v58: a text landing there is hidden, so the guard covers them", () => {
    // The registry's `textless` family (textless/2015, textless/old-frame
    // once verified, textless/future, borderless/textless,
    // borderless/basic/textless): the black-bordered textless promos (CC
    // 'Magic Fest Promos', TODO 4.35 / 4.42) print no type line and no
    // rules. remix-textless-guard-flagged.test.ts pins the stand-ins.
    for (const template of ["m15textless", "m15textlessland"] as const) {
      expect(getFrameProfile(template).textless).toBe(true);
      expect(frameHidesRulesBoxText(template, { rulesText: "Destroy all creatures.", flavorText: "A line." })).toBe(true);
      expect(frameHidesRulesBoxText(template, { rulesText: null, flavorText: null })).toBe(false);
    }
  });

  it("the registry rules that can reach a text-hiding frame are the M20+ token design's (all `onceVerified`) and the textless family's", () => {
    const reaching = FRAME_SIGNATURE_RULES.filter((rule) => templatesOfRule(rule).some((t) => TEXTLESS.includes(t)));
    expect(reaching.map((rule) => rule.key)).toEqual([
      "borderless/basic/textless",
      "borderless/textless",
      "borderless/token",
      // TODO 5.5 (c): the transforming Incubator // Phyrexian, nearest on the
      // plain full-art pair until 5.5 (d) — the same `onceVerified` swap.
      "token/m20+dfc-token-transform",
      "token/m20+nyx-dress",
      "token/m20+border",
      "token/m20+crown",
      "token/m20+two-colour",
      "token/m20+two-colour-hybrid",
      "token/m20",
      "textless/2015",
      "textless/old-frame",
      "textless/future",
    ]);
  });

  it("withoutTextlessFrames drops those frames' combos and nothing else", () => {
    const kept = withoutTextlessFrames(ALL);
    expect(ALL.size - kept.size).toBe(TEXTLESS.length * FRAME_COLOR_KEYS.length);
    for (const template of TEXTLESS) expect(kept.has(frameComboKey(template, "w"))).toBe(false);
    expect(kept.has(frameComboKey("m20tokentext", "w"))).toBe(true);
    expect(kept.has(frameComboKey("m15textless", "w"))).toBe(false);
    expect(kept.has(frameComboKey("m15", "w"))).toBe(true);
    // A key of no current template (a retired one in an old list) is kept.
    expect(withoutTextlessFrames(new Set(["regular/w"])).has("regular/w")).toBe(true);
  });
});

describe("remixSavedFrame — the guard", () => {
  const soldier = {
    cardType: "token" as CardType,
    supertype: "Creature",
    subtypes: ["Soldier"],
    power: "1",
    toughness: "1",
    colorIdentity: ["white"] as ColorIdentity[],
  };
  const TEXT = { rulesText: null, flavorText: "New flavour." };

  it("a landing that draws the text, and a card that saves with none, stand", () => {
    const verifiedKeys = new Set(every(["m20token", "m15token"], ["w"]));
    expect(remixSavedFrame({ ...soldier, template: "m20token", rulesText: null, flavorText: null, verifiedKeys, standIn: "m15token" })).toBe("m20token");
    expect(remixSavedFrame({ ...soldier, template: "m20token", rulesText: " ", flavorText: "", verifiedKeys, standIn: null })).toBe("m20token");
    expect(remixSavedFrame({ ...soldier, template: "m15token", ...TEXT, verifiedKeys, standIn: "m15token" })).toBe("m15token");
  });

  it("a token follows its text first, as before (the box where it is published)", () => {
    const verifiedKeys = new Set(every(["m20token", "m20tokentext", "m15token", "m15tokentext"], ["w"]));
    expect(remixSavedFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys, standIn: "m15token" })).toBe("m20tokentext");
    const archOnly = new Set(every(["m20token", "m15token", "m15tokentext"], ["w"]));
    expect(remixSavedFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys: archOnly, standIn: "m15token" })).toBe("m15tokentext");
  });

  it("a landing that would hide the text gives way to the stand-in", () => {
    const verifiedKeys = new Set(every(["m20token", "m15token"], ["w"]));
    // Before the guard: m20token, the flavour unprinted.
    expect(autoTokenTextBoxFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys })).toBe("m20token");
    expect(remixSavedFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys, standIn: "m15token" })).toBe("m15token");
    // An own card's stand-in is the default landing: no template.
    expect(remixSavedFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys, standIn: null })).toBeUndefined();
  });

  it("with no stand-in the landing stands: a hidden text, never no frame at all", () => {
    const verifiedKeys = new Set(every(["m20token"], ["w"]));
    expect(remixSavedFrame({ ...soldier, template: "m20token", ...TEXT, verifiedKeys })).toBe("m20token");
  });

  it("an own card's stand-in is the default landing only where the save's gates pass it in the card's colour", () => {
    const token = { frame_style: { template: "m20token" }, color_identity: ["red"] as ColorIdentity[], card_type: "token" as CardType, supertype: "Creature", subtypes: ["Goblin"], title: "Goblin", rules_text: null };
    expect(ownCardTextStandIn(token, new Set(every(["m20token", "m15"], ["r"])))).toBeNull();
    expect(frameGateError(undefined, token.color_identity, new Set(every(["m20token", "m15"], ["r"])))).toBeNull();
    expect(ownCardTextStandIn(token, new Set(every(["m20token"], ["r"])))).toBeUndefined();
    expect(ownCardTextStandIn(token, new Set(every(["m20token", "m15"], ["u"])))).toBeUndefined();
  });

  it("an own TOKEN's stand-in is the 2014–19 arch its type words pick — what a printing of it gets — before the default frame", () => {
    const token = { frame_style: { template: "m20token" }, color_identity: ["red"] as ColorIdentity[], card_type: "token" as CardType, supertype: "Creature", subtypes: ["Goblin"], title: "Goblin", rules_text: null };
    const treasure = { ...token, frame_style: { template: "m20tokenartifact" }, supertype: "Artifact", subtypes: ["Treasure"], title: "Treasure" };
    const both = new Set(every(["m20token", "m20tokenartifact", "m15token", "m15tokenartifact", "m15"], ["r"]));
    expect(ownCardTextStandIn(token, both)).toBe("m15token");
    expect(ownCardTextStandIn(treasure, both)).toBe("m15tokenartifact");
    // The arch of the OTHER dress is never taken: a Treasure whose artifact
    // arch isn't published goes to the default frame, not the plain arch.
    const plainOnly = new Set(every(["m20tokenartifact", "m15token", "m15"], ["r"]));
    expect(ownCardTextStandIn(treasure, plainOnly)).toBeNull();
    // Not a token: no arch (only a token wears it).
    expect(ownCardTextStandIn({ ...token, card_type: "creature" as CardType }, both)).toBeNull();
    // Through the guard: the arch stands in, the text on its scrim; where
    // the arch's text box is published the height rule took it already.
    const card = { cardType: "token" as CardType, supertype: "Creature", subtypes: ["Goblin"], power: "1", toughness: "1", colorIdentity: ["red"] as ColorIdentity[], rulesText: null, flavorText: "New flavour." };
    expect(remixSavedFrame({ ...card, template: "m20token", verifiedKeys: both, standIn: ownCardTextStandIn(token, both) })).toBe("m15token");
    const boxed = new Set([...both, ...every(["m15tokentext"], ["r"])]);
    expect(remixSavedFrame({ ...card, template: "m20token", verifiedKeys: boxed, standIn: ownCardTextStandIn(token, boxed) })).toBe("m15tokentext");
    expect(remixSavedFrame({ ...card, flavorText: null, template: "m20token", verifiedKeys: both, standIn: ownCardTextStandIn(token, both) })).toBe("m20token");
  });
});

describe("the one place production's list differs from before the guard: an off-kind own card on a textless token height", () => {
  // The server's kind gate never refuses a border-era standard (an off-kind
  // legacy card stays editable), so a card whose card_type is NOT token can
  // be stored on `m20token`; #533 keeps that frame. The height rule
  // (autoTokenTextBoxFrame) reads the card's kind — a creature is no token
  // — so before the guard such a card kept the textless height WITH its
  // text, whatever was ticked. Now it lands on the default frame, the text
  // drawn. No such card is public on production (2026-10-13: one card on
  // these frames, a token without text).
  const creature = { frame_style: { template: "m20token" }, color_identity: ["white"] as ColorIdentity[], card_type: "creature" as CardType, supertype: null, subtypes: ["Soldier"], title: "Soldier", rules_text: "Vigilance" };
  const card = { template: "m20token" as FrameTemplate, cardType: creature.card_type, supertype: null, subtypes: creature.subtypes, rulesText: creature.rules_text, power: "1", toughness: "1", colorIdentity: creature.color_identity, verifiedKeys: PROD };

  it("it kept the textless height with its text before; it takes the default frame now, and keeps the height with no text", () => {
    expect(ownCardRemixFrame(creature, PROD, { singleFace: true }).frame_template).toBe("m20token");
    expect(autoTokenTextBoxFrame({ ...card, flavorText: "New flavour." })).toBe("m20token");
    expect(ownCardTextStandIn(creature, PROD)).toBeNull();
    expect(remixSavedFrame({ ...card, flavorText: "New flavour.", standIn: ownCardTextStandIn(creature, PROD) })).toBeUndefined();
    expect(remixSavedFrame({ ...card, rulesText: null, flavorText: null, standIn: ownCardTextStandIn(creature, PROD) })).toBe("m20token");
  });

  it("an own TOKEN there is untouched by the guard on production's list (its text finds its box, as before)", () => {
    const token = { ...creature, card_type: "token" as CardType, supertype: "Creature" };
    const tokenCard = { ...card, cardType: token.card_type, supertype: token.supertype, flavorText: "New flavour." };
    const before = autoTokenTextBoxFrame(tokenCard);
    expect(before).toBe("m20tokentext");
    expect(remixSavedFrame({ ...tokenCard, standIn: ownCardTextStandIn(token, PROD) })).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The sweep: every recorded Scryfall printing under tests/unit/scryfall/
// fixtures (real, trimmed payloads — ~390), remixed with the AI's flavour
// and without, against each verified-list variant. "Before" is the code
// before the guard, to the letter: autoTokenTextBoxFrame on the landing.
// ---------------------------------------------------------------------------

function recordedPrintings(): { key: string; patch: ScryfallImportPatch }[] {
  const dir = join(process.cwd(), "tests/unit/scryfall/fixtures");
  const out: { key: string; patch: ScryfallImportPatch }[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const json = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(json)) {
      const record = raw as { id?: unknown; layout?: unknown } | null;
      if (!record || typeof record.id !== "string" || typeof record.layout !== "string") continue;
      const parsed = scryfallCardSchema.safeParse(raw);
      if (parsed.success) out.push({ key: `${file}:${key}`, patch: mapScryfallToFormPatch(parsed.data) });
    }
  }
  return out;
}
const PRINTINGS = recordedPrintings();

type Row = { key: string; before: FrameTemplate; after: FrameTemplate | undefined; landing: FrameTemplate; hiddenBefore: boolean; hiddenAfter: boolean; standIn: FrameTemplate | undefined };

function sweep(verifiedKeys: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (const { key, patch } of PRINTINGS) {
    const resolved = scryfallRemixMechanics(patch, "Entry", verifiedKeys);
    // A printing with nothing published in its colour fails before and after
    // alike (remixFrameFor is untouched): nothing to compare.
    if (!resolved.ok) continue;
    const m = resolved.mechanics;
    // The remix copies the printing's rules; a trimmed fixture without any
    // is given a line for half of the runs, so every landing is tried with
    // rules, with the AI's flavour alone, and with no text at all.
    for (const rulesText of [m.rules_text ?? null, m.rules_text?.trim() ? m.rules_text : "Vigilance"]) {
      for (const flavorText of ["New flavour.", null]) {
        const card = {
          template: m.frame_template,
          cardType: m.card_type,
          supertype: m.supertype,
          subtypes: m.subtypes,
          rulesText,
          flavorText,
          power: m.power,
          toughness: m.toughness,
          colorIdentity: m.color_identity ?? (["colorless"] as ColorIdentity[]),
          verifiedKeys,
        };
        const before = autoTokenTextBoxFrame(card);
        const after = remixSavedFrame({ ...card, standIn: m.text_stand_in });
        rows.push({
          key: `${key} rules=${Boolean(rulesText?.trim())} flavour=${Boolean(flavorText)}`,
          landing: m.frame_template,
          before,
          after,
          hiddenBefore: frameHidesRulesBoxText(before, card),
          hiddenAfter: after !== undefined && frameHidesRulesBoxText(after, card),
          standIn: m.text_stand_in,
        });
        // The plan's price never moves with the saved frame.
        expect(remixCreditsOf({ frame_template: after, back_face: m.back_face })).toBe(remixCreditsOf(m));
        // A printing's remix always names a frame, published in its colour.
        expect(after).toBeDefined();
        expect(frameGateError(after, card.colorIdentity, verifiedKeys)).toBeNull();
      }
    }
  }
  return rows;
}
const differing = (rows: Row[]) => rows.filter((row) => row.before !== row.after);

describe("the sweep over the recorded printings", () => {
  it("reads a real sample (hundreds of printings, the textless promos and the M20+ tokens among them)", () => {
    expect(PRINTINGS.length).toBeGreaterThan(350);
    const signatures = new Set(PRINTINGS.map(({ patch }) => patch.frame_match?.signature));
    for (const signature of ["textless/2015", "textless/old-frame", "textless/future", "borderless/textless", "borderless/basic/textless", "token/m20", "borderless/token"]) {
      expect(signatures.has(signature)).toBe(true);
    }
  });

  it("with PRODUCTION's verified list nothing differs from before the guard — and nothing was hidden", () => {
    const rows = sweep(PROD);
    expect(rows.length).toBeGreaterThan(1200);
    expect(differing(rows)).toEqual([]);
    expect(rows.filter((row) => row.hiddenBefore || row.hiddenAfter)).toEqual([]);
    // No textless landing is even in doubt there: every colour of every
    // height is ticked, so a token's text always finds its box.
    expect(rows.some((row) => TEXTLESS.includes(row.landing))).toBe(true);
  });

  it("with EVERY template verified only the textless-family landings that carry text differ — onto the registry's stand-in; the tokens find a box", () => {
    const rows = sweep(ALL);
    const changed = differing(rows);
    expect(changed.length).toBeGreaterThan(0);
    for (const row of changed) {
      // Since layout v58 the 'M15 Textless' frames are textless profiles.
      expect(FAMILY).toContain(row.before);
      expect(row.hiddenBefore).toBe(true);
      expect(row.after).toBe(row.standIn);
    }
    expect(rows.filter((row) => row.hiddenAfter)).toEqual([]);
    // …and a remix that saves with NO text keeps the textless landing.
    expect(rows.some((row) => row.after === "m15textless")).toBe(true);
    expect(rows.some((row) => row.after === "m15textlessland")).toBe(true);
    for (const row of rows.filter((r) => FAMILY.includes(r.after as string))) expect(row.key).toContain("rules=false flavour=false");
  });

  it("without the full-art text heights the arch's text box stood in already (unchanged but for the textless family, v58)", () => {
    for (const base of [PROD, ALL]) {
      const rows = sweep(minus(base, ...HEIGHTS));
      for (const row of differing(rows)) expect(FAMILY).toContain(row.before);
      expect(rows.filter((row) => row.hiddenAfter)).toEqual([]);
    }
  });

  it("without ANY token text box, only the textless landings that carried text differ — onto the registry's stand-in, the text drawn", () => {
    for (const base of [PROD, ALL]) {
      const verified = minus(base, ...HEIGHTS, ...ARCH_BOXES);
      const rows = sweep(verified);
      const changed = differing(rows);
      expect(changed.length).toBeGreaterThan(0);
      for (const row of changed) {
        expect(TEXTLESS).toContain(row.before);
        expect(row.hiddenBefore).toBe(true);
        expect(row.hiddenAfter).toBe(false);
        // The stand-in is the import's landing with the textless frames
        // unverified: for a token the 2014–19 arch, whose scrim keeps the
        // text (the textless promo family's: remix-textless-guard-flagged).
        expect(row.after).toBe(row.standIn);
        if (!FAMILY.includes(row.before)) expect(["m15token", "m15tokenartifact"]).toContain(row.after);
      }
      // Everything hidden before is drawn now; nothing else moved.
      expect(rows.filter((row) => row.hiddenBefore).length).toBe(changed.length);
      expect(rows.filter((row) => row.hiddenAfter)).toEqual([]);
    }
  });

  it("with the textless heights as a colour's ONLY token frames the landing stands (no stand-in, the save never refused)", () => {
    // Production's list without every other token frame (with EVERY
    // template ticked the resolver's last resort — any published frame of
    // the kind in the colour — would still find one).
    const verified = minus(PROD, ...HEIGHTS, ...ARCH_BOXES, "m15token", "m15tokenartifact");
    const rows = sweep(verified);
    expect(differing(rows)).toEqual([]);
    const hidden = rows.filter((row) => row.hiddenAfter);
    expect(hidden.length).toBeGreaterThan(0);
    for (const row of hidden) expect(row.standIn).toBeUndefined();
  });
});

describe("resolveGeneratedFrame — the same rule in the AI's random pool", () => {
  const token = (text: { rulesText?: string | null; flavorText?: string | null }, verifiedKeys: ReadonlySet<string>, random: number) =>
    resolveGeneratedFrame({
      cardType: "token",
      requested: "random",
      colorIdentity: ["white"],
      verifiedKeys,
      face: { cardType: "token", supertype: "Creature", subtypes: ["Soldier"], title: "Soldier", power: "1", toughness: "1", ...text },
      random: () => random,
    });
  const SPREAD = [0, 0.25, 0.5, 0.75, 0.999];

  it("a token with text never draws the textless height while another frame it fits is published", () => {
    // No frame the text picks is published here (`boxed` is empty): the
    // pool used to be the arch AND the textless height.
    const verified = new Set(every(["m15token", "m20token"], ["w"]));
    for (const random of SPREAD) {
      expect(token({ rulesText: "Vigilance" }, verified, random)).toBe("m15token");
      expect(token({ flavorText: "A line." }, verified, random)).toBe("m15token");
    }
  });

  it("a token without text may (unchanged), and the textless height alone still dresses a text token rather than no frame", () => {
    const verified = new Set(every(["m15token", "m20token"], ["w"]));
    expect(new Set(SPREAD.map((random) => token({}, verified, random)))).toEqual(new Set(["m15token", "m20token"]));
    const only = new Set(every(["m20token"], ["w"]));
    expect(token({ rulesText: "Vigilance" }, only, 0)).toBe("m20token");
  });

  it("with production's list a text token lands on a box, as before", () => {
    for (const random of SPREAD) {
      const picked = token({ rulesText: "Vigilance" }, PROD, random);
      expect(["m15tokentext", "m20tokentext"]).toContain(picked);
    }
  });
});

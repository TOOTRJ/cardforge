import { describe, expect, it } from "vitest";
import { followTokenHeight, newTokenFrame, defaultTokenFrameIn, archTokenFrameIn, isArchTokenFrame } from "@/lib/creator/token-frame-auto";
import { tokenFrameFor, typeWordFrameFor, isTokenHeightDress, isTypeWordDress } from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { autoTokenTextBoxFrame, importFrameCandidates } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  ARCH_TOKEN_TEMPLATES,
  archTallStandIn,
  isArchTallTokenTemplate,
  tokenHeightForText,
  tokenHeightOf,
  tokenTemplate,
} from "@/lib/cards/token-height";
import { getFrameProfile, TOKEN_TALL_UP_PX } from "@/lib/cards/template-layout";
import { TOKEN_TALL_RECIPE } from "../../../scripts/lib/token-tall.mjs";
import type { FrameTemplate } from "@/types/card";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { remixSavedFrame } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { TALL_BOX_TOKEN_PINS, TALL_BOX_TOKEN_PIN_COMBOS } from "@/lib/scryfall/frame-signatures";
import tokenData from "../scryfall/fixtures/token-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.55: the 2014–19 arch token's TALL text box (m15tokentall /
// m15tokenartifacttall). The arch has three heights now, as the full-art
// design does, and its text picks them by the same rule against its OWN
// regular box (72 px floor); the tall box is an ADDITION — no stored card
// moves, and wherever it isn't verified in the card's colour the regular
// text box stands in (the text shrinks to fit, as it did before 4.55).
// ---------------------------------------------------------------------------

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const allOf = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as FrameTemplate, k))));
const ARCH = ["m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext"];
const TALL = ["m15tokentall", "m15tokenartifacttall"];
// Angel of Sanctions TAKH #1's text: 163 characters, a P/T — the regular box
// holds it only under 72 px.
const AKH =
  "Flying\nWhen Angel of Sanctions enters the battlefield, you may exile target nonland permanent an opponent controls until Angel of Sanctions leaves the battlefield.";
const LONG =
  "When this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";

describe("the arch's heights (token-height)", () => {
  it("names the three heights and their artifact dresses, and reads them back", () => {
    expect(ARCH_TOKEN_TEMPLATES.tall).toMatchObject({ plain: "m15tokentall", artifact: "m15tokenartifacttall" });
    for (const height of ["textless", "regular", "tall"] as const) {
      for (const artifact of [false, true]) {
        const t = tokenTemplate("arch", height, artifact);
        // (The arch has no Nyx dress, TODO 4.51: never read as one.)
        expect(tokenHeightOf(t), t).toEqual({ design: "arch", height, artifact, nyx: false });
        expect(tokenTemplate("arch", height, artifact, true), t).toBe(t);
      }
    }
    expect(tokenHeightOf("m20tokentall")).toEqual({ design: "m20", height: "tall", artifact: false, nyx: false });
    expect(tokenHeightOf("m20tokennyxtall")).toEqual({ design: "m20", height: "tall", artifact: false, nyx: true });
    expect(tokenHeightOf("m15")).toBeNull();
    expect(TALL.every(isArchTallTokenTemplate)).toBe(true);
    expect(isArchTallTokenTemplate("m20tokentall")).toBe(false);
    expect(archTallStandIn("m15tokentall")).toBe("m15tokentext");
    expect(archTallStandIn("m15tokenartifacttall")).toBe("m15tokenartifacttext");
    expect(archTallStandIn("m20tokentall")).toBeNull();
    expect(archTallStandIn("m15tokentext")).toBeNull();
  });

  it("asks for the tall box exactly when the arch's regular box holds the text only under 72 px", () => {
    expect(tokenHeightForText({ rulesText: null, printsPowerToughness: true }, "arch")).toBe("textless");
    expect(tokenHeightForText({ rulesText: "Vigilance", printsPowerToughness: true }, "arch")).toBe("regular");
    expect(tokenHeightForText({ rulesText: AKH, printsPowerToughness: true }, "arch")).toBe("tall");
    expect(tokenHeightForText({ rulesText: LONG, printsPowerToughness: true }, "arch")).toBe("tall");
    // The SOI Clue (39 characters) fits the regular box: the IMPORT pins the
    // printed tall Clues; the text rule never could.
    expect(tokenHeightForText({ rulesText: "{2}, Sacrifice this artifact: Draw a card.", printsPowerToughness: false, artifact: true }, "arch")).toBe("regular");
  });

  it("the tall box takes text the regular box can't hold at the floor", () => {
    expect(tokenHeightForText({ rulesText: `${LONG}\n${LONG}`, printsPowerToughness: true }, "arch")).toBe("tall");
  });
});

describe("tokenFrameFor on the arch: its own heights, its own design", () => {
  it("picks no box, the text box or the tall box from whichever arch height it is handed", () => {
    for (const start of ["m15token", "m15tokentext", "m15tokentall"] as FrameTemplate[]) {
      expect(tokenFrameFor("token", start, { supertype: "Creature" }), start).toBe("m15token");
      expect(tokenFrameFor("token", start, { supertype: "Creature", rulesText: "Flying" }), start).toBe("m15tokentext");
      expect(tokenFrameFor("token", start, { supertype: "Creature", rulesText: AKH }), start).toBe("m15tokentall");
    }
  });

  it("composes with the Artifact word: the tall box's artifact dress", () => {
    expect(typeWordFrameFor("token", "m15tokentall", "Artifact")).toBe("m15tokenartifacttall");
    expect(typeWordFrameFor("token", "m15tokenartifacttall", "Creature")).toBe("m15tokentall");
    expect(tokenFrameFor("token", "m15tokenartifacttall", { supertype: "Creature", rulesText: AKH })).toBe("m15tokentall");
    expect(tokenFrameFor("token", "m15token", { supertype: "Artifact", rulesText: LONG })).toBe("m15tokenartifacttall");
    expect(isTypeWordDress("token", "m15tokenartifacttall")).toBe(true);
    expect(isTokenHeightDress("token", "m15tokentall")).toBe(true);
  });

  it("never crosses to the full-art design (nor back)", () => {
    expect(tokenFrameFor("token", "m20tokentext", { supertype: "Creature", rulesText: AKH })).toBe("m20tokentall");
    expect(tokenFrameFor("token", "m15tokentext", { supertype: "Creature", rulesText: AKH })).toBe("m15tokentall");
    expect(isArchTokenFrame("m15tokentall")).toBe(true);
    expect(isArchTokenFrame("m15tokenartifacttall")).toBe(true);
  });
});

describe("the creator: a new token, a colour, the follow", () => {
  const text = (rulesText: string | null, supertype = "Creature") => ({ supertype, rulesText, flavorText: null, printsPowerToughness: true });

  it("a NEW arch token with long text starts on the tall box where it is verified, else on the text box", () => {
    expect(newTokenFrame(text(AKH), "w", allOf(...ARCH, ...TALL))).toBe("m15tokentall");
    expect(newTokenFrame(text(AKH), "w", allOf(...ARCH))).toBe("m15tokentext");
    expect(newTokenFrame(text(AKH, "Artifact"), "c", allOf(...ARCH, ...TALL))).toBe("m15tokenartifacttall");
    // Verified in another colour only: the text box.
    expect(archTokenFrameIn(text(AKH), "u", new Set([frameComboKey("m15tokentall", "w"), ...allOf(...ARCH)]))).toBe("m15tokentext");
    // A short text: the text box, verified tall or not.
    expect(newTokenFrame(text("Flying"), "w", allOf(...ARCH, ...TALL))).toBe("m15tokentext");
  });

  it("a colour picked after the type moves a default-switch token between the tall box and its stand-in", () => {
    const verified = new Set([...allOf(...ARCH), frameComboKey("m15tokentall", "w")]);
    expect(defaultTokenFrameIn(text(AKH), "m15tokentext", "w", verified)).toBe("m15tokentall");
    expect(defaultTokenFrameIn(text(AKH), "m15tokentall", "u", verified)).toBe("m15tokentext");
  });

  const follow = (template: FrameTemplate, previous: string | null, next: string | null, verified?: Set<string>, heightPinned = false) =>
    followTokenHeight({
      ...text(next),
      template,
      previous: text(previous),
      heightPinned,
      ...(verified ? { colorKey: "w", verifiedKeys: verified } : {}),
    });

  it("follows the text between the arch's heights while it wears the height the text asked for", () => {
    expect(follow("m15tokentext", "Flying", AKH)).toBe("m15tokentall");
    expect(follow("m15tokentall", AKH, "Flying")).toBe("m15tokentext");
    expect(follow("m15tokentall", AKH, null)).toBe("m15token");
    expect(follow("m15token", null, AKH)).toBe("m15tokentall");
    expect(follow("m15token", null, "Flying")).toBe("m15tokentext");
  });

  it("keeps a height that disagreed with the old text — but a text going still takes the box with it (round 11)", () => {
    // A stored text-box card with long text (it shrank to fit before 4.55):
    // an edit of the text never moves it onto the tall box…
    expect(follow("m15tokentext", AKH, `${AKH} `)).toBe("m15tokentext");
    // …but emptied, it loses its box as before.
    expect(follow("m15tokentext", AKH, null)).toBe("m15token");
    // A pick by hand sticks.
    expect(follow("m15tokentext", "Flying", AKH, undefined, true)).toBe("m15tokentext");
  });

  it("never moves onto an unverified tall box: the text box stands in", () => {
    expect(follow("m15tokentext", "Flying", AKH, allOf(...ARCH))).toBe("m15tokentext");
    expect(follow("m15token", null, AKH, allOf(...ARCH))).toBe("m15tokentext");
    expect(follow("m15token", null, AKH, allOf(...ARCH, ...TALL))).toBe("m15tokentall");
  });
});

describe("the AI jobs and the deck remix", () => {
  const generated = (requested: FrameTemplate | "random", rulesText: string | null, verified: Set<string>, roll = 0.99, supertype = "Creature") =>
    resolveGeneratedFrame({
      cardType: "token",
      requested,
      colorIdentity: ["white"],
      verifiedKeys: verified,
      face: { cardType: "token", supertype, rulesText, power: "4", toughness: "4" },
      random: () => roll,
    });

  it("a requested arch token follows the generated text onto the tall box where it is verified", () => {
    for (const requested of ["m15token", "m15tokentext", "m15tokentall"] as FrameTemplate[]) {
      expect(generated(requested, AKH, allOf(...ARCH, ...TALL)), requested).toBe("m15tokentall");
      expect(generated(requested, AKH, allOf(...ARCH)), requested).toBe("m15tokentext");
      expect(generated(requested, "Vigilance", allOf(...ARCH, ...TALL)), requested).toBe("m15tokentext");
    }
  });

  it("a random token frame is the height the text asks for, the text box standing in for an unverified tall one — never the textless scrim", () => {
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      expect(generated("random", AKH, allOf(...ARCH, ...TALL), roll), String(roll)).toBe("m15tokentall");
      expect(generated("random", AKH, allOf(...ARCH), roll), String(roll)).toBe("m15tokentext");
    }
  });

  const remix = (template: FrameTemplate, rulesText: string | null, verified: Set<string>) =>
    autoTokenTextBoxFrame({
      template,
      cardType: "token",
      supertype: "Creature",
      rulesText,
      flavorText: null,
      power: "4",
      toughness: "4",
      colorIdentity: ["white"],
      verifiedKeys: verified,
    });

  it("the remix saves the height its final text picks, the text box standing in", () => {
    expect(remix("m15tokentext", AKH, allOf(...ARCH, ...TALL))).toBe("m15tokentall");
    expect(remix("m15tokentext", AKH, allOf(...ARCH))).toBe("m15tokentext");
    expect(remix("m15token", AKH, allOf(...ARCH))).toBe("m15tokentext");
    expect(remix("m15tokentall", "Flying", allOf(...ARCH))).toBe("m15tokentext");
  });

  it("an import that lands on the tall box falls back to the text box, then the textless arch", () => {
    const c = importFrameCandidates({ wanted: "m15tokentall", cardType: "token", supertype: "Creature", rulesText: AKH });
    expect(c.slice(0, 2)).toEqual(["m15tokentall", "m15tokentext"]);
    const a = importFrameCandidates({ wanted: "m15tokenartifacttall", cardType: "token", supertype: "Artifact", rulesText: "x" });
    expect(a.slice(0, 2)).toEqual(["m15tokenartifacttall", "m15tokenartifacttext"]);
  });
});

describe("the profile rides the masters' cut", () => {
  it("moves exactly what the cut moves, by the cut's distance", () => {
    expect(TOKEN_TALL_UP_PX).toBe(TOKEN_TALL_RECIPE.up);
    const up = (TOKEN_TALL_UP_PX / 2100) * 100;
    for (const [tall, text] of [["m15tokentall", "m15tokentext"], ["m15tokenartifacttall", "m15tokenartifacttext"]] as const) {
      const t = getFrameProfile(tall);
      const r = getFrameProfile(text);
      expect(t.type.rect.topPct, tall).toBeCloseTo(r.type.rect.topPct - up, 10);
      expect(t.type.dy, tall).toBe(r.type.dy);
      expect(t.symbolRect!.topPct, tall).toBeCloseTo(r.symbolRect!.topPct - up, 10);
      expect(t.rules.rect.topPct, tall).toBeCloseTo(r.rules.rect.topPct - up, 10);
      // The box's bottom stays.
      expect(t.rules.rect.topPct + t.rules.rect.heightPct, tall).toBeCloseTo(r.rules.rect.topPct + r.rules.rect.heightPct, 10);
      // The art slot: 238 px shorter, the same top and sides.
      expect(t.artSlot.topPct, tall).toBe(r.artSlot.topPct);
      expect(t.artSlot.leftPct, tall).toBe(r.artSlot.leftPct);
      expect(t.artSlot.widthPct, tall).toBe(r.artSlot.widthPct);
      expect(t.artSlot.heightPct, tall).toBeCloseTo(r.artSlot.heightPct - up, 10);
      // Everything else is the text box's: the name (4.53's small caps),
      // the plate, the footer, the collector line.
      expect(t.title, tall).toEqual(r.title);
      expect(t.pt, tall).toEqual(r.pt);
      expect(t.footer, tall).toEqual(r.footer);
      expect(t.collector, tall).toEqual(r.collector);
      expect(t.rules.alignSingleLine, tall).toBe("center");
    }
    // The see-through c's own slot: the text box's c slot, 238 px shorter.
    const c = getFrameProfile("m15tokentall").underFrameArt!;
    const rc = getFrameProfile("m15tokentext").underFrameArt!;
    expect(c.colors).toEqual(["c"]);
    expect(c.artSlot!.heightPct).toBeCloseTo(rc.artSlot!.heightPct - up, 10);
    // The rules box: 5 px inside the drawn box's moved top (1326 px).
    expect((getFrameProfile("m15tokentall").rules.rect.topPct / 100) * 2100).toBeCloseTo(1326, 0);
  });
});

// Owner Round 77: an AI deck remix of a PINNED tall-box printing follows the
// PRINTING onto the tall box once it is verified (as the import lands it) —
// never re-deciding the height from its new text: the SOI Clue's 39
// characters would ask for the regular box. Every other token's remix is
// main's (tests/unit/ai/job-payloads-pinned.test.ts).
describe("the deck remix of a pinned tall-box printing (owner Round 77)", () => {
  const printing = (key: keyof typeof tokenData) => mapScryfallToFormPatch(scryfallCardSchema.parse(tokenData[key]));
  const save = (m: { frame_template: FrameTemplate; printed_height?: true; card_type?: string; supertype?: string; power?: string; toughness?: string; color_identity?: string[] }, rulesText: string, verified: Set<string>) =>
    remixSavedFrame({
      template: m.frame_template,
      printedHeight: m.printed_height === true,
      cardType: m.card_type as never,
      supertype: m.supertype,
      rulesText,
      flavorText: "A new flavour line.",
      power: m.power,
      toughness: m.toughness,
      colorIdentity: (m.color_identity ?? ["colorless"]) as never,
      verifiedKeys: verified,
    });

  it("lands on the tall box once it is verified, and SAVES there with its short text", () => {
    const verified = allOf(...ARCH, ...TALL);
    const clue = scryfallRemixMechanics(printing("tsoi-11"), "Clue", verified);
    expect(clue.ok).toBe(true);
    if (!clue.ok) return;
    expect(clue.mechanics).toMatchObject({ frame_template: "m15tokenartifacttall", printed_height: true });
    expect(save(clue.mechanics, "{2}, Sacrifice this artifact: Draw a card.", verified)).toBe("m15tokenartifacttall");
    const angel = scryfallRemixMechanics(printing("takh-1"), "Angel", verified);
    if (!angel.ok) throw new Error("no landing");
    expect(angel.mechanics).toMatchObject({ frame_template: "m15tokentall", printed_height: true });
    expect(save(angel.mechanics, "Flying", verified)).toBe("m15tokentall");
  });

  it("before the tall box is verified: main's landing and main's save — no flag", () => {
    const verified = allOf(...ARCH);
    const clue = scryfallRemixMechanics(printing("tsoi-11"), "Clue", verified);
    if (!clue.ok) throw new Error("no landing");
    expect(clue.mechanics.frame_template).toBe("m15tokenartifacttext");
    expect("printed_height" in clue.mechanics).toBe(false);
    expect(save(clue.mechanics, "{2}, Sacrifice this artifact: Draw a card.", verified)).toBe("m15tokenartifacttext");
  });

  it("never flags another token: a regular-box printing still follows its text", () => {
    const verified = allOf(...ARCH, ...TALL);
    const knight = scryfallRemixMechanics(printing("tdom-2"), "Knight", verified);
    if (!knight.ok) throw new Error("no landing");
    expect(knight.mechanics.frame_template).toBe("m15tokentext");
    expect("printed_height" in knight.mechanics).toBe(false);
    // …a long new text takes it to the tall box by the text rule, as before.
    expect(save(knight.mechanics, AKH, verified)).toBe("m15tokentall");
    // A tall landing WITHOUT the printing's flag (an own card's kept frame)
    // re-decides by the text — main's rule.
    expect(save({ ...knight.mechanics, frame_template: "m15tokentall" }, "Vigilance", verified)).toBe("m15tokentext");
  });

  it("the request log's pin table names exactly the pins, each on the tall box's template", () => {
    expect(Object.keys(TALL_BOX_TOKEN_PIN_COMBOS).sort()).toEqual(Object.keys(TALL_BOX_TOKEN_PINS).sort());
    for (const [set, numbers] of Object.entries(TALL_BOX_TOKEN_PINS)) {
      expect(Object.keys(TALL_BOX_TOKEN_PIN_COMBOS[set]).sort(), set).toEqual([...numbers].sort());
      for (const [template] of Object.values(TALL_BOX_TOKEN_PIN_COMBOS[set])) expect(TALL, set).toContain(template);
    }
    // The fixtures' two: TAKH #1 white, TSOI #11 the Clue's artifact c.
    expect(TALL_BOX_TOKEN_PIN_COMBOS.takh["1"]).toEqual(["m15tokentall", "w"]);
    expect(TALL_BOX_TOKEN_PIN_COMBOS.tsoi["11"]).toEqual(["m15tokenartifacttall", "c"]);
  });
});

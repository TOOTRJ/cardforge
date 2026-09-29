import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARCH_TOKEN_STANDARD,
  TOKEN_FRAME_LABELS_AFTER_SWITCH,
  TOKEN_SKINS_AFTER_SWITCH,
  TOKEN_STANDARD_ONCE_VERIFIED,
  autoM20TokenFrame,
  followTokenHeight,
  newTokenFrame,
  pinsTokenHeight,
} from "@/lib/creator/token-frame-auto";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, TEMPLATE_SKIN_VARIANTS, type FrameTemplate } from "@/types/card";
import { typeWordFrameFor } from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// TODO 4.48 / 4.50 (owner decisions 2026-09-29): the creator's default
// switch to the full-art token and its automatic height — a module on its
// own, NOT wired into the form until round 11's arch auto-pick merges
// (feat/token-textbox-move); these tests hold its behaviour for that wiring.
// ---------------------------------------------------------------------------

const ALL_M20 = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];
const verified = (...combos: [FrameTemplate, string][]) => new Set(combos.map(([t, k]) => frameComboKey(t, k)));
const everyM20 = (colour: string) => verified(...ALL_M20.map((t) => [t as FrameTemplate, colour] as [FrameTemplate, string]));

const NONE = { rulesText: null, flavorText: null, printsPowerToughness: true, supertype: "Creature" };
const FLYING = { rulesText: "Flying", flavorText: null, printsPowerToughness: true, supertype: "Creature" };
const LONG = {
  rulesText:
    "Whenever you attack, choose one —\n• Create a 1/1 white Rabbit creature token that's tapped and attacking.\n• Attacking creatures you control get +1/+1 until end of turn.",
  flavorText: null,
  printsPowerToughness: true,
  supertype: "Creature",
};
const TREASURE = {
  rulesText: "{T}, Sacrifice this token: Add one mana of any color.",
  flavorText: null,
  printsPowerToughness: false,
  supertype: "Artifact",
};

describe("autoM20TokenFrame — the height the text asks for, dressed by the Artifact word", () => {
  it("picks textless / regular / tall, and the artifact template for an Artifact", () => {
    expect(autoM20TokenFrame(NONE)).toBe("m20token");
    expect(autoM20TokenFrame(FLYING)).toBe("m20tokentext");
    expect(autoM20TokenFrame(LONG)).toBe("m20tokentall");
    expect(autoM20TokenFrame(TREASURE)).toBe("m20tokenartifacttext");
    expect(autoM20TokenFrame({ ...NONE, supertype: "Artifact Creature" })).toBe("m20tokenartifact");
    expect(autoM20TokenFrame({ ...LONG, supertype: "Legendary Artifact Creature" })).toBe("m20tokenartifacttall");
  });
});

describe("newTokenFrame — the default switch (owner 2026-09-29: new tokens default to the full-art design once verified)", () => {
  it("starts on the arch while the full-art template isn't verified in the colour", () => {
    expect(newTokenFrame(FLYING, "w", new Set())).toBe("m15token");
    expect(newTokenFrame(TREASURE, "c", new Set())).toBe("m15tokenartifact");
    // Verified in another colour only.
    expect(newTokenFrame(FLYING, "w", everyM20("u"))).toBe("m15token");
  });

  it("starts on the full-art template the text asks for once it is verified in the colour", () => {
    expect(newTokenFrame(NONE, "w", everyM20("w"))).toBe("m20token");
    expect(newTokenFrame(FLYING, "g", everyM20("g"))).toBe("m20tokentext");
    expect(newTokenFrame(LONG, "b", everyM20("b"))).toBe("m20tokentall");
    expect(newTokenFrame(TREASURE, "c", everyM20("c"))).toBe("m20tokenartifacttext");
    // Only the textless height verified: a token with text keeps the arch.
    expect(newTokenFrame(FLYING, "w", verified(["m20token", "w"]))).toBe("m15token");
  });

  it("names the kind's standard it replaces", () => {
    expect(TOKEN_STANDARD_ONCE_VERIFIED).toBe("m20token");
    expect(ARCH_TOKEN_STANDARD).toBe("m15token");
  });
});

describe("followTokenHeight — automatic, with a manual choice that sticks", () => {
  const base = { heightPinned: false, colorKey: "w", verifiedKeys: everyM20("w") };

  it("follows the text while the user hasn't picked a height", () => {
    expect(followTokenHeight({ ...base, ...NONE, template: "m20token" })).toBe("m20token");
    expect(followTokenHeight({ ...base, ...FLYING, template: "m20token" })).toBe("m20tokentext");
    expect(followTokenHeight({ ...base, ...LONG, template: "m20tokentext" })).toBe("m20tokentall");
    // Text removed: back to no box.
    expect(followTokenHeight({ ...base, ...NONE, template: "m20tokentall" })).toBe("m20token");
  });

  it("keeps a height the user picked, whatever the text — the Artifact word still dresses it", () => {
    const pinned = { ...base, heightPinned: true };
    expect(followTokenHeight({ ...pinned, ...NONE, template: "m20tokentall" })).toBe("m20tokentall");
    expect(followTokenHeight({ ...pinned, ...LONG, template: "m20tokentext" })).toBe("m20tokentext");
    expect(followTokenHeight({ ...pinned, ...LONG, supertype: "Artifact", template: "m20tokentext" })).toBe("m20tokenartifacttext");
    expect(followTokenHeight({ ...pinned, ...NONE, supertype: "Creature", template: "m20tokenartifacttall" })).toBe("m20tokentall");
  });

  it("dresses by the Artifact word at the height the text asks for", () => {
    expect(followTokenHeight({ ...base, ...TREASURE, colorKey: "c", verifiedKeys: everyM20("c"), template: "m20tokentext" })).toBe(
      "m20tokenartifacttext",
    );
  });

  it("never moves a card onto a combo that isn't verified in its colour", () => {
    const onlyTextless = { ...base, verifiedKeys: verified(["m20token", "w"]) };
    expect(followTokenHeight({ ...onlyTextless, ...FLYING, template: "m20token" })).toBe("m20token");
  });

  it("leaves every other frame alone (the arch, a showcase): round 11's pick owns the arch", () => {
    for (const template of ["m15token", "m15tokentext", "m15tokenartifact", "nyx", "m15"] as FrameTemplate[]) {
      expect(followTokenHeight({ ...base, ...LONG, template }), template).toBe(template);
    }
  });
});

describe("pinsTokenHeight — which picks pin the height", () => {
  it("a full-art height other than the automatic one pins; the automatic one and other frames don't", () => {
    expect(pinsTokenHeight("m20tokentall", FLYING)).toBe(true);
    expect(pinsTokenHeight("m20tokentext", FLYING)).toBe(false);
    expect(pinsTokenHeight("m20token", NONE)).toBe(false);
    expect(pinsTokenHeight("m20tokenartifacttext", TREASURE)).toBe(false);
    expect(pinsTokenHeight("m20tokenartifact", TREASURE)).toBe(true);
    expect(pinsTokenHeight("m15token", FLYING)).toBe(false);
  });
});

describe("the tables the switch applies", () => {
  it("names real templates: the full-art family 'Token', the arch 'Token (2014–2019)'", () => {
    for (const t of Object.keys(TOKEN_FRAME_LABELS_AFTER_SWITCH)) expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(t);
    expect(TOKEN_FRAME_LABELS_AFTER_SWITCH.m20token).toBe("Token");
    expect(TOKEN_FRAME_LABELS_AFTER_SWITCH.m15token).toBe("Token (2014–2019)");
    for (const t of ALL_M20) expect(TOKEN_FRAME_LABELS_AFTER_SWITCH[t as FrameTemplate], t).toBeDefined();
  });

  it("keeps every token frame offered: today's variations of the arch are the switch's variations of the full-art standard", () => {
    const today = new Set<FrameTemplate>(["m15token", ...(TEMPLATE_SKIN_VARIANTS.m15token ?? [])]);
    const after = new Set<FrameTemplate>([TOKEN_STANDARD_ONCE_VERIFIED, ...TOKEN_SKINS_AFTER_SWITCH]);
    expect([...after].sort()).toEqual([...today].sort());
  });

  it("each height's artifact template is its Artifact-word dress (4.50)", () => {
    expect(typeWordFrameFor("token", "m20token", "Artifact")).toBe("m20tokenartifact");
    expect(typeWordFrameFor("token", "m20tokentext", "Artifact Creature")).toBe("m20tokenartifacttext");
    expect(typeWordFrameFor("token", "m20tokentall", "Artifact")).toBe("m20tokenartifacttall");
    expect(typeWordFrameFor("token", "m20tokenartifacttall", "Creature")).toBe("m20tokentall");
  });
});

describe("not wired yet (round 11's arch auto-pick lands first)", () => {
  it("no app code imports the module until then", () => {
    const root = process.cwd();
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(name) && /from ["']@\/lib\/creator\/token-frame-auto["']/.test(readFileSync(file, "utf8")))
          importers.push(path.relative(root, file));
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
    expect(importers).toEqual([]);
  });
});

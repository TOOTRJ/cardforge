import { describe, expect, it } from "vitest";
import {
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
} from "@/types/card";
import {
  describeFrame,
  eraGroupFrameLabel,
  setQualifiedFrameLabel,
} from "@/lib/creator/frame-resolve";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { framesForKind } from "@/lib/creator/card-kinds";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";

// Dragon Wing (tarkirdragon) is the Multiverse Legends (MOM 2023) Tarkir
// frame, not a Tarkir: Dragonstorm one. Owner decision 2026-09-25: its label
// is "Dragon Wing (Multiverse Legends)" and it has its own frame set. The
// creator's showcase chips and toasts put the set name in front of the
// template label, so a label that already names its set must not get it
// twice, and it must never say "Tarkir: Dragonstorm".

describe("Dragon Wing lives in its own Multiverse Legends set", () => {
  it("keeps its stored key, with the owner's label and the new set", () => {
    expect(FRAME_TEMPLATE_VALUES).toContain("tarkirdragon");
    expect(FRAME_TEMPLATE_LABELS.tarkirdragon).toBe("Dragon Wing (Multiverse Legends)");
    expect(FRAME_TEMPLATE_SET.tarkirdragon).toBe("multiverselegends");
    expect(FRAME_SET_LABELS.multiverselegends).toBe("Multiverse Legends");
    expect(FRAME_SET_ERA.multiverselegends).toBe("showcase");
    expect(eraForTemplate("tarkirdragon")).toBe("showcase");
  });

  it("the Tarkir: Dragonstorm set is only the TDM frames", () => {
    const tarkir = FRAME_TEMPLATE_VALUES.filter((t) => FRAME_TEMPLATE_SET[t] === "tarkir");
    expect(tarkir).toEqual(["tarkirdraconic", "tarkirghostfire"]);
  });

  it("is still offered as a showcase treatment, right after the Tarkir pair", () => {
    const everything = new Set(
      FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k))),
    );
    const showcase = framesForKind("creature", everything)
      .filter((c) => c.group === "showcase")
      .map((c) => c.template);
    const at = showcase.indexOf("tarkirdragon");
    expect(at).toBeGreaterThan(-1);
    expect(showcase.slice(at - 2, at)).toEqual(["tarkirdraconic", "tarkirghostfire"]);
  });
});

// The `fullart` template is the Zendikar Rising (ZNR) hedron showcase, not
// full art: Scryfall flags none of those printings full_art (full-art
// research 2026-09-26, TODO 0.26). It moves to its own frame set like
// Dragon Wing did; the key stays, because frame_style, frame_reviews and the
// frames bucket store it.
describe("the hedron frame lives in its own Zendikar Rising set", () => {
  it("keeps its stored key and label, in the new set", () => {
    expect(FRAME_TEMPLATE_VALUES).toContain("fullart");
    expect(FRAME_TEMPLATE_LABELS.fullart).toBe("Hedron");
    expect(FRAME_TEMPLATE_SET.fullart).toBe("zendikarrising");
    expect(FRAME_SET_LABELS.zendikarrising).toBe("Zendikar Rising");
    expect(FRAME_SET_ERA.zendikarrising).toBe("showcase");
    expect(eraForTemplate("fullart")).toBe("showcase");
    expect(getFrameProfile("fullart").label).toBe("Zendikar Rising Hedron");
  });

  it("reads Zendikar Rising — Hedron wherever it is named", () => {
    expect(setQualifiedFrameLabel("fullart")).toBe("Zendikar Rising — Hedron");
    expect(describeFrame("fullart")).toBe("Zendikar Rising Hedron");
    expect(eraGroupFrameLabel("fullart")).toBe("Zendikar Rising — Hedron");
    for (const text of [setQualifiedFrameLabel("fullart"), describeFrame("fullart")]) {
      expect(text).not.toMatch(/Full Art/);
    }
  });

  it("leaves the Full Art set with the full-art basic and textless frames only", () => {
    const fullArt = FRAME_TEMPLATE_VALUES.filter((t) => FRAME_TEMPLATE_SET[t] === "fullartset");
    // (…and the older full-art basic designs, TODO 4.40 / 4.41.)
    expect(fullArt).toEqual([
      "m15fullartland", "fullartland", "m15fullartlandzen", "m15fullartlandsnc", "m15fullartlandthb", "m15textless", "m15textlessland",
    ]);
  });

  it("is offered with the showcase set frames — and extended art no longer is", () => {
    const everything = new Set(
      FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k))),
    );
    const gallery = framesForKind("creature", everything);
    const showcase = gallery.filter((c) => c.group === "showcase").map((c) => c.template);
    expect(showcase.indexOf("fullart")).toBe(showcase.indexOf("tarkirdragon") + 1);
    // Extended art is a treatment of the 2015 frame every set prints: an M15
    // variation since 2026-10-13 (frame-picker-groups.test.ts), listed
    // before every showcase.
    expect(showcase).not.toContain("extendedart");
    const extended = gallery.find((c) => c.template === "extendedart");
    expect([extended?.era, extended?.group]).toEqual(["m15", "skin"]);
    expect(gallery.findIndex((c) => c.template === "extendedart")).toBeLessThan(
      gallery.findIndex((c) => c.group === "showcase"),
    );
  });
});

describe("eraGroupFrameLabel", () => {
  it("names the set of a showcase frame and nothing else", () => {
    expect(eraGroupFrameLabel("lotr")).toBe("The Lord of the Rings — Ring");
    // The full-art basics are M15 variations (2026-10-13): no set in
    // front, and a label that says "Full-Art" itself.
    expect(eraGroupFrameLabel("m15fullartland")).toBe("Full-Art Basic Land");
    expect(eraGroupFrameLabel("fullartland")).toBe("Borderless Full-Art Basic Land");
    expect(eraGroupFrameLabel("expeditionland")).toBe("Expeditions — Land");
    expect(eraGroupFrameLabel("nyx")).toBe("Nyx — Constellation");
    expect(eraGroupFrameLabel("m15borderless")).toBe("Borderless");
    expect(eraGroupFrameLabel("tarkirdragon")).toBe("Dragon Wing (Multiverse Legends)");
    expect(eraGroupFrameLabel("m15snow")).toBe("Snow");
    expect(eraGroupFrameLabel("retroland")).toBe("Land");
  });
});

describe("setQualifiedFrameLabel / describeFrame", () => {
  it("prints a self-naming label once, without any Tarkir set", () => {
    expect(setQualifiedFrameLabel("tarkirdragon")).toBe("Dragon Wing (Multiverse Legends)");
    expect(describeFrame("tarkirdragon")).toBe("Dragon Wing (Multiverse Legends)");
    for (const text of [setQualifiedFrameLabel("tarkirdragon"), describeFrame("tarkirdragon")]) {
      expect(text).not.toMatch(/Tarkir|Multiverse Legends.*Multiverse Legends/);
    }
  });

  it("still puts the set name in front of set-relative showcase labels", () => {
    expect(setQualifiedFrameLabel("tarkirdraconic")).toBe("Tarkir: Dragonstorm — Draconic");
    expect(setQualifiedFrameLabel("lotr")).toBe("The Lord of the Rings — Ring");
    expect(describeFrame("tarkirghostfire")).toBe("Tarkir: Dragonstorm Ghostfire");
    expect(describeFrame("lotrscroll")).toBe("The Lord of the Rings Scroll");
  });

  it("only the labels that already name their set skip the prefix", () => {
    const showcase = FRAME_TEMPLATE_VALUES.filter((t) => eraForTemplate(t) === "showcase");
    const unprefixed = showcase.filter((t) => setQualifiedFrameLabel(t) === FRAME_TEMPLATE_LABELS[t]);
    // (extendedart's label is its set's too, but it is an M15 variation
    // since 2026-10-13 — and no M15 treatment is ever set-qualified.)
    expect(unprefixed).toEqual(["tarkirdragon"]);
    for (const template of ["extendedart", "m15fullartland", "fullartland", "m15textless", "m15textlessland"] as const) {
      expect(eraForTemplate(template)).toBe("m15");
      expect(setQualifiedFrameLabel(template)).toBe(FRAME_TEMPLATE_LABELS[template]);
      expect(describeFrame(template)).toBe(`M15 (2015) ${FRAME_TEMPLATE_LABELS[template]}`);
    }
  });

  it("border-era frames are still described by their era", () => {
    expect(describeFrame("m15snow")).toBe("M15 (2015) Snow");
    expect(describeFrame("agclassic")).toBe("Classic (1993) Standard");
  });
});

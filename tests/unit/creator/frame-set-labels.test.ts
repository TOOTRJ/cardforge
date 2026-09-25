import { describe, expect, it } from "vitest";
import {
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
} from "@/types/card";
import { describeFrame, setQualifiedFrameLabel } from "@/lib/creator/frame-resolve";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { framesForKind } from "@/lib/creator/card-kinds";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

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
    // extendedart's label IS its set's ("Extended Art"), which was already
    // collapsed before this change.
    expect(unprefixed).toEqual(["tarkirdragon", "extendedart"]);
  });

  it("border-era frames are still described by their era", () => {
    expect(describeFrame("m15snow")).toBe("M15 (2015) Snow");
    expect(describeFrame("agclassic")).toBe("Classic (1993) Standard");
  });
});

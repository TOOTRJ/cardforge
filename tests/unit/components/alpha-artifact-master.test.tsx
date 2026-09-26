// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { FrameThumb } from "@/components/creator/frame-pickers";
import {
  frameColorKeysFor,
  frameMasterKey,
  frameMasterKeyForColor,
  isArtifactFrameType,
} from "@/components/cards/frame-layer";
import { frameGateError } from "@/lib/cards/frame-availability";
import { FRAME_COLOR_KEYS, FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Alpha's colourless ARTIFACT paints the brown artifact card, agclassic/a.png
// (MSE's acard.jpg); every other colourless Alpha card keeps the grey
// agclassic/c.png (ccard.jpg) — owner decision 2026-09-25, TODO 4.31. ONE
// rule (frameMasterKey, FrameProfile.artifactMasterKeys) picks the master for
// the preview, the bake, the foil and etched masks, the bake's preload and
// the creator's tiles; the colour key (the frame_reviews gate, plates) stays
// "c". The bake half is pinned on real bakes in
// tests/unit/render/bake-followups.test.ts.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const agclassic = getFrameProfile("agclassic");

describe("isArtifactFrameType", () => {
  it.each<[string, { cardType?: string | null; supertype?: string | null } | null, boolean]>([
    ["the Artifact card type (Jester's Mask, Sol Ring)", { cardType: "artifact" }, true],
    ["an Artifact Creature (Juggernaut)", { cardType: "creature", supertype: "Artifact" }, true],
    ["a Legendary Artifact Creature", { cardType: "creature", supertype: "Legendary Artifact" }, true],
    ["any case", { cardType: "creature", supertype: "legendary ARTIFACT" }, true],
    ["a creature (Dawn Treader)", { cardType: "creature", supertype: "Legendary" }, false],
    ["a land", { cardType: "land", supertype: "Basic" }, false],
    ["a word that only contains it", { cardType: "creature", supertype: "Artifactual" }, false],
    ["no type at all", { cardType: null, supertype: null }, false],
    ["nothing", null, false],
  ])("%s", (_label, type, want) => {
    expect(isArtifactFrameType(type)).toBe(want);
  });
});

describe("frameMasterKey — the one master rule", () => {
  it("agclassic: a colourless artifact paints a, a colourless non-artifact c", () => {
    expect(frameMasterKey(agclassic, ["colorless"], { cardType: "artifact" })).toBe("a");
    expect(frameMasterKey(agclassic, [], { cardType: "artifact" })).toBe("a");
    expect(frameMasterKey(agclassic, [], { cardType: "creature", supertype: "Artifact" })).toBe("a");
    // Dawn Treader: a colourless (empty identity) legendary creature.
    expect(frameMasterKey(agclassic, [], { cardType: "creature", supertype: "Legendary" })).toBe("c");
    expect(frameMasterKey(agclassic, ["colorless"], { cardType: "land" })).toBe("c");
    expect(frameMasterKey(agclassic, ["colorless"], null)).toBe("c");
  });

  it("agclassic: a coloured artifact keeps its colour's frame", () => {
    for (const [colors, key] of [[["black"], "b"], [["white"], "w"], [["white", "blue"], "m"], [["multicolor"], "m"]] as const) {
      expect(frameMasterKey(agclassic, [...colors] as ColorIdentity[], { cardType: "artifact" })).toBe(key);
    }
  });

  it("only agclassic dresses a colour by type: every other template paints the colour key", () => {
    const identities: ColorIdentity[][] = [["white"], ["blue"], ["black"], ["red"], ["green"], ["colorless"], [], ["white", "blue"]];
    for (const t of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(t);
      expect(Boolean(profile.artifactMasterKeys), t).toBe(t === "agclassic");
      if (t === "agclassic") continue;
      for (const colors of identities) {
        for (const cardType of ["artifact", "creature"] as const) {
          const [key] = frameColorKeysFor(profile, colors, { cardType, supertype: "Artifact" });
          expect(frameColorKeysFor(profile, colors, null)[0], `${t} ${colors}`).toBe(key);
        }
      }
    }
    expect(getFrameProfile("agclassic").artifactMasterKeys).toEqual({ c: "a" });
  });

  it("every type-dressed master is a known master key and ships a PNG and its WebP twin", () => {
    // The bake's loader only reads FRAME_MASTER_KEYS (anything else falls
    // back to "c"), and the browser has no PNG fallback.
    expect([...FRAME_MASTER_KEYS]).toEqual([...FRAME_COLOR_KEYS, "a"]);
    for (const t of FRAME_TEMPLATE_VALUES) {
      for (const master of Object.values(getFrameProfile(t).artifactMasterKeys ?? {})) {
        expect(FRAME_MASTER_KEYS, `${t}/${master}`).toContain(master);
        expect(existsSync(`public/frames/${t}/${master}.png`), `${t}/${master}.png`).toBe(true);
        expect(existsSync(`public/frames/${t}/${master}.webp`), `${t}/${master}.webp`).toBe(true);
      }
    }
  });

  it("frameColorKeysFor (the bake's preload) carries the artifact master", () => {
    expect(frameColorKeysFor(agclassic, ["colorless"], { cardType: "artifact" })).toEqual(["a"]);
    expect(frameColorKeysFor(agclassic, [], { cardType: "creature" })).toEqual(["c"]);
  });

  it("the frame_reviews gate stays per colour: agclassic/c publishes both of its masters", () => {
    const verified = new Set(["agclassic/c"]);
    expect(frameGateError("agclassic", ["colorless"], verified)).toBeNull();
    expect(frameGateError("agclassic", ["colorless"], new Set())).toMatch(/colorless/);
    // There is no separate "a" row to verify — it is not a colour.
    expect(frameGateError("agclassic", ["colorless"], new Set(["agclassic/a"]))).not.toBeNull();
  });
});

function preview(over: { cardType: CardType; supertype?: string | null; colorIdentity: ColorIdentity[]; template?: FrameTemplate; finish?: "regular" | "foil" | "etched" }) {
  return render(
    <CardPreview
      title="Probe"
      cardType={over.cardType}
      supertype={over.supertype ?? null}
      colorIdentity={over.colorIdentity}
      frameStyle={{ template: over.template ?? "agclassic", finish: over.finish ?? "regular" }}
    />,
  ).container;
}

describe("CardPreview — the artifact card on the preview, its foil and its etched sheen", () => {
  it("Jester's Mask (a colourless artifact) paints agclassic/a; Dawn Treader (a colourless creature) agclassic/c", () => {
    const mask = preview({ cardType: "artifact", colorIdentity: ["colorless"] });
    const maskFrame = mask.querySelector<HTMLElement>("[data-frame-key]");
    expect(maskFrame?.dataset.frameKey).toBe("a");
    expect(maskFrame?.style.backgroundImage).toContain("/frames/agclassic/a.webp");
    expect(mask.innerHTML).not.toContain("/frames/agclassic/c.webp");
    cleanup();
    const treader = preview({ cardType: "creature", supertype: "Legendary", colorIdentity: [] });
    const treaderFrame = treader.querySelector<HTMLElement>("[data-frame-key]");
    expect(treaderFrame?.dataset.frameKey).toBe("c");
    expect(treaderFrame?.style.backgroundImage).toContain("/frames/agclassic/c.webp");
    expect(treader.innerHTML).not.toContain("/frames/agclassic/a.webp");
  });

  it.each(["foil", "etched"] as const)("%s: the sheen masks with the master the card paints", (finish) => {
    const mask = preview({ cardType: "artifact", colorIdentity: ["colorless"], finish });
    const hrefs = [...mask.querySelectorAll("mask image")].map((i) => i.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("/frames/agclassic/a.webp")), finish).toBe(true);
    expect(hrefs.some((h) => h.includes("/frames/agclassic/c.webp")), finish).toBe(false);
    cleanup();
    const treader = preview({ cardType: "creature", colorIdentity: [], finish });
    const treaderHrefs = [...treader.querySelectorAll("mask image")].map((i) => i.getAttribute("href") ?? "");
    expect(treaderHrefs.some((h) => h.includes("/frames/agclassic/c.webp")), finish).toBe(true);
    expect(treaderHrefs.some((h) => h.includes("/frames/agclassic/a.webp")), finish).toBe(false);
  });

  it("alphaland has one land frame per colour: a colourless artifact land keeps c", () => {
    const land = preview({ cardType: "land", supertype: "Artifact", colorIdentity: ["colorless"], template: "alphaland" });
    expect(land.querySelector<HTMLElement>("[data-frame-key]")?.dataset.frameKey).toBe("c");
  });
});

describe("FrameThumb — the creator's colour tile shows the master the card would paint", () => {
  const tile = (template: FrameTemplate, colorKey: string, type: { cardType?: string | null; supertype?: string | null } | null) =>
    render(<FrameThumb template={template} colorKey={colorKey} type={type} />).container.firstElementChild as HTMLElement;

  it("agclassic's colourless tile is the artifact card for an artifact, the grey card otherwise", () => {
    const artifact = tile("agclassic", "c", { cardType: "artifact" });
    expect(artifact.dataset.frameKey).toBe("a");
    expect(artifact.style.backgroundImage).toContain("/frames/agclassic/a.webp");
    const juggernaut = tile("agclassic", "c", { cardType: "creature", supertype: "Artifact" });
    expect(juggernaut.dataset.frameKey).toBe("a");
    const creature = tile("agclassic", "c", { cardType: "creature" });
    expect(creature.dataset.frameKey).toBe("c");
    expect(creature.style.backgroundImage).toContain("/frames/agclassic/c.webp");
    expect(tile("agclassic", "c", null).dataset.frameKey).toBe("c");
  });

  it("every other tile shows its colour: coloured artifacts, other templates", () => {
    expect(tile("agclassic", "b", { cardType: "artifact" }).dataset.frameKey).toBe("b");
    expect(tile("alphaland", "c", { cardType: "artifact" }).dataset.frameKey).toBe("c");
    expect(tile("retro", "c", { cardType: "artifact" }).dataset.frameKey).toBe("c");
    expect(frameMasterKeyForColor(getFrameProfile("m15artifact"), "c", { cardType: "artifact" })).toBe("c");
  });
});

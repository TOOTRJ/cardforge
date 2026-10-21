import { describe, expect, it } from "vitest";
import printings from "./fixtures/nickname-printings.json";
import plain from "./fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";
import { resolveNickname } from "@/lib/cards/nickname";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 6.3 — Scryfall's `flavor_name` imports as the card's nickname (the
// fixtures: Scryfall's own JSON, captured 2026-10-21 — MSC #282 / #288, SLD
// #697 / #1186, TMC #54, IKO #275 and VOW #338). The card keeps its Oracle
// name as its title; the nickname is what the title bar prints.
// ---------------------------------------------------------------------------

const card = (key: keyof typeof printings) => scryfallCardSchema.parse(printings[key]);

describe("the import of a flavour-name printing", () => {
  it.each([
    ["msc-282", "Fleecemane Lion", "Wakandan War Panther", "m15"],
    ["msc-288", "Mind's Eye", "Panther Idol", "m15artifact"],
    ["sld-697", "Command Tower", "Summoner's Rift", "m15land"],
    ["sld-1186", "K'rrik, Son of Yawgmoth", "Post, Son of Rich", "m15"],
    ["tmc-54", "Voracious Hydra", "Aggro Amalgam", "m15"],
  ] as const)("%s: the Oracle name is the title, the flavour name the nickname, drawn on its landing", (key, title, nickname, template) => {
    const patch = mapScryfallToFormPatch(card(key));
    expect(patch.title).toBe(title);
    expect(patch.nickname).toBe(nickname);
    expect(patch.frame_template).toBe(template);
    // The landing frame prints the plate: the nickname in the title bar,
    // the Oracle name under it — what the printing shows.
    const drawn = resolveNickname(getFrameProfile(template), patch.nickname, title, "g");
    expect(drawn?.titleText).toBe(nickname);
    expect(drawn?.line.text).toBe(title);
    // …and the import dialog's preview carries it.
    expect(previewFromImportPatch(patch, title, template).nickname).toBe(nickname);
  });

  it("a double-faced printing takes its FRONT face's flavour name (VOW #338)", () => {
    const patch = mapScryfallToFormPatch(card("vow-338"));
    expect(patch.title).toBe("Voldaren Bloodcaster");
    expect(patch.nickname).toBe("Dracula, Lord of Blood");
  });

  it("a borderless one keeps its nickname gap (the borderless plate is a follow-up), and its nickname", () => {
    const patch = mapScryfallToFormPatch(card("iko-275"));
    expect(patch.nickname).toBe("Godzilla, King of the Monsters");
    expect(patch.frame_match?.status).not.toBe("exact");
    expect(patch.frame_match?.gaps).toContain("nickname");
  });

  it("a printing without one names no nickname key — its patch is what it was", () => {
    for (const raw of Object.values(plain).slice(0, 25)) {
      const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(raw));
      expect(patch).not.toHaveProperty("nickname");
      expect(previewFromImportPatch(patch, "x", "m15")).not.toHaveProperty("nickname");
    }
  });
});

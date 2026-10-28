// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The AI fill dialog's theme, style, kind and frame (the AI dialog redesign,
// PR 1; owner, milestone 1). The kinds are the one-faced kinds the AI can
// make; the frames are EVERY frame of the kind published in some colour —
// the dresses too (Nyx and the artifact frame on a creature, the Vehicle,
// the token's text box and height): the design is made for the frame picked
// (lib/ai/frame-brief.ts). A colour the card keeps leaves a frame not
// published in it as an off chip with its reason. Single-select rows are
// one tab stop; labels print as written.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/credit-meter", () => ({ CreditMeter: () => null }));

import { AiFillDialog, type AiFillOptions } from "@/components/creator/ai-fill-dialog";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { CardFillField } from "@/lib/ai/card-fill-shared";
import type { FrameColorKey } from "@/lib/creator/card-kinds";

const ALL_COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  ...["m15", "m15artifact", "m15snow", "m15token", "m15tokenartifact", "m15tokentext", "m20token", "m20tokentall", "m15vehicle"].flatMap(
    (template) => ALL_COLOURS.map((colour) => frameComboKey(template, colour)),
  ),
  // Nyx in white and blue only.
  frameComboKey("m15nyx", "w"),
  frameComboKey("m15nyx", "u"),
];

afterEach(cleanup);

function open({
  fields = ["card_type", "color_identity", "title", "art"] as CardFillField[],
  colorKey = null as FrameColorKey | null,
} = {}) {
  const onGenerate = vi.fn<(options: AiFillOptions) => void>();
  render(
    <AiFillDialog
      open
      onOpenChange={() => {}}
      initialFields={fields}
      revise={false}
      statsLabel="Power / toughness"
      statsAvailable
      verifiedFrameKeys={VERIFIED}
      colorKey={colorKey}
      generating={false}
      onGenerate={onGenerate}
    />,
  );
  return onGenerate;
}

const group = (name: string) => screen.getByRole("radiogroup", { name });
const pickKind = (label: string) => fireEvent.click(within(group("Card kind")).getByRole("radio", { name: new RegExp(`^${label}`) }));
const openFrames = () => fireEvent.click(screen.getByRole("button", { name: /Choose a frame/ }));
const frameRadio = (name: RegExp) => within(screen.getByRole("radiogroup", { name: /^Frames for/ })).getByRole("radio", { name });
const generate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Generate/ }));
  });
};

describe("AI fill dialog — kinds", () => {
  it("lists the one-faced kinds the AI can make, never a battle, saga, two-part, double-faced card or emblem", () => {
    open();
    const kinds = within(group("Card kind")).getAllByRole("radio").map((chip) => chip.textContent);
    expect(kinds).toEqual(["Surprise me", "Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Planeswalker", "Token"]);
  });

  it("a kind with no published frame is an off chip that says why", () => {
    open();
    const walker = within(group("Card kind")).getByRole("radio", { name: /^Planeswalker/ });
    expect(walker.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(walker);
    expect(walker.getAttribute("aria-checked")).toBe("false");
  });

  it("is not offered while the card type isn't being written", () => {
    open({ fields: ["title", "art"] });
    expect(screen.queryByRole("radiogroup", { name: "Card kind" })).toBeNull();
  });
});

describe("AI fill dialog — frames", () => {
  it("offers the dresses a creature can wear, each designed for (owner, milestone 1)", () => {
    open();
    pickKind("Creature");
    openFrames();
    for (const name of [/^Standard/, /^Snow/, /^Artifact/, /^Nyx/]) {
      expect(frameRadio(name).getAttribute("aria-disabled"), String(name)).toBeNull();
    }
  });

  it("offers a token its text boxes and heights, an artifact its Vehicle frame", () => {
    open();
    pickKind("Token");
    openFrames();
    for (const name of [/^Token \(2014–2019\)\s*M15/, /^Artifact Token \(2014–2019\)/, /^Token \(2014–2019\), text box/, /^Token, tall text box/]) {
      expect(frameRadio(name), String(name)).toBeTruthy();
    }
    cleanup();
    open();
    pickKind("Artifact");
    openFrames();
    expect(frameRadio(/^Vehicle/)).toBeTruthy();
  });

  it("a KEPT colour leaves a frame not published in it off, with its reason; a free colour offers it", () => {
    open({ fields: ["card_type", "title"], colorKey: "r" });
    pickKind("Creature");
    openFrames();
    const nyx = frameRadio(/^Nyx/);
    expect(nyx.getAttribute("aria-disabled")).toBe("true");
    expect(nyx.textContent).toContain("Not published in red yet");
    cleanup();
    open({ colorKey: "r" });
    pickKind("Creature");
    openFrames();
    expect(frameRadio(/^Nyx/).getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(frameRadio(/^Nyx/));
    expect(screen.getByText(/designed for Nyx, in white or blue/)).toBeTruthy();
  });

  it("each single-select row is one tab stop, its labels as written", () => {
    open();
    for (const name of ["Theme presets", "Art style presets", "Card kind"]) {
      const chips = within(group(name)).getAllByRole("radio");
      expect(chips.filter((chip) => chip.tabIndex !== -1), name).toHaveLength(1);
    }
    const ink = within(group("Art style presets")).getByRole("radio", { name: "Ink and wash" });
    expect(ink.querySelector(".capitalize")).toBeNull();
  });
});

describe("AI fill dialog — what Generate sends", () => {
  it("Surprise me everywhere: the kind and frame left to the AI, no preset words", async () => {
    const onGenerate = open();
    await generate();
    expect(onGenerate.mock.calls[0]![0]).toEqual({
      want: ["title", "art", "card_type", "color_identity"],
      theme_preset: undefined,
      theme_twist: undefined,
      style_preset: undefined,
      style_twist: undefined,
      design_kind: "surprise",
      card_type: undefined,
      rarity: undefined,
      frame: "random",
      deck_id: undefined,
    });
  });

  it("presets, twists, a kind and a frame — the server assembles the words", async () => {
    const onGenerate = open();
    fireEvent.click(within(group("Theme presets")).getByRole("radio", { name: "Gothic horror" }));
    fireEvent.change(screen.getByLabelText(/Your twist on the theme/), { target: { value: "  lighthouse keepers " } });
    fireEvent.click(within(group("Art style presets")).getByRole("radio", { name: "Stained glass" }));
    pickKind("Creature");
    openFrames();
    fireEvent.click(frameRadio(/^Nyx/));
    await generate();
    expect(onGenerate.mock.calls[0]![0]).toMatchObject({
      theme_preset: "gothic-horror",
      theme_twist: "lighthouse keepers",
      style_preset: "stained-glass",
      design_kind: "creature",
      card_type: "creature",
      frame: "m15nyx",
    });
    expect(onGenerate.mock.calls[0]![0]).not.toHaveProperty("theme");
  });

  it("a twist is capped at 160 characters", () => {
    open();
    const input = screen.getByLabelText(/Your twist on the style/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(300) } });
    expect(input.value).toHaveLength(160);
  });

  it("a new kind starts its frame on Surprise me", async () => {
    const onGenerate = open();
    pickKind("Creature");
    openFrames();
    fireEvent.click(frameRadio(/^Nyx/));
    pickKind("Artifact");
    await generate();
    expect(onGenerate.mock.calls[0]![0]).toMatchObject({ design_kind: "artifact", frame: "random" });
  });
});

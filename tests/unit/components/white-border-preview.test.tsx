// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { CardPreview } from "@/components/cards/card-preview";
import { AnatomyPanel } from "@/components/creator/panels/anatomy-panel";
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { whiteBorderDataUrl } from "@/lib/cards/white-border";
import type { FormValues } from "@/lib/creator/form-types";
import type { FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.30 in the browser: the PREVIEW draws the white border from the same
// data: URL the bake draws (lib/cards/white-border.ts — one image over the
// whole card, right after the frame, under every text layer), only for a
// card whose switch says "white" on a frame that declares it; and the
// creator's switch — off on a new card, shown only on those frames, writing
// "white" / "black" into the form. The bake half:
// tests/unit/render/white-border-bake.test.tsx; in Chromium at 750 and HD:
// the PR's parity run.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function preview(frameStyle: Record<string, unknown>) {
  const { container } = render(
    <CardPreview
      title="Border Sentinel"
      cost="{2}{R}"
      cardType="creature"
      subtypes={["Soldier"]}
      colorIdentity={["red"]}
      rulesText="Vigilance"
      power="2"
      toughness="3"
      artistCredit="A. Painter"
      frameStyle={frameStyle as FrameStyle}
      brandMark
    />,
  );
  return container;
}

describe("CardPreview — the white border", () => {
  it.each(["retro", "modern"])("%s: one image over the whole card, the bake's own bytes, over the frame", (template) => {
    const container = preview({ template, border: "white" });
    const images = container.querySelectorAll<HTMLImageElement>("[data-white-border]");
    expect(images).toHaveLength(1);
    const img = images[0];
    expect(img.getAttribute("src")).toBe(whiteBorderDataUrl(getFrameProfile(template).whiteBorder!));
    expect(img.className).toContain("absolute");
    expect(img.className).toContain("inset-0");
    expect(img.style.zIndex).toBe("5");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });

  it("nothing for a black-bordered card, an unknown value, or a frame that declares no white border", () => {
    for (const style of [{ template: "modern" }, { template: "modern", border: "black" }, { template: "modern", border: "silver" }, { template: "m15", border: "white" }, { template: "agclassic", border: "white" }]) {
      expect(preview(style).querySelector("[data-white-border]"), JSON.stringify(style)).toBeNull();
      cleanup();
    }
  });

  it("changes no text layer: the same footer, mark and name markup as the black-bordered card", () => {
    const strip = (html: string) => html.replace(/<img[^>]*data-white-border[^>]*>/, "");
    const white = strip(preview({ template: "modern", border: "white" }).innerHTML);
    cleanup();
    const black = preview({ template: "modern" }).innerHTML;
    expect(white).toBe(black);
  });
});

function Harness({ template, stored = false, border }: { template: string; stored?: boolean; border?: "white" }) {
  const frameStyle = (stored ? { template, ...(border ? { border } : {}) } : { template, ...NEW_CARD_ANATOMY }) as FrameStyle;
  const methods = useForm<FormValues>({
    defaultValues: {
      card_type: "creature",
      supertype: "",
      cost: "{2}{R}",
      color_identity: ["red"],
      frame_style: frameStyle,
      title: "",
      subtypes_text: "",
    } as Partial<FormValues> as FormValues,
  });
  const style = useWatch({ control: methods.control, name: "frame_style" });
  return (
    <FormProvider {...methods}>
      <AnatomyPanel which={["twoColor", "border"]} stored={stored ? { frameStyle, colorIdentity: ["red"] } : null} pairRow={false} />
      <output data-testid="style">{JSON.stringify(style)}</output>
    </FormProvider>
  );
}
const borderSwitch = () => screen.queryByRole("switch", { name: "White border" });
const style = () => JSON.parse(screen.getByTestId("style").textContent ?? "{}") as Record<string, unknown>;

describe("the creator's switch", () => {
  it.each(["retro", "retroland", "modern", "modernland"])("%s: shown, OFF on a new card, with plain copy and no hint", (template) => {
    render(<Harness template={template} />);
    const sw = borderSwitch();
    expect(sw).not.toBeNull();
    expect(sw!.getAttribute("aria-checked")).toBe("false");
    expect("border" in style()).toBe(false);
    expect(screen.getByText(/As core sets printed until 2007/)).toBeTruthy();
    expect(screen.queryByTestId("anatomy-hint-border")).toBeNull();
  });

  it("on writes \"white\", off writes \"black\" (never stored — the save drops it)", () => {
    render(<Harness template="modern" />);
    fireEvent.click(borderSwitch()!);
    expect(style().border).toBe("white");
    expect(borderSwitch()!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(borderSwitch()!);
    expect(style().border).toBe("black");
    expect(borderSwitch()!.getAttribute("aria-checked")).toBe("false");
  });

  it("a stored white-bordered card opens with it on; a stored black one off, with no \"New:\" hint", () => {
    render(<Harness template="retro" stored border="white" />);
    expect(borderSwitch()!.getAttribute("aria-checked")).toBe("true");
    cleanup();
    render(<Harness template="retro" stored />);
    expect(borderSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("anatomy-hint-border")).toBeNull();
  });

  it.each(["m15", "agclassic", "alphaland", "m15borderless", "split"])("%s: not shown — the frame draws no white border", (template) => {
    render(<Harness template={template} />);
    expect(borderSwitch()).toBeNull();
  });
});

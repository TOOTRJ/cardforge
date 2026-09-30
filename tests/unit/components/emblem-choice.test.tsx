// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { ColorIdentity } from "@/types/card";
import type { CardKind } from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// TODO 6.23 / 3b.15's seam (owner decision 2026-09-29): the Emblem choice
// sits inside the Token kind, next to Creature / Artifact / Enchantment —
// not as its own chip in the kind picker. It switches the card to the emblem
// kind (and off again, back to the token kind); it shows "Soon" until the
// emblem frame is verified; an emblem shows only it, and no colour picker
// (an emblem is colourless).
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

const TOKEN_VERIFIED = [frameComboKey("m15token", "c"), frameComboKey("m15", "c")];

function Harness({ kind, verified, onKind }: { kind: CardKind; verified: string[]; onKind: (k: CardKind) => void }) {
  const methods = useForm({
    defaultValues: {
      card_type: kind,
      frame_style: { template: kind === "emblem" ? "emblem" : "m15token" },
      color_identity: ["colorless"] as ColorIdentity[],
      title: "",
      supertype: kind === "token" ? "Creature" : "",
      subtypes_text: "",
    },
  });
  const color = useWatch({ control: methods.control, name: "color_identity" }) as ColorIdentity[];
  return (
    <FormProvider {...methods}>
      <CardSetupPanel kind={kind} colorIdentity={color} verifiedFrameKeys={verified} onKindSelect={onKind} />
    </FormProvider>
  );
}

const emblemToggle = () => within(screen.getByRole("group", { name: "Emblem" })).getByRole("button", { name: /Emblem/ });

afterEach(() => cleanup());

describe("the Emblem choice inside the Token kind", () => {
  it("is not a kind chip: the kind picker has no Emblem, and lights Token for an emblem", () => {
    render(<Harness kind="emblem" verified={[...TOKEN_VERIFIED, frameComboKey("emblem", "c")]} onKind={() => {}} />);
    const kinds = screen.getByRole("radiogroup", { name: "Card type" });
    expect(within(kinds).queryByRole("radio", { name: /^Emblem/ })).toBeNull();
    expect(within(kinds).getByRole("radio", { name: /^Token/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("sits next to the token's types and switches the card to the emblem kind once the frame is verified", () => {
    const onKind = vi.fn();
    render(<Harness kind="token" verified={[...TOKEN_VERIFIED, frameComboKey("emblem", "c")]} onKind={onKind} />);
    expect(screen.getByRole("group", { name: "Token types" })).toBeTruthy();
    const toggle = emblemToggle();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle);
    expect(onKind).toHaveBeenCalledWith("emblem");
  });

  it("shows Soon until emblem/c is verified", () => {
    const onKind = vi.fn();
    render(<Harness kind="token" verified={TOKEN_VERIFIED} onKind={onKind} />);
    const toggle = emblemToggle();
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.textContent).toMatch(/awaiting verification/);
    fireEvent.click(toggle);
    expect(onKind).not.toHaveBeenCalled();
  });

  it("on an emblem: only the Emblem choice (on), turning it off makes a token again; no colour picker", () => {
    const onKind = vi.fn();
    render(<Harness kind="emblem" verified={[...TOKEN_VERIFIED, frameComboKey("emblem", "c")]} onKind={onKind} />);
    expect(screen.queryByRole("group", { name: "Token types" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Color identity" })).toBeNull();
    const toggle = emblemToggle();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onKind).toHaveBeenCalledWith("token");
  });
});

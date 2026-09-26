// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The AI fill dialog's Frame list (TODO 1.7). A creature borrows the M15
// artifact frame as a variation for Artifact Creatures, but the dialog can't
// ask the designer for one — and the job refuses the frame for a plain
// creature (resolveGeneratedFrame) — so, like the basic-only full-art land
// frame, it is never offered here. The Artifact type still offers it: it is
// that type's own standard.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/credit-meter", () => ({ CreditMeter: () => null }));

import { AiFillDialog } from "@/components/creator/ai-fill-dialog";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

const VERIFIED = ["m15", "m15artifact", "m15snow"].flatMap((template) =>
  ["w", "c"].map((colour) => frameComboKey(template, colour)),
);

afterEach(cleanup);

function frameOptionsFor(cardType: string): string[] {
  render(
    <AiFillDialog
      open
      onOpenChange={() => {}}
      initialFields={["card_type"]}
      revise={false}
      statsLabel="Power / toughness"
      statsAvailable
      verifiedFrameKeys={VERIFIED}
      generating={false}
      onGenerate={() => {}}
    />,
  );
  const [typeSelect, frameSelect] = screen
    .getAllByRole("combobox")
    .filter((el) => el.tagName === "SELECT") as HTMLSelectElement[];
  fireEvent.change(typeSelect, { target: { value: cardType } });
  return Array.from(frameSelect.options).map((option) => option.value);
}

describe("AI fill dialog — frame options", () => {
  it("never offers a creature the artifact frame it borrows", () => {
    const options = frameOptionsFor("creature");
    expect(options).toContain("m15");
    expect(options).toContain("m15snow");
    expect(options).not.toContain("m15artifact");
  });

  it("offers the Artifact type its own standard frame", () => {
    expect(frameOptionsFor("artifact")).toContain("m15artifact");
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.23 (CR 114) in the AI fill dialog: an emblem has no mana cost,
// colour, rarity or stats, so on an open emblem the dialog offers none of
// them (EMBLEM_UNFILLED_FIELDS, passed by the creator as `hiddenFields`) —
// not even when the Text step's preset ticks cost and rarity — and never
// asks the designer for one. Any other card is unchanged.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/credit-meter", () => ({ CreditMeter: () => null }));

import { AiFillDialog, type AiFillOptions } from "@/components/creator/ai-fill-dialog";
import { EMBLEM_UNFILLED_FIELDS, FILL_PRESETS } from "@/lib/ai/card-fill-shared";

afterEach(cleanup);

function open(hiddenFields?: readonly (typeof EMBLEM_UNFILLED_FIELDS)[number][]) {
  const onGenerate = vi.fn<(options: AiFillOptions) => void>();
  render(
    <AiFillDialog
      open
      onOpenChange={() => {}}
      initialFields={[...FILL_PRESETS.textStep]}
      revise={false}
      statsLabel="Power / toughness"
      statsAvailable
      verifiedFrameKeys={[]}
      generating={false}
      onGenerate={onGenerate}
      hiddenFields={hiddenFields}
    />,
  );
  return onGenerate;
}

const offered = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>("[data-testid^='fill-']")).map((el) =>
    (el.dataset.testid ?? "").replace("fill-", ""),
  );

describe("the AI fill dialog on an emblem", () => {
  it("offers no cost, colour, rarity or stats, and never asks for them", async () => {
    const onGenerate = open(EMBLEM_UNFILLED_FIELDS);
    for (const field of ["cost", "color_identity", "rarity", "stats"]) {
      expect(offered(), field).not.toContain(field);
    }
    expect(offered()).toContain("rules_text");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Generate/ }));
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0].want.sort()).toEqual(["flavor_text", "rules_text"]);
  });

  it("any other card still offers them", () => {
    open();
    for (const field of ["cost", "color_identity", "rarity", "stats"]) {
      expect(offered(), field).toContain(field);
    }
  });
});

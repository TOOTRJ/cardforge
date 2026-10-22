// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SecondPartColorRow } from "@/components/creator/panels/anatomy-panel";
import { drawsPartColor } from "@/lib/cards/part-color";
import { chipOff } from "@/tests/unit/helpers/chip";

// ---------------------------------------------------------------------------
// TODO 4.26 on the ADVENTURE frame: the creator's "Second part's colour" row
// (the spell's page colour) is offered where the frame draws it — the
// adventure now does, flip still doesn't — and greys out a colour the
// adventure frame isn't verified in, a pair judged by the gold key it
// paints.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const chip = (name: RegExp) => within(screen.getByTestId("second-part-colour-row")).getByRole("button", { name });

describe("the adventure's spell colour row", () => {
  it("is offered on the adventure frame, not on flip", () => {
    expect(drawsPartColor("adventure")).toBe(true);
    expect(drawsPartColor("flip")).toBe(false);
  });

  it("offers a verified colour and greys out an unverified one, with its reason", () => {
    const onChange = vi.fn();
    render(<SecondPartColorRow colors={[]} onChange={onChange} template="adventure" verifiedKeys={new Set(["adventure/b", "adventure/r"])} />);
    expect(chipOff(chip(/^red/i))).toBe(false);
    expect(chipOff(chip(/^white/i))).toBe(true);
    expect(chip(/^white/i).textContent).toMatch(/Not available on this frame/);
    fireEvent.click(chip(/^white/i));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(chip(/^red/i));
    expect(onChange).toHaveBeenCalledWith(["red"]);
  });

  it("judges a second pick by the gold page it paints", () => {
    const onChange = vi.fn();
    render(<SecondPartColorRow colors={["red"]} onChange={onChange} template="adventure" verifiedKeys={new Set(["adventure/r", "adventure/g"])} />);
    // Red + green is the gold `m`, not verified here.
    expect(chipOff(chip(/^green/i))).toBe(true);
    // Taking red off is always reachable.
    fireEvent.click(chip(/^red/i));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

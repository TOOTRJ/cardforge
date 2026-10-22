// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SecondPartColorRow } from "@/components/creator/panels/anatomy-panel";
import { chipOff } from "@/tests/unit/helpers/chip";

// ---------------------------------------------------------------------------
// TODO 4.26, M1 — the creator's "Second part's colour" row offers a colour
// only where the frame is verified in it (aria-disabled with its reason,
// never `disabled`), lets a picked colour be taken off whatever the ticks
// say, and shows a refused save's message at the row (L3).
// ---------------------------------------------------------------------------

afterEach(cleanup);

const chip = (name: RegExp) => within(screen.getByTestId("second-part-colour-row")).getByRole("button", { name });

describe("SecondPartColorRow", () => {
  it("greys out a colour the frame isn't verified in, with its reason, and picks a verified one", () => {
    const onChange = vi.fn();
    render(<SecondPartColorRow colors={[]} onChange={onChange} template="split" verifiedKeys={new Set(["split/r", "split/u"])} />);
    expect(chipOff(chip(/^blue/i))).toBe(false);
    expect(chipOff(chip(/^white/i))).toBe(true);
    expect(chip(/^white/i).textContent).toMatch(/Not available on this frame/);
    fireEvent.click(chip(/^white/i));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(chip(/^blue/i));
    expect(onChange).toHaveBeenCalledWith(["blue"]);
  });

  it("judges a second pick by the colour it makes (a pair paints the gold key)", () => {
    const onChange = vi.fn();
    render(<SecondPartColorRow colors={["blue"]} onChange={onChange} template="split" verifiedKeys={new Set(["split/u"])} />);
    // Blue is picked: always reachable (taking it off).
    expect(chipOff(chip(/^blue/i))).toBe(false);
    // Blue + red is the gold "m", not verified here.
    expect(chipOff(chip(/^red/i))).toBe(true);
    fireEvent.click(chip(/^blue/i));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows a refused save's message at the row", () => {
    render(
      <SecondPartColorRow
        colors={["blue"]}
        onChange={() => {}}
        template="split"
        verifiedKeys={new Set(["split/u"])}
        error="The second part's colour isn't available on this frame in blue yet."
      />,
    );
    expect(screen.getByTestId("second-part-colour-help").textContent).toMatch(/isn't available on this frame in blue/);
    expect(screen.getByTestId("second-part-colour-row").getAttribute("data-field-anchor")).toBe("back_face.color_identity");
  });
});

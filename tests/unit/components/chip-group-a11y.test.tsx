// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { chipOff } from "../helpers/chip";

// ---------------------------------------------------------------------------
// TODO 3b.10 — ChipGroup for a keyboard and a screen reader.
//
//   * A chip that cannot be picked was a `disabled` button: out of the tab
//     order, so nobody on a keyboard reached it or heard WHY it is off (its
//     "Soon" badge, its reason line). It is `aria-disabled` now: reachable,
//     announced as unavailable, and still deaf to clicks.
//   * A single-select row was one tab stop PER chip (sixteen on the Card
//     type row). It is one tab stop — the picked chip — and the arrow keys
//     move between its chips. They move the focus only: a pick is Space or
//     Enter, because a pick here can change the whole card.
// ---------------------------------------------------------------------------

afterEach(cleanup);

type Frame = "m15" | "retro" | "modern" | "future";
const FRAMES: ChipOption<Frame>[] = [
  { value: "m15", label: "M15" },
  { value: "retro", label: "Retro" },
  { value: "modern", label: "Modern", description: "Awaiting verification", disabled: true },
  { value: "future", label: "Future" },
];

function Row({ start = "retro", onPick = () => {} }: { start?: Frame | ""; onPick?: (next: Frame) => void }) {
  const [value, setValue] = useState<Frame | "">(start);
  return (
    <ChipGroup
      ariaLabel="Frame"
      size="md"
      value={value}
      onChange={(next) => {
        setValue(next);
        onPick(next);
      }}
      options={FRAMES}
    />
  );
}

const chip = (name: RegExp | string) => screen.getByRole("radio", { name }) as HTMLButtonElement;
const tabStops = () => screen.getAllByRole("radio").filter((el) => el.tabIndex === 0).map((el) => el.textContent);
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement!, { key, ...init });

describe("a chip that cannot be picked", () => {
  it("is aria-disabled, never disabled: reachable, with its reason in its name", () => {
    render(<Row />);
    const off = chip(/^Modern/);
    expect(chipOff(off)).toBe(true);
    expect(off.disabled).toBe(false);
    expect(off.hasAttribute("disabled")).toBe(false);
    // The reason is part of what is read on it.
    expect(off.textContent).toBe("ModernAwaiting verification");
    // It takes the focus…
    off.focus();
    expect(document.activeElement).toBe(off);
    // …and the chips that can be picked say nothing about being disabled.
    expect(chip("M15").hasAttribute("aria-disabled")).toBe(false);
  });

  it("ignores a click and a key press", () => {
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    const off = chip(/^Modern/);
    fireEvent.click(off);
    off.focus();
    press("Enter");
    press(" ");
    expect(onPick).not.toHaveBeenCalled();
    expect(chip("Retro").getAttribute("aria-checked")).toBe("true");
  });

  it("ignores a click that lands on its label, its reason line or its badge", () => {
    // A `disabled` button swallowed these; an aria-disabled one receives them.
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    const off = chip(/^Modern/);
    for (const inner of off.querySelectorAll("*")) fireEvent.click(inner);
    expect(onPick).not.toHaveBeenCalled();
    expect(chip("Retro").getAttribute("aria-checked")).toBe("true");
  });

  it("chipOff() refuses a chip that says it is off and can still be clicked", () => {
    render(
      <button type="button" aria-disabled onClick={() => {}}>
        Lying
      </button>,
    );
    expect(() => chipOff(screen.getByRole("button", { name: "Lying" }))).toThrow(/still has a click handler/);
  });

  it("looks as it did: the same dimmed classes", () => {
    render(<Row />);
    expect(chip(/^Modern/).className).toMatch(/cursor-not-allowed .*opacity-55/);
    expect(chip("M15").className).not.toMatch(/cursor-not-allowed|opacity-55/);
  });
});

describe("a single-select row on the keyboard", () => {
  it("is ONE tab stop: the picked chip — the first when none is picked", () => {
    const { unmount } = render(<Row />);
    expect(tabStops()).toEqual(["Retro"]);
    fireEvent.click(chip("Future"));
    expect(tabStops()).toEqual(["Future"]);
    unmount();
    render(<Row start="" />);
    expect(tabStops()).toEqual(["M15"]);
  });

  it("the arrow keys move the focus along the row, through a chip that is off, and wrap", () => {
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    chip("Retro").focus();
    press("ArrowRight");
    expect(document.activeElement).toBe(chip(/^Modern/));
    press("ArrowDown");
    expect(document.activeElement).toBe(chip("Future"));
    press("ArrowRight");
    expect(document.activeElement).toBe(chip("M15"));
    press("ArrowLeft");
    expect(document.activeElement).toBe(chip("Future"));
    press("ArrowUp");
    expect(document.activeElement).toBe(chip(/^Modern/));
    press("Home");
    expect(document.activeElement).toBe(chip("M15"));
    press("End");
    expect(document.activeElement).toBe(chip("Future"));
    // Moving is not picking: the card is as it was.
    expect(onPick).not.toHaveBeenCalled();
    expect(chip("Retro").getAttribute("aria-checked")).toBe("true");
  });

  it("the tab stop follows the focus while it is in the row, and returns to the picked chip after", () => {
    // A tab stop left on the picked chip while the arrows moved on made Tab
    // (or Shift+Tab) land on the picked chip of the SAME row before leaving.
    render(
      <>
        <Row />
        <button type="button">after</button>
      </>,
    );
    chip("Retro").focus();
    expect(tabStops()).toEqual(["Retro"]);
    press("Home");
    expect(document.activeElement).toBe(chip("M15"));
    expect(tabStops()).toEqual(["M15"]);
    press("End");
    expect(tabStops()).toEqual(["Future"]);
    // Still one tab stop, and nothing was picked.
    expect(chip("Retro").getAttribute("aria-checked")).toBe("true");
    // The focus leaves the row: the stop is the picked chip again.
    act(() => screen.getByRole("button", { name: "after" }).focus());
    expect(tabStops()).toEqual(["Retro"]);
  });

  it("a pick is the chip's own activation (Space / Enter click a button)", () => {
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    chip("Retro").focus();
    press("End");
    fireEvent.click(document.activeElement!);
    expect(onPick).toHaveBeenCalledWith("future");
    expect(tabStops()).toEqual(["Future"]);
  });

  it("leaves a modified arrow and every other key alone", () => {
    render(<Row />);
    chip("Retro").focus();
    expect(press("ArrowRight", { altKey: true })).toBe(true);
    expect(press("ArrowRight", { metaKey: true })).toBe(true);
    expect(press("Tab")).toBe(true);
    expect(press("a")).toBe(true);
    expect(document.activeElement).toBe(chip("Retro"));
    // A handled arrow is taken (the page does not scroll under the row).
    expect(press("ArrowRight")).toBe(false);
  });

  it("is named, described and marked invalid by what it is given", () => {
    render(
      <>
        <ChipGroup ariaLabel="Frame" ariaDescribedBy="why" ariaInvalid value="m15" onChange={() => {}} options={FRAMES} />
        <p id="why">Pick a frame.</p>
      </>,
    );
    const row = screen.getByRole("radiogroup", { name: "Frame", description: "Pick a frame." });
    expect(row.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("a multi-select row", () => {
  const WORDS: ChipOption<"artifact" | "creature" | "snow">[] = [
    { value: "artifact", label: "Artifact" },
    { value: "creature", label: "Creature" },
    { value: "snow", label: "Snow", disabled: true },
  ];

  it("is independent toggles: every chip a tab stop, the arrows untouched", () => {
    const onChange = vi.fn();
    render(<ChipGroup multiSelect ariaLabel="Token types" value={["creature"]} onChange={onChange} options={WORDS} />);
    const toggles = screen.getAllByRole("button");
    expect(toggles.every((el) => el.tabIndex === 0)).toBe(true);
    toggles[0].focus();
    expect(press("ArrowRight")).toBe(true);
    expect(document.activeElement).toBe(toggles[0]);
    // A toggle that is off is reachable too, and ignores the click.
    expect(chipOff(toggles[2])).toBe(true);
    fireEvent.click(toggles[2]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(toggles[0]);
    expect(onChange).toHaveBeenCalledWith(["creature", "artifact"]);
  });

  it("is a group only when it is given a name (one chip that names itself needs none)", () => {
    const { unmount } = render(
      <ChipGroup multiSelect ariaLabel="Token types" value={[]} onChange={() => {}} options={WORDS} />,
    );
    expect(screen.getByRole("group", { name: "Token types" })).toBeTruthy();
    unmount();
    render(<ChipGroup multiSelect value={[]} onChange={() => {}} options={[{ value: "legendary", label: "Legendary" }]} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "Legendary" })).toBeTruthy();
  });
});

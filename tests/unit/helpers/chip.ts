// A ChipGroup chip that cannot be picked is `aria-disabled`, never
// `disabled` (TODO 3b.10): a disabled button leaves the tab order, so a
// keyboard or screen-reader user never reached the chip nor heard why it is
// off. It still ignores clicks. Tests that asked `chip.disabled` ask this.
export function chipOff(chip: Element): boolean {
  return chip.getAttribute("aria-disabled") === "true";
}

// A ChipGroup chip that cannot be picked is `aria-disabled`, never
// `disabled` (TODO 3b.10): a disabled button leaves the tab order, so a
// keyboard or screen-reader user never reached the chip nor heard why it is
// off. It still ignores clicks. Tests that asked `chip.disabled` ask this.
//
// `aria-disabled` alone promises nothing — unlike `disabled`, the browser
// still delivers every click — so the helper also holds the chip to being
// INERT: a chip that says it is off while React still has a click handler on
// it fails the test that asked (it would be pickable by mouse, Enter, Space
// and touch alike).
export function chipOff(chip: Element): boolean {
  const off = chip.getAttribute("aria-disabled") === "true";
  if (off) {
    const propsKey = Object.keys(chip).find((key) => key.startsWith("__reactProps$"));
    const props = propsKey ? (chip as unknown as Record<string, { onClick?: unknown }>)[propsKey] : null;
    if (props && typeof props.onClick === "function") {
      throw new Error(`chipOff: "${chip.textContent}" is aria-disabled but still has a click handler`);
    }
  }
  return off;
}

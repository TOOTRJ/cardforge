import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// The rules-text box on the Text & stats step, in a real browser — the five
// things only one can show:
//   • a mouse click inside the empty box used to drop a {W} pip into it (the
//     field group is a <label>; its first labelable descendant is the symbol
//     toolbar's first button, and a label forwards clicks to it);
//   • the first Enter at the end of a text was dropped ("Aa", Enter, "Bb"
//     read "AaBb"), and deleting the last line's text added a line;
//   • Backspace did nothing behind a pip that was all its line held ("Cc",
//     Enter, "{t}"), and Delete on a line a pip starts did nothing or took
//     the break above with the pip;
//   • a character typed in front of a pip that starts its line went nowhere
//     (after Home) or onto the line above, ← and → stepped over that place,
//     and deleting the text in front of a pip added a line ("a{t}{g}",
//     Delete on the "a", read "\n{T}{G}");
//   • at a phone's width the step scrolled sideways (the AI button's label
//     never wrapped).
// Auth-gated, so it skips without the seeded e2e user. See tests/README.md.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

// /create opens on the Card panel; Text & stats is two "Next" away at every
// width (the step rail only exists from xl up).
async function openTextStep(page: Page) {
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: /forge a new card/i })).toBeVisible();
  const next = page.getByRole("button", { name: /^next$/i });
  await next.click();
  await next.click();
  const box = page.locator('[data-field="rules_text"]');
  await expect(box).toBeVisible();
  return box;
}

// macOS moves to a line's edge with Cmd+Arrow; Home / End only scroll there.
const LINE_START = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
const LINE_END = process.platform === "darwin" ? "Meta+ArrowRight" : "End";

/**
 * The box as the form reads it: pips as their codes, breaks as "\n", and
 * nothing for the zero-width character that holds the caret in front of a pip.
 */
async function textOf(page: Page): Promise<string> {
  return page.locator('[data-field="rules_text"]').evaluate((root) => {
    const read = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").replaceAll("\u200B", "");
      const el = node as Element;
      const pip = el.getAttribute("data-pip");
      if (pip) return pip;
      if (el.tagName === "BR") return el.hasAttribute("data-filler") ? "" : "\n";
      return Array.from(el.childNodes).map(read).join("");
    };
    return read(root);
  });
}

test.describe("rules text editor", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("a click inside the empty box focuses it and inserts nothing", async ({ page }) => {
    await signIn(page);
    const box = await openTextStep(page);

    await box.click();
    await expect(box).toBeFocused();
    expect(await textOf(page)).toBe("");

    // The gap between two toolbar buttons is not a button either.
    const first = await page.getByRole("button", { name: "Insert {W}" }).boundingBox();
    const second = await page.getByRole("button", { name: "Insert {U}" }).boundingBox();
    await page.mouse.click((first!.x + first!.width + second!.x) / 2, first!.y + first!.height / 2);
    expect(await textOf(page)).toBe("");

    // The buttons themselves still insert at the caret.
    await box.click();
    await page.getByRole("button", { name: "Insert {W}" }).click();
    expect(await textOf(page)).toBe("{W}");
  });

  test("every Enter opens a line, and deleting a line's text adds none", async ({ page }) => {
    await signIn(page);
    const box = await openTextStep(page);

    await box.click();
    await page.keyboard.type("Aa");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bb");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Cc");
    expect(await textOf(page)).toBe("Aa\nBb\nCc");

    // Chrome keeps the emptied last line open with a <br> of its own.
    await page.keyboard.press("Enter");
    await page.keyboard.type("D");
    await page.keyboard.press("Backspace");
    expect(await textOf(page)).toBe("Aa\nBb\nCc\n");
    await page.keyboard.type("Dd");
    expect(await textOf(page)).toBe("Aa\nBb\nCc\nDd");

    // Enter in the middle of a line splits it.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    expect(await textOf(page)).toBe("Aa\nBb\nCc\nD\nd");
  });

  test("Backspace and Delete remove a pip that starts its line", async ({ page }) => {
    await signIn(page);
    const box = await openTextStep(page);

    // A pip that is all the last line holds: Chrome's own Backspace did nothing.
    await box.click();
    await page.keyboard.type("Cc");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{t}");
    expect(await textOf(page)).toBe("Cc\n{T}");
    await page.keyboard.press("Backspace");
    expect(await textOf(page)).toBe("Cc\n");
    // The caret stayed on the emptied line.
    await page.keyboard.type("{t}{g}");
    expect(await textOf(page)).toBe("Cc\n{T}{G}");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    expect(await textOf(page)).toBe("Cc\n");

    // Delete in front of the pip a line starts with (the key leaves Chrome's
    // caret inside the pip) removes the pip and keeps the break above it.
    await page.keyboard.type("{t}ab");
    await page.keyboard.press(LINE_START);
    await page.keyboard.press("Delete");
    expect(await textOf(page)).toBe("Cc\nab");

    // Delete at the end of the line above joins the lines; the pip stays.
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{t}");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press(LINE_END);
    await page.keyboard.press("Delete");
    expect(await textOf(page)).toBe("Cc{T}ab");
  });

  test("typing and the arrows reach the place in front of a pip that starts its line", async ({ page }) => {
    await signIn(page);
    const box = await openTextStep(page);

    // The line's start: Chrome's own caret went inside the pip, and typed nothing.
    await box.click();
    await page.keyboard.type("Cc");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{t}ab");
    await page.keyboard.press(LINE_START);
    await page.keyboard.type("k");
    expect(await textOf(page)).toBe("Cc\nk{T}ab");
    // Emptied again, the place keeps the caret (it went to the line above).
    await page.keyboard.press("Backspace");
    await page.keyboard.type("{g}m");
    expect(await textOf(page)).toBe("Cc\n{G}m{T}ab");

    // ← from behind a pip that is all its line holds stops in front of it …
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Cc");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{t}");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("z");
    expect(await textOf(page)).toBe("Cc\nz{T}");
    // … and one more press from there is the end of the line above; → comes
    // back the same way, one place a press.
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("d");
    expect(await textOf(page)).toBe("Ccd\n{T}");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("e");
    expect(await textOf(page)).toBe("Ccd\ne{T}");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("f");
    expect(await textOf(page)).toBe("Ccd\n{T}f");

    // A click on the pip is the place in front of it.
    await box.locator("[data-pip]").click({ position: { x: 2, y: 8 } });
    await page.keyboard.type("y");
    expect(await textOf(page)).toBe("Ccd\ny{T}f");

    // Deleting the text in front of a pip adds no line.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("a{t}{g}");
    await page.keyboard.press(LINE_START);
    await page.keyboard.press("Delete");
    expect(await textOf(page)).toBe("{T}{G}");
    await page.keyboard.type("q");
    expect(await textOf(page)).toBe("q{T}{G}");
  });

  test("leaving the box after a blur conversion keeps the focus where it went", async ({ page }) => {
    await signIn(page);
    const box = await openTextStep(page);

    // The apostrophe is rewritten when the box loses focus (print typography):
    // the text is re-rendered while blurred, with a caret host in front of the
    // pip on line 2. The box used to take the focus back there.
    await box.click();
    await page.keyboard.type("it's");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{t}: go");
    const power = page.locator('input[name="power"]');
    const before = await power.inputValue();
    await power.click();
    await page.keyboard.type("7");
    await expect(power).toBeFocused();
    await expect(power).toHaveValue(`${before}7`);
    expect(await textOf(page)).toBe("it\u2019s\n{T}: go");

    // Tab leaves the box too.
    await box.click();
    await page.keyboard.type(" 'x'");
    await page.keyboard.press("Tab");
    await expect(box).not.toBeFocused();
  });

  test("the step does not scroll sideways on a phone", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTextStep(page);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBe(widths.client);
    // The last rarity chip is whole.
    const mythic = await page.getByRole("radio", { name: /mythic/i }).boundingBox();
    expect(mythic!.x + mythic!.width).toBeLessThanOrEqual(390);
  });
});

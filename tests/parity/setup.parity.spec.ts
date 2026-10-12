import { expect, test } from "@playwright/test";
import { PARITY_PATH } from "./shared";

// ---------------------------------------------------------------------------
// Before the two size projects start (TODO 3.11): the harness page answers
// and mounts. This is also what makes Turbopack compile the route ONCE —
// the two workers would otherwise both wait on its first compile — and what
// the report project hangs off (tests/parity/playwright.config.ts
// `teardown`: it runs after the size projects whether they passed or not).
// ---------------------------------------------------------------------------

test("the parity harness page is a route of this server, and mounts", async ({ page }) => {
  // Its islands ask a Supabase that is not there; nothing leaves this machine.
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const response = await page.goto(PARITY_PATH, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "/dev/parity exists only on a server started with PARITY_HARNESS=1").toBe(200);
  await page.waitForSelector("html[data-parity-ready='1']", { timeout: 150_000 });
});

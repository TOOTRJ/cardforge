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
  // Asked until it answers 200, for up to 45 s: the server is "up" as soon as
  // /api/version answers (playwright.config.ts), which is before Turbopack
  // has compiled this page, and one run answered a single 404 here that was
  // never explained (2026-10-12; not reproduced since in eleven cold starts,
  // with and without Turbopack's file cache). A transient answer is said out
  // loud and asked again; a server that is NOT the harness answers 404 every
  // time and still fails here, with the message below.
  let status = 0;
  await expect
    .poll(
      async () => {
        status = (await page.goto(PARITY_PATH, { waitUntil: "domcontentloaded" }))?.status() ?? 0;
        if (status !== 200) console.warn(`[parity] ${PARITY_PATH} answered ${status} — asking again`);
        return status;
      },
      { message: "/dev/parity exists only on a server started with PARITY_HARNESS=1", timeout: 45_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toBe(200);
  await page.waitForSelector("html[data-parity-ready='1']", { timeout: 150_000 });
});

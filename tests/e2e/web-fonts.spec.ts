import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Card web fonts decode in Chromium (TODO 3.27). Every card-face @font-face
// in app/globals.css lists a woff2 first. A file Chromium's font sanitiser
// (OTS) rejects is downloaded, thrown away and the next source fetched,
// silently but for a console warning: mplantin.woff2 did that until
// 2026-09-27 (its cmap subtables said language 1), so every editor fetched
// MPlantin twice and drew the .woff. tests/unit/content/mplantin-web-font
// holds the woff2 to the .woff table for table. Like the marketing smoke,
// this runs without Supabase env vars.
// ---------------------------------------------------------------------------

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const FACES = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
  family: /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
  first: /url\("([^"]+)"\)/.exec(body)?.[1] ?? "",
}));

const REJECTED = /OTS parsing error|Failed to decode downloaded font/;

test("each card font's first @font-face source decodes in Chromium", async ({ page }) => {
  expect(FACES.map((face) => face.first)).toEqual(
    expect.arrayContaining([
      "/fonts/mplantin.woff2",
      "/fonts/mplantin-italic.woff2",
      "/fonts/Beleren-Bold.woff2",
      "/fonts/mana.woff2",
    ]),
  );
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (REJECTED.test(message.text())) warnings.push(message.text());
  });
  await page.goto("/");
  const statuses = await page.evaluate(
    (faces) =>
      Promise.all(
        faces.map(async ({ family, first }) => {
          const face = new FontFace(`${family} check`, `url(${first})`);
          await face.load().catch(() => undefined);
          return `${first}: ${face.status}`;
        }),
      ),
    FACES,
  );
  expect(statuses).toEqual(FACES.map((face) => `${face.first}: loaded`));
  expect(warnings).toEqual([]);
});

test("the editor's MPlantin downloads its woff2 and nothing else", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (REJECTED.test(message.text())) warnings.push(message.text());
  });
  await page.goto("/");
  // The @font-face rules arrive with the global stylesheet.
  await page.waitForFunction(() =>
    [...document.fonts].some((face) => face.family.replace(/"/g, "") === "MPlantin"),
  );
  const fetched = await page.evaluate(async () => {
    await document.fonts.load('16px "MPlantin"');
    await document.fonts.load('italic 16px "MPlantin"');
    return performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.startsWith("/fonts/mplantin"));
  });
  expect([...new Set(fetched)].sort()).toEqual([
    "/fonts/mplantin-italic.woff2",
    "/fonts/mplantin.woff2",
  ]);
  expect(warnings).toEqual([]);
});

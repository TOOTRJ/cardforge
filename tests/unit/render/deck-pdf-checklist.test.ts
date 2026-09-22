import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeckPdf } from "@/lib/render/card-pdf";

const MPLANTIN = readFileSync(join(process.cwd(), "public/fonts/mplantin.ttf"));
const CHECKLIST = {
  heading: "Æther Storm — 日本語 デッキ ✓ (needs proxies)",
  lines: ["4× Lim-Dûl's Vault", "1× Ætherling", "2× 稲妻 (Lightning Bolt) 🔥"],
};

// REGRESSION: the checklist used pdf-lib's built-in Helvetica, which can only
// encode WinAnsi. A deck title or card name with anything outside it —
// "Æther", "Lim-Dûl", a Japanese name, an emoji — threw inside drawText and
// the whole Pro export 500'd. The checklist now embeds MPlantin via fontkit
// and swaps still-unencodable code points for "?".
describe("buildDeckPdf checklist", () => {
  it("survives non-WinAnsi titles and card names with the embedded font", async () => {
    const bytes = await buildDeckPdf([], {
      title: "Æther Storm — 日本語 デッキ ✓",
      layout: "pages",
      checklist: CHECKLIST,
      checklistFont: MPLANTIN,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // %PDF header — a real document came back, not an error blob.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  }, 30_000);

  it("still never throws when no font bytes are supplied (Helvetica fallback)", async () => {
    const bytes = await buildDeckPdf([], { layout: "pages", checklist: CHECKLIST });
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  }, 30_000);
});

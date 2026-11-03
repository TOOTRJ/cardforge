import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TODO UI1: wherever the site shows a card's or deck's colours, it draws the
// card's own pips through ONE component, components/cards/color-pip.tsx —
// never a plain coloured circle or dot again. Two scans hold it:
//
//   * every surface below draws its colours through color-pip and holds no
//     dot of its own: no `rounded-full` box filled in a colour token
//     (bg-gold, bg-mana-*, the old Tailwind swatches), no colour table
//     (COLOR_DOT, COLOR_TO_PIP, COLOR_DOT_CLASS), no inline fill from a
//     colour constant;
//   * nowhere in app/ or components/ does the second symbol set come back:
//     the old ManaPip (letters on coloured circles) and the analytics
//     swatch table are gone, and no class fills a box with a --color-mana-*
//     token (app/globals.css keeps the tokens for its own gradients).
// ---------------------------------------------------------------------------

/** The surfaces UI1 swapped, and what each shows. */
const SURFACES: Record<string, string> = {
  "components/decks/deck-tile.tsx": "deck tiles' colours",
  "app/(marketing)/deck/[slug]/page.tsx": "the deck hero's colour identity",
  "components/frames/frame-gallery-tile.tsx": "/frames tiles' verified colours",
  "components/gallery/gallery-filters.tsx": "gallery + browse colour filter",
  "components/profile/profile-card-filters.tsx": "profile colour chips",
  "components/decks/deck-chart-parts.tsx": "the deck breakdown's colour symbols and sources",
  "components/admin/frame-review-checklist.tsx": "admin frame checklist colours",
  "components/admin/frame-template-signoff.tsx": "admin sign-off colours",
};

/** A dot: a round box filled in a colour (an opacity-tinted badge such as
 *  `bg-gold/10` behind words is not one). */
const DOT_CLASS =
  /rounded-full[^"'`]*\bbg-(?:gold|gold-strong|mana-[wubrgc]|amber-\d+|sky-\d+|zinc-\d+|rose-\d+|emerald-\d+|slate-\d+|fuchsia-\d+)(?![\w/-])|\bbg-(?:gold|mana-[wubrgc])(?![\w/-])[^"'`]*rounded-full/;
const COLOUR_TABLE = /\b(?:COLOR_DOT|COLOR_DOT_CLASS|COLOR_TO_PIP|PIP_SYMBOL)\b/;
const INLINE_FILL = /background(?:Color)?\s*:\s*(?:COLOR_DOT|MANA_HEX|MANA_GEM_BG|BRAND\.mana)/;

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("UI1 surfaces draw the card's pips", () => {
  it.each(Object.entries(SURFACES))("%s (%s) draws its colours through color-pip", (path) => {
    const source = read(path);
    expect(source).toMatch(/from "@\/components\/cards\/color-pip"/);
  });

  it.each(Object.keys(SURFACES))("%s holds no colour dot of its own", (path) => {
    const source = read(path);
    expect(source).not.toMatch(DOT_CLASS);
    expect(source).not.toMatch(COLOUR_TABLE);
    expect(source).not.toMatch(INLINE_FILL);
    expect(source).not.toMatch(/\bManaPip\b/);
  });

  it("the patterns catch the dots they replaced", () => {
    expect('<span className="inline-block h-3.5 w-3.5 rounded-full border border-gold/60 bg-gold" />').toMatch(DOT_CLASS);
    expect('className="bg-mana-w text-amber-900 rounded-full"').toMatch(DOT_CLASS);
    expect('style={{ background: COLOR_DOT[view.colorKey] ?? "#b8b5b3" }}').toMatch(INLINE_FILL);
    // A tinted badge behind words is not a dot.
    expect('className="rounded-full border border-gold/50 bg-gold/10 px-2"').not.toMatch(DOT_CLASS);
  });
});

describe("UI1: no second symbol set anywhere", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) files.push(full);
    }
  };
  walk(join(process.cwd(), "app"));
  walk(join(process.cwd(), "components"));

  it("the old ManaPip and the analytics swatch table are gone", () => {
    expect(existsSync(join(process.cwd(), "components/cards/mana-pip.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "components/analytics/bar-list.tsx"))).toBe(false);
  });

  it("nothing imports them or fills a box with a mana colour token", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /components\/cards\/mana-pip"|components\/analytics\/bar-list"/.test(source) ||
        /\bbg-mana-[wubrgc]\b/.test(source) ||
        /\bCOLOR_DOT(?:_CLASS)?\b/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});

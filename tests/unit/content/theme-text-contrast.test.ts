import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The site's text tokens against the surfaces they sit on (TODO 3b.31).
//
// axe's `color-contrast` flagged small text (10–12 px captions, `kbd`, chip
// descriptions, the "best size" line, the header credits chip's "· 0 used")
// drawn in `--color-subtle` on `--color-elevated`: 4.01:1 in the dark theme,
// 4.35:1 in the light one. WCAG AA asks 4.5:1 for text that size. These
// tests compute the ratios from the OKLCH values in app/globals.css itself
// (the dark `@theme` block and `:root[data-theme="light"]`), so a later token
// edit that dims a text token below AA on any of the three surfaces fails
// here, not on an axe run of the right screen.
// ---------------------------------------------------------------------------

const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

type Oklch = { l: number; c: number; h: number };

/** The first `{ … }` block whose selector line matches `opener`. */
function block(opener: RegExp): string {
  const start = CSS.search(opener);
  expect(start, `block ${opener}`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("\n}", open);
  return CSS.slice(open + 1, close);
}

function token(body: string, name: string): Oklch {
  const m = body.match(
    new RegExp(`--color-${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`),
  );
  expect(m, `--color-${name}`).not.toBeNull();
  return { l: Number(m![1]), c: Number(m![2]), h: Number(m![3]) };
}

/** OKLCH → gamma-encoded sRGB (Björn Ottosson's matrices), clamped. */
function toSrgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  }) as [number, number, number];
}

/** What the browser paints: sRGB rounded to 8 bits, as axe reads it. */
const to8bit = (rgb: [number, number, number]) => rgb.map((v) => Math.round(v * 255) / 255);

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Oklch, bg: Oklch): number {
  const a = luminance(to8bit(toSrgb(fg)));
  const b = luminance(to8bit(toSrgb(bg)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hex = (t: Oklch) =>
  "#" + to8bit(toSrgb(t)).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

const THEMES = {
  dark: block(/^@theme\s*\{/m),
  light: block(/^:root\[data-theme="light"\]\s*\{/m),
};
const SURFACES = ["background", "surface", "elevated"] as const;
const AA = 4.5;

describe("theme text tokens meet WCAG AA on every surface (TODO 3b.31)", () => {
  it("the converter matches the colours axe measured in the browser", () => {
    // Chromium's computed colours on main (axe's fgColor / bgColor), so the
    // ratios below are the ones a browser check reports.
    expect(hex({ l: 0.62, c: 0.02, h: 262 })).toBe("#808693");
    expect(hex({ l: 0.28, c: 0.032, h: 262 })).toBe("#202939");
    expect(hex({ l: 0.52, c: 0.018, h: 262 })).toBe("#636974");
    expect(hex({ l: 0.92, c: 0.012, h: 262 })).toBe("#e0e5ed");
    // …and the old pair really was below AA, the bug this guards.
    expect(contrast({ l: 0.62, c: 0.02, h: 262 }, { l: 0.28, c: 0.032, h: 262 })).toBeLessThan(AA);
    expect(contrast({ l: 0.52, c: 0.018, h: 262 }, { l: 0.92, c: 0.012, h: 262 })).toBeLessThan(AA);
  });

  for (const [theme, body] of Object.entries(THEMES)) {
    for (const text of ["foreground", "muted", "subtle"] as const) {
      for (const surface of SURFACES) {
        it(`${theme}: --color-${text} on --color-${surface} ≥ ${AA}:1`, () => {
          const ratio = contrast(token(body, text), token(body, surface));
          expect(ratio, `${theme} ${text}/${surface} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        });
      }
    }

    it(`${theme}: subtle stays a step below muted, on the slate hue`, () => {
      const subtle = token(body, "subtle");
      const muted = token(body, "muted");
      const fg = token(body, "foreground");
      // Dimmer than muted against the canvas: the text hierarchy holds.
      const bg = token(body, "background");
      expect(contrast(subtle, bg)).toBeLessThan(contrast(muted, bg));
      expect(contrast(muted, bg)).toBeLessThan(contrast(fg, bg));
      // Same slate-navy hue as the surfaces (brand palette): a lightness
      // change only, never a new colour.
      expect(subtle.h).toBe(262);
      expect(subtle.h).toBe(muted.h);
    });
  }

  it("pins the 3b.31 values (a change here is a new before / after round)", () => {
    expect(token(THEMES.dark, "subtle")).toEqual({ l: 0.66, c: 0.02, h: 262 });
    expect(token(THEMES.light, "subtle")).toEqual({ l: 0.49, c: 0.018, h: 262 });
  });
});

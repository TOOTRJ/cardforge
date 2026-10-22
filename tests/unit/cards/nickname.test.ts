import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import {
  NICKNAME_LINE_BOX,
  NICKNAME_LINE_FLOOR_PX,
  NICKNAME_LINE_PX,
  NICKNAME_PINLINE,
  NICKNAME_PLATE_BOX,
  cardNickname,
  cardTitleWithNickname,
  fitNicknameLine,
  frameDrawsNickname,
  nicknamePinlineOf,
  nicknamePlateArt,
  resolveNickname,
} from "@/lib/cards/nickname";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 6.3 — the nickname plate (lib/cards/nickname.ts). What both renderers
// read: which frames print it, what a card with and without one draws, the
// plate's colours and the name line's fit.
// ---------------------------------------------------------------------------

/** The frames that declare the plate — the M15-skeleton entries it was
 *  measured on. A new one is a decision, never an accident. */
const DECLARED = [
  "m15",
  "m15artifact",
  "m15land",
  "m15nyx",
  "m15snow",
  "m15snowland",
  "m15ub",
  "m15ubartifact",
  "m15ubland",
  "m15vehicle",
];

describe("which frames print the nickname plate", () => {
  it("is the M15-skeleton entries the plate was measured on, and nothing else", () => {
    const declared = FRAME_TEMPLATE_VALUES.filter((t) => frameDrawsNickname(getFrameProfile(t))).sort();
    expect(declared).toEqual([...DECLARED].sort());
  });

  it("every one of them opens its art window where the plate hangs from (238 px)", () => {
    for (const template of DECLARED) {
      const slot = getFrameProfile(template as (typeof FRAME_TEMPLATE_VALUES)[number]).artSlot;
      const top = (slot.topPct / 100) * 2100;
      expect(Math.abs(top - 237), template).toBeLessThanOrEqual(2);
    }
  });
});

describe("a card's nickname", () => {
  it("is the trimmed text, or none", () => {
    expect(cardNickname("  Godzilla  ")).toBe("Godzilla");
    expect(cardNickname("   ")).toBeNull();
    expect(cardNickname("")).toBeNull();
    expect(cardNickname(null)).toBeNull();
    expect(cardNickname(undefined)).toBeNull();
  });

  it("draws nothing without a nickname, or on a frame with no plate", () => {
    const m15 = getFrameProfile("m15");
    expect(resolveNickname(m15, null, "Grizzly Bears", "g")).toBeNull();
    expect(resolveNickname(m15, "  ", "Grizzly Bears", "g")).toBeNull();
    for (const template of ["retro", "modern", "agclassic", "m15borderless", "m15token", "m20token", "m15devoid", "m15station", "extendedart", "saga"] as const) {
      expect(resolveNickname(getFrameProfile(template), "Godzilla", "Grizzly Bears", "g"), template).toBeNull();
    }
  });

  it("on a declared frame: the nickname in the title bar, the name on the plate", () => {
    const drawn = resolveNickname(getFrameProfile("m15"), " Wakandan War Panther ", "Fleecemane Lion", "gw");
    expect(drawn?.titleText).toBe("Wakandan War Panther");
    expect(drawn?.line.text).toBe("Fleecemane Lion");
    expect(drawn?.line.sizePct).toBeCloseTo(NICKNAME_LINE_PX / 1500, 10);
    expect(drawn?.plate.href.startsWith("data:image/svg+xml;utf8,")).toBe(true);
  });

  it("titles the card page with the name first (the canonical's), the nickname in brackets", () => {
    expect(cardTitleWithNickname("Fleecemane Lion", "Wakandan War Panther")).toBe("Fleecemane Lion (Wakandan War Panther)");
    expect(cardTitleWithNickname("Fleecemane Lion", null)).toBe("Fleecemane Lion");
    expect(cardTitleWithNickname("Fleecemane Lion", " ")).toBe("Fleecemane Lion");
    expect(cardTitleWithNickname("Same", "Same")).toBe("Same");
  });
});

describe("the plate's colours", () => {
  it("are the pinline's: one colour, the pair's two, a land's grey", () => {
    expect(nicknamePinlineOf("g")).toEqual([NICKNAME_PINLINE.g, NICKNAME_PINLINE.g]);
    expect(nicknamePinlineOf("gw")).toEqual([NICKNAME_PINLINE.g, NICKNAME_PINLINE.w]);
    expect(nicknamePinlineOf("wu-h")).toEqual([NICKNAME_PINLINE.w, NICKNAME_PINLINE.u]);
    expect(nicknamePinlineOf("c")).toEqual([NICKNAME_PINLINE.c, NICKNAME_PINLINE.c]);
    expect(nicknamePinlineOf("c", { c: "l" })).toEqual([NICKNAME_PINLINE.l, NICKNAME_PINLINE.l]);
    expect(nicknamePinlineOf("m")).toEqual([NICKNAME_PINLINE.m, NICKNAME_PINLINE.m]);
  });

  it("a land frame reads its colourless master as the land grey", () => {
    for (const template of ["m15land", "m15snowland", "m15ubland"] as const) {
      expect(getFrameProfile(template).nickname?.keyMap?.c).toBe("l");
    }
    expect(getFrameProfile("m15").nickname?.keyMap).toBeUndefined();
  });

  it("one colour draws a solid rim, a pair a gradient over the 40 → 60 %W ramp", () => {
    const solid = decodeURIComponent(nicknamePlateArt("u"));
    expect(solid).toContain('stroke="rgb(0,117,190)"');
    expect(solid).not.toContain("linearGradient");
    const pair = decodeURIComponent(nicknamePlateArt("gw"));
    expect(pair).toContain('x1="600"');
    expect(pair).toContain('x2="900"');
    expect(pair).toContain("rgb(42,108,69)");
    expect(pair).toContain("rgb(244,243,236)");
    // Its box: even HD px, whole at the 750 px target.
    for (const v of Object.values(NICKNAME_PLATE_BOX)) expect(v % 2).toBe(0);
    for (const v of Object.values(NICKNAME_LINE_BOX)) expect(v % 2).toBe(0);
    // The same string for the same colours (the preview, the bake and the
    // finish masks draw ONE picture).
    expect(nicknamePlateArt("gw")).toBe(nicknamePlateArt("gw-h"));
  });

  // The palette read back off the masters (the frames cache the visual and
  // parity suites fill — tmp/visual/frames — or an importer build), rows
  // 224–229 under the title bar at x 280–320 and 1180–1220.
  const cache = [process.env.FRAMES_BUILD_DIR, path.join(process.cwd(), "tmp/visual/frames")].find((dir) => dir && existsSync(dir));
  it.skipIf(!cache)("matches every declared master's own pinline (±3 levels)", async () => {
    let read = 0;
    for (const template of DECLARED) {
      const dir = path.join(cache!, template);
      if (!existsSync(dir)) continue;
      const keyMap = getFrameProfile(template as (typeof FRAME_TEMPLATE_VALUES)[number]).nickname?.keyMap;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
        const key = file.split(".")[0]!;
        const { data, info } = await sharp(path.join(dir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        if (info.width !== 1500 || info.height !== 2100) continue;
        const mean = (x0: number) => {
          const sum = [0, 0, 0];
          let n = 0;
          for (let y = 224; y < 230; y += 1) {
            for (let x = x0 - 20; x < x0 + 20; x += 1) {
              const i = (y * info.width + x) * 3;
              for (let c = 0; c < 3; c += 1) sum[c] += data[i + c]!;
              n += 1;
            }
          }
          return sum.map((v) => v / n);
        };
        const [left, right] = nicknamePinlineOf(key, keyMap);
        const measured = [mean(300), mean(1200)];
        [left, right].forEach((want, side) =>
          want.forEach((v, c) => expect(Math.abs(measured[side]![c]! - v), `${template}/${key} side ${side}`).toBeLessThanOrEqual(3)),
        );
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(50);
  }, 120_000);
});

describe("the name line", () => {
  it("prints a name at print's 54 px", () => {
    expect(fitNicknameLine("Fleecemane Lion")).toEqual({ text: "Fleecemane Lion", sizePct: 54 / 1500 });
  });

  it("steps a long name down in even HD px until it fits the plate", () => {
    const name = "Kenrith, the Returned King of the Seven Realms Beyond";
    const fit = fitNicknameLine(name);
    const px = Math.round(fit.sizePct * 1500);
    expect(px).toBeLessThan(NICKNAME_LINE_PX);
    expect(px).toBeGreaterThanOrEqual(NICKNAME_LINE_FLOOR_PX);
    expect(px % 2).toBe(0);
    expect(fit.text).toBe(name);
    expect(displayTextWidthEm(name, { face: "bodyItalic" }) * px).toBeLessThanOrEqual(NICKNAME_LINE_BOX.w);
    // One size larger would not fit.
    expect(displayTextWidthEm(name, { face: "bodyItalic" }) * (px + 2)).toBeGreaterThan(NICKNAME_LINE_BOX.w);
  });

  it("cuts a name too long even at the floor with one “…”", () => {
    const name = "Kenrith, the Returned King of the Seven Realms Beyond the Glittering Silver Sea";
    const fit = fitNicknameLine(name);
    expect(Math.round(fit.sizePct * 1500)).toBe(NICKNAME_LINE_FLOOR_PX);
    expect(fit.text.endsWith("…")).toBe(true);
    expect(displayTextWidthEm(fit.text, { face: "bodyItalic" }) * NICKNAME_LINE_FLOOR_PX).toBeLessThanOrEqual(NICKNAME_LINE_BOX.w);
  });
});

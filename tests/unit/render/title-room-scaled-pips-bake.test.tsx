import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pipScale } from "@/lib/cards/mana-gem";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { manaCostWidthPct, titleBandRoomPct } from "@/lib/cards/title-band";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import {
  TITLE_ROOM_BAKE_PARTS,
  TITLE_ROOM_TEMPLATES as TEMPLATES,
  plainTwin,
  scaledCost,
  titleRoomBakePlan,
  titleRoomTemplatesOfPart,
} from "./title-room-scaled-pips";

// ---------------------------------------------------------------------------
// A name before a DETACHED cost of Phyrexian symbols, on REAL bakes (layout
// v52, TODO 6.16d). Since v49 a Phyrexian symbol — one colour or two — sits
// on a disc ×1.2 (lib/cards/mana-gem.ts pipScale), but the name's room on
// the frames that place the cost in a box of its own (FrameProfile.costRect)
// was measured with every pip a plain disc (lib/cards/title-band.ts
// manaCostWidthPct): at HD the longest name the fit kept whole ended 13 px
// from the first of three such discs on `modern` and 2 px on `m15pw`, and
// 42 / 67 px UNDER the first of seven. Each pip now counts its own disc.
//
// Measured by difference, on flat stand-in masters (tests/stubs/stand-in-
// frames.ts — the real ones are frames-bucket objects): the cost row is what
// differs between a card with the cost and the same card without, the name
// what differs between the long name and a one-letter one before the same
// cost. Both presets: the 750 px bake rounds every disc and gap apart. On
// main (1985ba23) all eight bake tests below fail.
//
// The eight bake tests themselves are registered by title-room-scaled-pips.ts
// in title-room-scaled-pips-bake-<n>.test.ts (why: that file's header); this
// file keeps the rest, and holds those parts to be all eight.
// ---------------------------------------------------------------------------

describe("the detached-cost templates", () => {
  it("are these four — every profile that places a cost it draws in its own box", () => {
    const detached = FRAME_TEMPLATE_VALUES.filter((t) => {
      const p = getFrameProfile(t);
      return Boolean(p.costRect) && !p.hideCost;
    });
    expect([...detached].sort()).toEqual([...TEMPLATES].sort());
  });
});

describe("the measured cost row — each pip at its own disc", () => {
  it("a cost with no larger disc measures to the SAME float as one plain disc per pip", () => {
    const GAP = 0.12;
    for (const disc of [0.044, 0.0485, 0.05333333333333334, 0.0367]) {
      for (const cost of ["{R}", "{2}{R}{R}", "{X}{W/U}{2/W}{S}{C}", "{10}{G}{G}{G}{G}{G}", "{W}{U}{B}{R}{G}{W}{U}{B}{R}{G}", "{Q}{E}{T}"]) {
        const pips = cost.match(/\{[^}]*\}/g)!.length;
        let plain = 0;
        for (let i = 0; i < pips; i += 1) plain += disc;
        expect(manaCostWidthPct(cost, disc), `${cost} @ ${disc}`).toBe(plain + (pips - 1) * GAP * disc);
      }
    }
  });

  it("a Phyrexian symbol — one colour or two — counts pipScale discs, from the one source", () => {
    expect(pipScale("rp")).toBe(1.2);
    expect(pipScale("gup")).toBe(1.2);
    const disc = 0.044;
    expect(manaCostWidthPct("{R/P}", disc)).toBe(disc * pipScale("rp"));
    expect(manaCostWidthPct("{G/U/P}", disc)).toBe(disc * pipScale("gup"));
    expect(manaCostWidthPct("{1}{R/P}{R/P}", disc)).toBeCloseTo(disc * (1 + 2 * 1.2 + 2 * 0.12), 12);
    // …and so the name's room shrinks by the extra fifth of a disc per symbol.
    for (const template of TEMPLATES) {
      const p = getFrameProfile(template);
      const d = p.costSizePct ?? p.title.sizePct;
      for (let n = 1; n <= 10; n += 1) {
        expect(titleBandRoomPct(p, plainTwin(n)) - titleBandRoomPct(p, scaledCost(n)), `${template} ${n}`).toBeCloseTo(n * 0.2 * d, 10);
      }
    }
  });
});

describe("the real bakes' parts are, together, every detached-cost template at both presets", () => {
  const parts = Array.from({ length: TITLE_ROOM_BAKE_PARTS }, (_, i) => i + 1);
  const sorted = (list: readonly string[]) => [...list].sort();

  it("every template is in exactly one part, no part is empty, and the parts' tests are the single file's eight", () => {
    const perPart = parts.map((part) => titleRoomTemplatesOfPart(part));
    for (const [i, templates] of perPart.entries()) expect(templates.length, `part ${i + 1}`).toBeGreaterThan(0);
    const all = perPart.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(sorted(all)).toEqual(sorted(TEMPLATES));
    // What the one block registered: each template at "hd" and "default".
    const whole = TEMPLATES.flatMap((template) => (["hd", "default"] as const).map((preset) => `${template} @ ${preset}`));
    const split = perPart.flatMap((templates) => titleRoomBakePlan(templates).map((t) => `${t.template} @ ${t.preset}`));
    expect(whole).toHaveLength(8);
    expect(split).toHaveLength(whole.length);
    expect(sorted(split)).toEqual(sorted(whole));
    for (const t of titleRoomBakePlan(TEMPLATES)) expect(t.title.startsWith(`${t.template} @ ${t.preset}: `), t.title).toBe(true);
    expect(() => titleRoomTemplatesOfPart(0)).toThrow();
    expect(() => titleRoomTemplatesOfPart(TITLE_ROOM_BAKE_PARTS + 1)).toThrow();
  });

  it("each part has its file, the file registers its own part and nothing else, and nothing else registers one", () => {
    const dir = path.join(process.cwd(), "tests", "unit", "render");
    const partFile = (part: number) => `title-room-scaled-pips-bake-${part}.test.ts`;
    const onDisk = fs.readdirSync(dir).filter((name) => /^title-room-scaled-pips-bake-.+\.test\.tsx?$/.test(name));
    expect(sorted(onDisk)).toEqual(sorted(parts.map(partFile)));
    for (const part of parts) {
      const code = fs
        .readFileSync(path.join(dir, partFile(part)), "utf8")
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("//"));
      expect(code, partFile(part)).toEqual(['import { describeTitleRoomBakes } from "./title-room-scaled-pips";', `describeTitleRoomBakes(${part});`]);
    }
    const callers: string[] = [];
    const walk = (folder: string) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && /^\s*describeTitleRoomBakes\(/m.test(fs.readFileSync(full, "utf8"))) callers.push(path.relative(dir, full));
      }
    };
    walk(path.join(process.cwd(), "tests"));
    expect(sorted(callers)).toEqual(sorted(parts.map(partFile)));
  });
});

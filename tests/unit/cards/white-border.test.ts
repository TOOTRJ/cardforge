import { describe, expect, it } from "vitest";
import {
  FRAME_ANATOMY_KEYS,
  NEW_CARD_ANATOMY,
  anatomyDefaults,
  anatomyOn,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  importedFormAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";
import { copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  WHITE_BORDER_HEX,
  WHITE_BORDER_KEYLINE_HEX,
  WHITE_BORDER_RGB,
  resolveWhiteBorder,
  wantsWhiteBorder,
  whiteBorderDataUrl,
  whiteBorderSvg,
} from "@/lib/cards/white-border";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { frameAnatomyPatchSchema, frameStyleSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.30 — the white border, the pure rules (era step E8). An ADDITION,
// opt-in per card: `frame_style.border` is "white" or absent. What holds:
//   • the piece is declared on exactly four PROFILES entries (the 1997 and
//     2003 frames and their lands), with each template's own measured box;
//   • the drawing is two flat rings — the white to the card's edge, the
//     keyline inside the frame box — and nothing else;
//   • a NEW card starts black (no default stamps the key), the form's
//     "black" is never stored, the save drops the key on every frame that
//     draws no white border, an import follows its printing;
//   • a profile that declares it keeps the mark off the border.
// Real bakes: tests/unit/render/white-border-bake.test.tsx; the save paths:
// white-border-save.test.ts; imports: tests/unit/scryfall/white-border-
// import.test.ts.
// ---------------------------------------------------------------------------

const SCOPE = ["retro", "retroland", "modern", "modernland"];

describe("where the white border is declared", () => {
  it("on exactly the 1997 and 2003 frames' four PROFILES entries", () => {
    expect(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).border)).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => SCOPE.includes(t)));
    expect(FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).whiteBorder)).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => SCOPE.includes(t)));
    // The 1993 pair is not in this step (its white-bordered prints are other
    // drawings on another box — era-e8 proof).
    for (const t of ["agclassic", "alphaland", "m15", "m15land"]) expect(getFrameProfile(t).whiteBorder, t).toBeUndefined();
  });

  it("with each master's black border as the box, and the prints' keyline", () => {
    for (const t of ["retro", "retroland"]) {
      expect(getFrameProfile(t).whiteBorder, t).toEqual({ insetPx: { top: 82, right: 73, bottom: 81, left: 73 }, keylinePx: 3 });
    }
    for (const t of ["modern", "modernland"]) {
      expect(getFrameProfile(t).whiteBorder, t).toEqual({ insetPx: { top: 70, right: 70, bottom: 70, left: 70 }, keylinePx: 4 });
    }
  });

  it("only beside a © slot INSIDE the frame box: no mark, credit or footer text is ever set on the white", () => {
    for (const t of SCOPE) {
      const profile = getFrameProfile(t);
      const { insetPx, keylinePx } = profile.whiteBorder!;
      expect(profile.copyrightSlot, t).toBeDefined();
      // The slot's baseline, and the footer's and the P/T's boxes, end above
      // the keyline; nothing starts left of it or ends right of it.
      const floor = 2100 - insetPx.bottom - keylinePx;
      expect((profile.copyrightSlot!.baselinePct / 100) * 2100, t).toBeLessThan(floor - 8);
      for (const slot of [profile.title, profile.type, profile.rules, profile.footer!, profile.pt!]) {
        const r = slot.rect;
        expect((r.topPct / 100) * 2100, t).toBeGreaterThan(insetPx.top + keylinePx);
        expect(((r.topPct + r.heightPct) / 100) * 2100, t).toBeLessThan(floor);
        expect((r.leftPct / 100) * 1500, t).toBeGreaterThan(insetPx.left + keylinePx);
        expect(((r.leftPct + r.widthPct) / 100) * 1500, t).toBeLessThan(1500 - insetPx.right - keylinePx);
      }
      // …and the mark is drawn through that slot on every master, never on
      // the border (copyrightSlotLayout answers for a display render).
      for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
        expect(copyrightSlotLayout(profile, key, { kind: "display" }), `${t}/${key}`).not.toBeNull();
      }
    }
  });
});

describe("the drawing", () => {
  it("is two even-odd rings on the HD canvas: the white to the edge, the keyline inside the box", () => {
    const svg = whiteBorderSvg({ insetPx: { top: 82, right: 73, bottom: 81, left: 73 }, keylinePx: 3 });
    expect(svg).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 2100" width="1500" height="2100" preserveAspectRatio="none">` +
        `<path fill="#ececea" fill-rule="evenodd" d="M0 0H1500V2100H0ZM73 82H1427V2019H73Z"/>` +
        `<path fill="#000000" fill-rule="evenodd" d="M73 82H1427V2019H73ZM76 85H1424V2016H76Z"/>` +
        `</svg>`,
    );
    expect(WHITE_BORDER_HEX).toBe("#ececea");
    expect(WHITE_BORDER_KEYLINE_HEX).toBe("#000000");
    expect([...WHITE_BORDER_RGB]).toEqual([0xec, 0xec, 0xea]);
    // A landscape master's canvas is turned.
    expect(whiteBorderSvg({ insetPx: { top: 70, right: 70, bottom: 70, left: 70 }, keylinePx: 4 }, true)).toContain('viewBox="0 0 2100 1500"');
  });

  it("is one data: URL per slot — the same bytes for both renderers and both finish masks", () => {
    const slot = getFrameProfile("modern").whiteBorder!;
    const url = whiteBorderDataUrl(slot);
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length))).toBe(whiteBorderSvg(slot));
    expect(whiteBorderDataUrl({ ...slot, insetPx: { ...slot.insetPx } })).toBe(url);
    expect(whiteBorderDataUrl(getFrameProfile("retro").whiteBorder!)).not.toBe(url);
  });

  it("is drawn for exactly \"white\" on a profile that declares it", () => {
    const modern = getFrameProfile("modern");
    expect(resolveWhiteBorder(modern, { border: "white" })).toBe(modern.whiteBorder);
    for (const style of [undefined, null, {}, { border: "black" }, { border: true }, { border: "White" }, { border: "silver" }]) {
      expect(resolveWhiteBorder(modern, style as never), JSON.stringify(style)).toBeNull();
      expect(wantsWhiteBorder(style as never)).toBe(false);
    }
    for (const t of ["m15", "agclassic", "m15borderless", "split"]) expect(resolveWhiteBorder(getFrameProfile(t), { border: "white" }), t).toBeNull();
  });
});

describe("the switch", () => {
  it("is an anatomy key no default stamps: a new card starts BLACK", () => {
    expect(FRAME_ANATOMY_KEYS).toContain("border");
    expect("border" in NEW_CARD_ANATOMY).toBe(false);
    for (const t of FRAME_TEMPLATE_VALUES) expect("border" in anatomyDefaults(t), t).toBe(false);
    for (const t of SCOPE) {
      expect("border" in newCardFrameStyle({ template: t as never }, "creature"), t).toBe(false);
      expect(newCardFrameStyle({ template: t as never, border: "white" }, "creature").border, t).toBe("white");
    }
    expect(anatomyOn({ border: "white" }, "border")).toBe(true);
    expect(anatomyOn({ border: "black" }, "border")).toBe(false);
    expect(anatomyOn({}, "border")).toBe(false);
  });

  it("is stored as \"white\" or not at all, and only where the frame draws it", () => {
    for (const t of SCOPE) {
      expect(normalizeAnatomy({ border: "white" }, t, "creature")).toEqual({ border: "white" });
      expect(normalizeAnatomy({ border: "black" }, t, "creature")).toEqual({});
    }
    for (const t of FRAME_TEMPLATE_VALUES.filter((v) => !SCOPE.includes(v))) {
      expect(normalizeAnatomy({ border: "white" }, t, "creature"), t).toEqual({});
    }
    expect(storedAnatomyOf({ border: "white" })).toEqual({ border: "white" });
    for (const bad of ["black", true, "silver", null]) expect(storedAnatomyOf({ border: bad })).toEqual({});
  });

  it("an edit flips it through frame_anatomy alone: \"white\" sets the key, \"black\" removes it", () => {
    const stored = { frameStyle: { template: "modern", finish: "regular", twoColor: true }, colorIdentity: ["red"] as const, cardType: "creature" };
    const on = applyFrameAnatomyPatch(stored, { border: "white" });
    expect(on).toEqual({ ok: true, frameStyle: { template: "modern", finish: "regular", twoColor: true, border: "white" }, colorIdentity: null });
    const off = applyFrameAnatomyPatch({ ...stored, frameStyle: { ...stored.frameStyle, border: "white" } }, { border: "black" });
    expect(off).toEqual({ ok: true, frameStyle: stored.frameStyle, colorIdentity: null });
    // On a frame without the piece the flip stores nothing.
    const m15 = applyFrameAnatomyPatch({ ...stored, frameStyle: { template: "m15" } }, { border: "white" });
    expect(m15).toMatchObject({ ok: true, frameStyle: { template: "m15" } });
    // The editor sends the key only when the form and the stored card differ.
    const values = (border?: string) => ({ frame_style: { template: "modern", ...(border ? { border } : {}) }, color_identity: ["red"] }) as never;
    expect(frameAnatomyPatchFor({ frame_style: { template: "modern" }, color_identity: ["red"] }, values())).toBeUndefined();
    expect(frameAnatomyPatchFor({ frame_style: { template: "modern" }, color_identity: ["red"] }, values("black"))).toBeUndefined();
    expect(frameAnatomyPatchFor({ frame_style: { template: "modern" }, color_identity: ["red"] }, values("white"))).toEqual({ border: "white" });
    expect(frameAnatomyPatchFor({ frame_style: { template: "modern", border: "white" }, color_identity: ["red"] }, values("black"))).toEqual({ border: "black" });
    expect(frameAnatomyPatchFor({ frame_style: { template: "modern", border: "white" }, color_identity: ["red"] }, values("white"))).toBeUndefined();
  });

  it("the schemas take the two words and nothing else", () => {
    for (const ok of ["white", "black"]) {
      expect(frameStyleSchema.safeParse({ template: "modern", border: ok }).success, ok).toBe(true);
      expect(frameAnatomyPatchSchema.safeParse({ border: ok }).success, ok).toBe(true);
    }
    for (const bad of ["silver", "gold", "White", true, null, 1, "#ffffff"]) {
      expect(frameStyleSchema.safeParse({ template: "modern", border: bad }).success, String(bad)).toBe(false);
      expect(frameAnatomyPatchSchema.safeParse({ border: bad }).success, String(bad)).toBe(false);
    }
  });

  it("an import follows its printing: white for a white-bordered one, cleared for any other", () => {
    const white = importedAnatomy({ printed_border: "white", color_identity: ["red"] }, "modern");
    expect(white.style.border).toBe("white");
    expect(importedFormAnatomy(white.style).border).toBe("white");
    const black = importedAnatomy({ color_identity: ["red"] }, "modern");
    expect("border" in black.style).toBe(false);
    expect("border" in importedFormAnatomy(black.style)).toBe(false);
    // Landed on a frame without the piece, the save drops it.
    expect(newCardFrameStyle({ template: "m15", ...importedAnatomy({ printed_border: "white" }, "m15").style }, "creature").border).toBeUndefined();
  });
});

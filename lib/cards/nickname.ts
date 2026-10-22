import { displayTextWidthEm, truncateDisplayLine } from "@/lib/cards/display-metrics";
import type { TextSlot } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The nickname line (TODO 6.3, owner 2026-10-21): a card with a NICKNAME
// (cards.nickname, migration 0141 — Scryfall's `flavor_name`) prints it in
// the title bar, and its own name (`title`) in small italic type on a dark
// plate that hangs from the top of the art window — the look of every
// black-bordered flavour-name printing (MSC #276–290 "Wakandan War Panther"
// over "Fleecemane Lion", SDS #3, TMC #48–56, SLD #478–483 / #697 / #710 /
// #726 / #1186–1188; read 2026-10-21 on 14 Scryfall PNGs at HD).
//
// ONE place both renderers read: whether the card draws it (a frame whose
// PROFILES entry declares `nickname`, a non-blank nickname, the FRONT face),
// the plate's art and box, and the name line's text and size. A card
// without a nickname — every card stored before 0141 — draws exactly as
// before: nothing here is consulted for it.
//
// The plate is PipGlyph's own drawing (an inline SVG `data:` URL, the
// station pieces' pattern — lib/cards/station-art.ts): no bucket object,
// nothing to warm, nothing to promote. The SAME string is the preview's
// <img>, the bake's <img> and both finish masks' overlay, drawn with the
// frame and under the finishes; the name line is ink, above them.
//
// Measured on the prints (HD px on 1500 × 2100; ±1 px, the PNGs are 745 px
// wide), symmetric about x = 750:
//   * the plate's rim is the frame's own PINLINE colour, 10 px, with a black
//     keyline either side (3 px); it leaves the art window's top pinline at
//     x ≈ 148, curves down to y 297.5 (its centre line: 167 @ 240, 184.5 @
//     250, 193.5 @ 260, 200 @ 270, 205 @ 280, 209.5 @ 290 — one cubic,
//     < 0.5 px from every point) and runs straight to the mirror side;
//   * inside, a dark wash the art shows through (the art below the plate is
//     dimmed to 0.43–0.65 of its level on eight prints): black-blue at α 0.6;
//   * a two-colour (pair-master) card's plate takes the pinline's two
//     colours, left and right, over the masters' 40 → 60 %W ramp (MSC #282,
//     green | white);
//   * the name: MPlantin italic, white, centred on x 750, baseline 274, caps
//     30.5 px tall — 54 px (Fleecemane Lion 362 px of ink, Voracious Hydra
//     354, Rhystic Study 295, Mind’s Eye 236: 50.4–53.6 px by the ink, a
//     little more by the advance). No print in the census shrinks it; a
//     name too long for the plate steps down here to NICKNAME_LINE_FLOOR_PX,
//     then ends in one "…" (truncateDisplayLine, as a name does).
//
// The pinline colours are the masters' own (rows 224–229 under the title
// bar, every key of every template that declares the plate: one palette —
// tests/unit/cards/nickname.test.ts reads it back off the masters when the
// frame cache is present).
// ---------------------------------------------------------------------------

/** Declared on a PROFILES entry: the frame prints the nickname plate.
 *  `keyMap` re-reads a master key's colour (a land frame's `c` is the land
 *  grey, `l`). Code-owned; never on a base another profile spreads. */
export type NicknameSlot = { keyMap?: Readonly<Partial<Record<string, string>>> };

type Rgb = readonly [number, number, number];

/** The masters' pinline colour per key (rows 224–229, x 280–320 / 1180–1220
 *  — the same on m15, m15artifact, m15land, m15vehicle, m15nyx, m15ub,
 *  m15ubartifact, m15ubland, m15snow and m15snowland). `l` is a colourless
 *  LAND's grey. */
export const NICKNAME_PINLINE: Readonly<Record<string, Rgb>> = {
  w: [244, 243, 236],
  u: [0, 117, 190],
  b: [58, 56, 50],
  r: [209, 77, 53],
  g: [42, 108, 69],
  m: [233, 212, 125],
  c: [223, 224, 224],
  l: [165, 152, 138],
};

/** The plate's drawn box (HD px): even edges, so it lands on whole px at
 *  the 750 px target too. */
export const NICKNAME_PLATE_BOX = { x: 120, y: 216, w: 1260, h: 92 } as const;

/** The name line's box (HD px): x 230–1270, y 238–280 — a line box centred
 *  in it sets MPlantin italic's baseline at 273.7 px at 54 px. */
export const NICKNAME_LINE_BOX = { x: 230, y: 238, w: 1040, h: 42 } as const;

/** The name's size and its floor (HD px; even, so whole at 750). */
export const NICKNAME_LINE_PX = 54;
export const NICKNAME_LINE_FLOOR_PX = 40;
/** The name's ink: print's white. */
export const NICKNAME_LINE_INK = "#ffffff";
const HD_WIDTH = 1500;
const HD_HEIGHT = 2100;

const pct = (px: number, of: number) => (px / of) * 100;

/** A Rect (percent of the card) from an HD box. */
function rectOf(box: { x: number; y: number; w: number; h: number }) {
  return {
    leftPct: pct(box.x, HD_WIDTH),
    topPct: pct(box.y, HD_HEIGHT),
    widthPct: pct(box.w, HD_WIDTH),
    heightPct: pct(box.h, HD_HEIGHT),
  };
}

export const NICKNAME_PLATE_RECT = rectOf(NICKNAME_PLATE_BOX);
export const NICKNAME_LINE_RECT = rectOf(NICKNAME_LINE_BOX);

/** The nickname a card prints: its text, trimmed; null for none / blank. */
export function cardNickname(nickname: string | null | undefined): string | null {
  const text = typeof nickname === "string" ? nickname.trim() : "";
  return text ? text : null;
}

/**
 * The card page's document title (TODO 6.3, decided 2026-10-21): the card's
 * NAME first — the H1, the slug, the canonical, the JSON-LD `name`, the deck
 * lists and the hubs all say it, as Scryfall titles a flavour-name printing
 * by its Oracle name — with the nickname in brackets, as Card Conjurer names
 * the file ("Fleecemane Lion (Wakandan War Panther)"), so a search for
 * either name finds the page. The name alone for every card without one.
 */
export function cardTitleWithNickname(name: string, nickname: string | null | undefined): string {
  const shown = cardNickname(nickname);
  return shown && shown !== name ? `${name} (${shown})` : name;
}

/**
 * The card page's line under its H1 (TODO 6.3, owner Round 80): "Printed
 * as" only where the card's frame PRINTS the nickname in its title bar —
 * on any other frame (the 2003 frame, a borderless one) the card shows its
 * name, so the nickname is "Also known as". Null without a nickname.
 */
export function nicknamePageLine(
  nickname: string | null | undefined,
  layout: { nickname?: NicknameSlot },
): { label: "Printed as" | "Also known as"; nickname: string } | null {
  const shown = cardNickname(nickname);
  if (!shown) return null;
  return { label: frameDrawsNickname(layout) ? "Printed as" : "Also known as", nickname: shown };
}

/** Whether a frame prints a nickname plate at all (the creator's note under
 *  the field reads it). */
export function frameDrawsNickname(layout: { nickname?: NicknameSlot }): boolean {
  return Boolean(layout.nickname);
}

/** The two pinline colours of a master key (`wu` → w | u, `wu-h` the same,
 *  `g` → g | g), through the slot's keyMap; an unknown key reads as `c`. */
export function nicknamePinlineOf(masterKey: string, keyMap?: NicknameSlot["keyMap"]): readonly [Rgb, Rgb] {
  const key = masterKey.replace(/-legendary$/, "").replace(/-h$/, "");
  const colour = (k: string): Rgb => NICKNAME_PINLINE[keyMap?.[k] ?? k] ?? NICKNAME_PINLINE.c;
  if (key.length === 2 && NICKNAME_PINLINE[key[0]] && NICKNAME_PINLINE[key[1]]) return [colour(key[0]), colour(key[1])];
  const one = colour(key);
  return [one, one];
}

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const rgb = (c: Rgb) => `rgb(${c.join(",")})`;

/** The plate's centre line (HD px): down the left side from the window's
 *  top pinline, along the bottom, up the mirror side. */
const PLATE_PATH = "M148 227 C177 251 192 240 212 297.5 L1288 297.5 C1308 240 1323 251 1352 227";

const artCache = new Map<string, string>();

/** The plate as an inline SVG `data:` URL, drawn over NICKNAME_PLATE_RECT:
 *  the dark wash (clipped below the frame's own black line under the
 *  pinline, y ≥ 237), the black keylines (y ≥ 232: never over the frame's
 *  pinline), the pinline-coloured rim (y ≥ 223: it joins the frame's). */
export function nicknamePlateArt(masterKey: string, keyMap?: NicknameSlot["keyMap"]): string {
  const [left, right] = nicknamePinlineOf(masterKey, keyMap);
  const id = `${rgb(left)}|${rgb(right)}`;
  let url = artCache.get(id);
  if (url) return url;
  const { x, y, w, h } = NICKNAME_PLATE_BOX;
  const same = left.every((v, i) => v === right[i]);
  const rim = same ? rgb(left) : "url(#rim)";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `<defs>` +
    `<clipPath id="wash"><rect x="${x}" y="237" width="${w}" height="${y + h - 237}"/></clipPath>` +
    `<clipPath id="keyline"><rect x="${x}" y="232" width="${w}" height="${y + h - 232}"/></clipPath>` +
    `<clipPath id="pinline"><rect x="${x}" y="223" width="${w}" height="${y + h - 223}"/></clipPath>` +
    (same
      ? ""
      : `<linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="600" y1="0" x2="900" y2="0"><stop offset="0" stop-color="${rgb(left)}"/><stop offset="1" stop-color="${rgb(right)}"/></linearGradient>`) +
    `</defs>` +
    `<path d="${PLATE_PATH} Z" fill="rgb(16,16,22)" fill-opacity="0.6" clip-path="url(#wash)"/>` +
    `<path d="${PLATE_PATH}" fill="none" stroke="rgb(0,0,0)" stroke-width="16" stroke-linejoin="round" clip-path="url(#keyline)"/>` +
    `<path d="${PLATE_PATH}" fill="none" stroke="${rim}" stroke-width="10" stroke-linejoin="round" clip-path="url(#pinline)"/>` +
    `</svg>`;
  url = svgUrl(svg);
  artCache.set(id, url);
  return url;
}

/** The name line fitted to the plate: the text both renderers draw (cut
 *  with one "…" only past the floor) and its size as a fraction of the
 *  card's width (an even HD px: whole at the 750 px target). */
export function fitNicknameLine(name: string): { text: string; sizePct: number } {
  const room = NICKNAME_LINE_BOX.w;
  const em = displayTextWidthEm(name, { face: "bodyItalic" });
  let px = NICKNAME_LINE_PX;
  while (px > NICKNAME_LINE_FLOOR_PX && em * px > room) px -= 2;
  const text =
    em * px > room
      ? truncateDisplayLine(name, room / px, (s) => displayTextWidthEm(s, { face: "bodyItalic" }))
      : name;
  return { text, sizePct: px / HD_WIDTH };
}

/** What a face draws for its nickname — null when it draws none (the
 *  frame declares no plate, the nickname is blank, or there is no
 *  nickname: every card before 0141). `titleText` replaces the name in the
 *  title bar; the plate is drawn with the frame; `line` is the card's own
 *  name on it. */
export type NicknameDrawing = {
  titleText: string;
  plate: { href: string; rect: typeof NICKNAME_PLATE_RECT };
  line: { text: string; sizePct: number; rect: typeof NICKNAME_LINE_RECT };
};

/** The name line as a text slot both renderers' bands draw: MPlantin
 *  italic, white, centred in its box, at the fitted size. */
export function nicknameLineSlot(drawing: NicknameDrawing): TextSlot {
  return {
    rect: drawing.line.rect,
    sizePct: drawing.line.sizePct,
    colorHex: NICKNAME_LINE_INK,
    align: "center",
    font: "body",
    italic: true,
    weight: 400,
  };
}

export function resolveNickname(
  layout: { nickname?: NicknameSlot },
  nickname: string | null | undefined,
  title: string,
  masterKey: string,
): NicknameDrawing | null {
  const shown = cardNickname(nickname);
  if (!layout.nickname || !shown) return null;
  const line = fitNicknameLine(title);
  return {
    titleText: shown,
    plate: { href: nicknamePlateArt(masterKey, layout.nickname.keyMap), rect: NICKNAME_PLATE_RECT },
    line: { ...line, rect: NICKNAME_LINE_RECT },
  };
}

// ---------------------------------------------------------------------------
// Pip Forge (beta tool `pip-forge`, migration 0188) — the shapes the browser
// and the server agree on: what a maker sends to forge a pip, what a forged
// pip is (its two files, its disc colour, its colour card) and the
// six-colour wheel the card places the new colour on.
//
// A forged pip is NOT a custom pip: it is kept in the forge (`forged_pips`),
// and becomes one of the maker's six overrides (custom_pips, W U B R G C)
// only when they say so — through the one custom-pip writer
// (lib/pips/write-pip.ts), as an upload would.
//
// Client-safe: plain data and zod, no server imports.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { CUSTOM_PIP_SYMBOLS } from "@/lib/pips/override";
import { SUBJECT_MAX } from "@/lib/tools/set-symbol/prompt";

export const PIP_FORGE_SLUG = "pip-forge" as const;

/** Pips one maker keeps in the forge (a safety limit, not a plan cap). */
export const PIP_LIBRARY_MAX = 100;
export const PIP_NAME_MAX = 40;
/** The colour idea's limit (optional: what the colour stands for). */
export const IDEA_MAX = 300;

// --- the disc ---------------------------------------------------------------

const HEX_RE = /^#[0-9a-f]{6}$/;

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** A colour as the forge stores it: `#rrggbb`, lower case. Null when the
 *  value isn't one. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return HEX_RE.test(v) ? v : null;
}

/** The forge's own disc tones: pale-to-mid like the five mana discs
 *  (lib/cards/mana-gem.ts MANA_GEM_BG), so a forged pip sits beside them
 *  on a cost row. Any other colour is the maker's to pick. */
export const DISC_SWATCHES = [
  { hex: "#e8c27a", label: "Amber" },
  { hex: "#c5abdc", label: "Violet" },
  { hex: "#8fcac0", label: "Teal" },
  { hex: "#e6a3b4", label: "Rose" },
  { hex: "#a9b6c6", label: "Slate" },
  { hex: "#d7a46d", label: "Copper" },
  { hex: "#b9d17e", label: "Lime" },
  { hex: "#4a3f63", label: "Dusk" },
] as const;

/** The ink a glyph is drawn in on a disc: the mana symbols' own dark ink,
 *  or white on a dark disc (as {Q}'s white arrow on its near-black disc). */
export const PIP_INK_DARK = "#150d08";
export const PIP_INK_LIGHT = "#ffffff";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminanceOf(hex: string): number {
  const v = normaliseHex(hex) ?? "#000000";
  const r = parseInt(v.slice(1, 3), 16);
  const g = parseInt(v.slice(3, 5), 16);
  const b = parseInt(v.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The ink with the higher contrast on `disc`. */
export function inkFor(disc: string): string {
  const l = luminanceOf(disc);
  return contrast(l, luminanceOf(PIP_INK_DARK)) >= contrast(l, luminanceOf(PIP_INK_LIGHT)) ? PIP_INK_DARK : PIP_INK_LIGHT;
}

// --- the six-colour wheel -----------------------------------------------------

/** The five, in the wheel's order (clockwise from the top). */
export const WHEEL_COLOURS = ["W", "U", "B", "R", "G"] as const;
export type WheelColour = (typeof WHEEL_COLOURS)[number];

/** Where the sixth colour sits: between two neighbours on the wheel. */
export const WHEEL_GAPS = ["WU", "UB", "BR", "RG", "GW"] as const;
export type WheelGap = (typeof WHEEL_GAPS)[number];

export const WHEEL_COLOUR_NAMES: Record<WheelColour, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export type WheelPlace = {
  /** The six, clockwise from the top: the five and "X" (the new colour). */
  order: readonly (WheelColour | "X")[];
  /** Its two neighbours. */
  allies: [WheelColour, WheelColour];
  /** Two steps away on either side. */
  enemies: [WheelColour, WheelColour];
  /** Straight across the wheel. */
  opposite: WheelColour;
};

/**
 * The new colour's place on a six-colour wheel from the gap it sits in —
 * ONE rule, so the card's allies and enemies always agree with the wheel
 * drawn beside them (the model names the gap and says why; it never lists
 * allies of its own).
 */
export function wheelPlace(gap: WheelGap): WheelPlace {
  const after = WHEEL_COLOURS.indexOf(gap[0] as WheelColour);
  const order: (WheelColour | "X")[] = [...WHEEL_COLOURS];
  order.splice(after + 1, 0, "X");
  const at = order.indexOf("X");
  const step = (n: number) => order[(at + n + 6) % 6] as WheelColour;
  return { order, allies: [step(-1), step(1)], enemies: [step(-2), step(2)], opposite: step(3) };
}

// --- the colour card ----------------------------------------------------------

export type ColourCard = {
  /** The colour's name ("Amber"). */
  name: string;
  /** One line: what it is the colour of. */
  epithet: string;
  philosophy: string;
  values: string[];
  /** The colour's new keyword. */
  keyword: { name: string; reminder: string };
  /** Its other mechanics (2–4; with the keyword, 3–5 in all). */
  mechanics: { name: string; text: string }[];
  /** What the colour can't do. */
  cannot: string[];
  /** Its basic land type ("Grove"). */
  basicLand: string;
  sitsBetween: WheelGap;
  alliesWhy: string;
  enemiesWhy: string;
};

const short = (max: number) => z.string().trim().min(1).max(max);

/** A stored card, read back (never trusted further than this). */
export const colourCardSchema = z.object({
  name: short(24),
  epithet: short(80),
  philosophy: short(500),
  values: z.array(short(32)).min(1).max(6),
  keyword: z.object({ name: short(32), reminder: short(240) }),
  mechanics: z.array(z.object({ name: short(48), text: short(200) })).min(1).max(5),
  cannot: z.array(short(160)).min(1).max(5),
  basicLand: short(24),
  sitsBetween: z.enum(WHEEL_GAPS),
  alliesWhy: short(260),
  enemiesWhy: short(260),
});

// --- requests -------------------------------------------------------------------

export const forgePipSchema = z.object({
  subject: z.string().max(SUBJECT_MAX * 2),
  idea: z.string().max(IDEA_MAX * 2).optional().default(""),
  /** The disc's colour, or null: let the colour card pick it. */
  disc: z.string().nullable().optional().default(null),
});
export type ForgePipInput = z.infer<typeof forgePipSchema>;

export const pipNameSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Give the pip a name.").max(PIP_NAME_MAX, `Keep the name under ${PIP_NAME_MAX} characters.`));

export const recolourPipSchema = z.object({
  id: z.string().uuid(),
  disc: z.string().refine((v) => normaliseHex(v) !== null, "Pick a colour."),
});
export const renamePipSchema = z.object({ id: z.string().uuid(), name: pipNameSchema });
export const deletePipSchema = z.object({ id: z.string().uuid() });
export const usePipSchema = z.object({ id: z.string().uuid(), symbol: z.enum(CUSTOM_PIP_SYMBOLS) });

// --- a forged pip -----------------------------------------------------------------

export type PipFiles = {
  /** The pip: 256 px PNG, the disc and its glyph (the custom-pip format). */
  pip: string;
  /** The glyph alone (black on transparent, 512 px, placed as on the pip):
   *  what a new disc colour is painted from, no AI. */
  glyph: string;
};

export type Legibility = { at16: number; at24: number };

export type ForgedPip = {
  id: string;
  name: string;
  prompt: string;
  idea: string | null;
  disc: string;
  ink: string;
  files: PipFiles;
  card: ColourCard;
  legibility: Legibility;
  createdAt: string;
  updatedAt: string;
};

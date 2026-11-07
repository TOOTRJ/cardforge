// ---------------------------------------------------------------------------
// Set Symbol Studio — the shapes the browser and the server agree on (zod,
// shared: the form checks what the action checks again).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { CUTOUT_MODES, DEFAULT_TOLERANCE } from "./cutout";
import { SUBJECT_MAX, SYMBOL_STYLES } from "./prompt";

export const SYMBOL_NAME_MAX = 60;
/** Symbols one maker keeps in the studio (a safety limit, not a plan cap). */
export const SYMBOL_LIBRARY_MAX = 200;
/** The biggest side the cut-out works on; a bigger picture is scaled down
 *  first (the browser's preview and the server alike). */
export const WORKING_MAX_PX = 1024;
/** An upload's limit in bytes: under Vercel's 4.5 MB function body limit
 *  (the picture travels as a server-action body) and the set-covers
 *  bucket's 5 MB, as Pip Forge's 4 MB. */
export const SYMBOL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const INK_CHOICES = ["one", "colour"] as const;
export type InkChoice = (typeof INK_CHOICES)[number];

export const symbolNameSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Give the symbol a name.").max(SYMBOL_NAME_MAX, `Keep the name under ${SYMBOL_NAME_MAX} characters.`));

export const cutoutSettingsSchema = z.object({
  mode: z.enum(CUTOUT_MODES).default("auto"),
  tolerance: z.coerce.number().int().min(0).max(100).default(DEFAULT_TOLERANCE),
  ink: z.enum(INK_CHOICES).default("one"),
});
export type CutoutSettings = z.infer<typeof cutoutSettingsSchema>;

export const generateSymbolSchema = z.object({
  subject: z.string().max(SUBJECT_MAX * 2),
  style: z.enum(SYMBOL_STYLES).default("bold"),
  name: symbolNameSchema.optional(),
});
export type GenerateSymbolInput = z.infer<typeof generateSymbolSchema>;

export const recutSymbolSchema = z.object({
  id: z.string().uuid(),
  settings: cutoutSettingsSchema,
});

export const renameSymbolSchema = z.object({ id: z.string().uuid(), name: symbolNameSchema });
export const deleteSymbolSchema = z.object({ id: z.string().uuid() });

/** Every file of one version, as public URLs. */
export type SymbolFiles = {
  auto: string;
  common: string;
  uncommon: string;
  rare: string;
  mythic: string;
  plain: string;
  watermark: string;
  source: string;
};

/** What the studio and the creator's pickers read about a symbol. */
export type StudioSymbol = {
  id: string;
  name: string;
  source: "ai" | "upload";
  prompt: string | null;
  settings: CutoutSettings;
  files: SymbolFiles;
  legibility: number | null;
  createdAt: string;
  updatedAt: string;
};

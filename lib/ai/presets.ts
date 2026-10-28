// ---------------------------------------------------------------------------
// The AI dialog's theme and art-style presets — DATA, not code. A new preset
// is one more entry here: the dialog lists it, the jobs route accepts its id
// and assembles the prompt from it (assemblePrompt).
//
//   - `id`     — stable, kebab-case; what the request carries. Never rename
//                one that has shipped (an open dialog may still send it).
//   - `label`  — the chip's words, in sentence case.
//   - `prompt` — the fragment the DESIGNER reads: the world for a theme, the
//                tone of names and flavor for a style.
//   - `art`    — styles only: the look. The designer reads it with the tone
//                (composeStyle); the painter reads the style's name in
//                "Rendered strictly in … style." (composeArtStyle) and the
//                look as "Art direction: …" (styleArtBrief).
//
// Original, generic words only: no Wizards-owned or real-world proper nouns,
// no living artist's name (the art prompt never names one).
//
// Ranking (lib/ai/card-design.ts reads theme / style, then the spark): the
// maker's own TWIST outranks the preset, and both outrank the random spark
// (lib/ai/design-variety.ts), which the prompt already places below "the
// theme above".
//
// Pure: no React, no server imports — shared by the dialog, the jobs route
// and the unit tests.
// ---------------------------------------------------------------------------

export type ThemePreset = {
  id: string;
  label: string;
  prompt: string;
};

export type StylePreset = {
  id: string;
  label: string;
  prompt: string;
  art: string;
};

/** The chip that leaves the choice to the AI — no preset words at all (the
 *  spark and the designer decide, as before the presets). */
export const SURPRISE_PRESET_ID = "surprise";

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "gothic-horror",
    label: "Gothic horror",
    prompt: "gothic horror — fog-bound villages, cursed nobility, werewolves, restless spirits and the hunters who stand against them",
  },
  {
    id: "high-fantasy",
    label: "High fantasy",
    prompt: "high fantasy — noble knights, ancient elves, dragons, wizard towers and a kingdom-spanning quest",
  },
  {
    id: "steampunk",
    label: "Steampunk",
    prompt: "steampunk — brass automatons, airships, steam-powered inventors and soot-black foundry cities",
  },
  {
    id: "cosmic-horror",
    label: "Cosmic horror",
    prompt: "cosmic horror — vast unknowable entities, forbidden knowledge, madness and the stars going wrong",
  },
  {
    id: "pirates",
    label: "Pirates",
    prompt: "high-seas piracy — sea-raiders, buried treasure, sea monsters, mutinies and storm-wracked islands",
  },
  {
    id: "ancient-myth",
    label: "Ancient myth",
    prompt: "ancient myth — capricious gods, demigod heroes, oracles, monsters of legend and temples on sunlit cliffs",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    prompt: "cyberpunk — neon megacities, chrome-limbed street samurai, rogue code-spirits and corporate overlords",
  },
  {
    id: "fairy-tale",
    label: "Fairy tale",
    prompt: "fairy tale — enchanted forests, wicked bargains, clever animals, curses broken by courage and kindness",
  },
  {
    id: "wild-west",
    label: "Wild west",
    prompt: "a weird wild west — frontier towns, outlaw gunslingers, desert spirits and dusty railroads into the unknown",
  },
  {
    id: "undersea",
    label: "Undersea",
    prompt: "an undersea realm — merfolk courts, leviathans, sunken ruins and bioluminescent trenches",
  },
  {
    id: "desert-empire",
    label: "Desert empire",
    prompt: "a desert empire — god-pharaohs, sand-scoured tombs, scarab cults and caravans under a burning sun",
  },
  {
    id: "samurai",
    label: "Samurai",
    prompt: "a samurai epic — honor-bound warriors, kami of river and mountain, ninja clans and cherry-blossom shrines",
  },
  {
    id: "post-apocalypse",
    label: "Post-apocalypse",
    prompt: "a world after the fall — scavengers, mutated beasts, ruined cities reclaimed by wild magic",
  },
];

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "classic-oil",
    label: "Classic oil painting",
    prompt: "classic painted fantasy — grounded, dramatic, timeless names and flavor",
    art: "a classic fantasy oil painting with rich brushwork, dramatic lighting and deep color",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    prompt: "gentle watercolor — soft, lyrical names and flavor",
    art: "a watercolor painting with soft washes, bleeding edges and visible paper texture",
  },
  {
    id: "ink-wash",
    label: "Ink and wash",
    prompt: "ink and wash — spare, poetic names and flavor",
    art: "an ink-and-wash painting with confident brush strokes, sparse grey washes and generous negative space",
  },
  {
    id: "anime",
    label: "Anime",
    prompt: "anime — bold, energetic names and flavor",
    art: "an anime illustration with clean line art, cel shading and vivid color",
  },
  {
    id: "stained-glass",
    label: "Stained glass",
    prompt: "stained glass — reverent, iconic names and flavor",
    art: "a stained-glass window with jewel-toned glass panes and dark leaded outlines, lit from behind",
  },
  {
    id: "art-nouveau",
    label: "Art nouveau",
    prompt: "art nouveau — elegant, ornate names and flavor",
    art: "an art nouveau illustration with flowing organic lines, decorative borders of vines and a muted gilded palette",
  },
  {
    id: "pixel-art",
    label: "Pixel art",
    prompt: "pixel art — playful, retro-game names and flavor",
    art: "detailed 16-bit pixel art with a limited palette and crisp hard-edged pixels",
  },
  {
    id: "comic-book",
    label: "Comic book",
    prompt: "comic book — punchy, heroic names and flavor",
    art: "a comic-book illustration with bold inks, halftone shading and dynamic action",
  },
  {
    id: "dark-fantasy",
    label: "Dark fantasy",
    prompt: "dark fantasy — grim, foreboding names and flavor",
    art: "a dark fantasy painting with heavy shadows, a desaturated palette and an ominous mood",
  },
  {
    id: "storybook",
    label: "Storybook",
    prompt: "a storybook — warm, whimsical names and flavor",
    art: "a storybook illustration with warm gouache color, soft outlines and a whimsical charm",
  },
  {
    id: "woodcut",
    label: "Woodcut",
    prompt: "an old woodcut — stark, folkloric names and flavor",
    art: "a woodcut print with bold carved lines, cross-hatching and two or three flat ink colors",
  },
];

/** The longest twist a maker may type (the dialog's maxLength; the server
 *  clips anything past it — never refuses). */
export const TWIST_MAX = 160;

// Control characters (a pasted tab, a stray NUL) and the Unicode bidi
// overrides, which could reorder what the designer reads.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** A twist as the prompt takes it: unsafe characters out, whitespace folded,
 *  trimmed and clipped to TWIST_MAX. "" when nothing is left. */
export function cleanTwist(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, TWIST_MAX).trim();
}

export function themePresetById(id: string | null | undefined): ThemePreset | null {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function stylePresetById(id: string | null | undefined): StylePreset | null {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * The `theme` the designer reads, from a preset and the maker's twist. The
 * twist outranks the preset: it comes first and is named as the maker's own
 * words; the preset is the world it is set in. Neither → undefined (the
 * spark and the designer decide, as before the presets).
 */
export function composeTheme(presetId: string | null | undefined, twist: string | null | undefined): string | undefined {
  const preset = themePresetById(presetId);
  const own = cleanTwist(twist);
  if (own && preset) return `${own} (the maker's own words: they win) — set in ${preset.prompt}`;
  if (own) return own;
  return preset?.prompt;
}

/**
 * The `style` the DESIGNER reads (lib/ai/card-design.ts "Art & tone
 * style: …"): the look its art prompt must render and the tone of the names
 * and flavor — the same ranking as composeTheme.
 */
export function composeStyle(presetId: string | null | undefined, twist: string | null | undefined): string | undefined {
  const preset = stylePresetById(presetId);
  const own = cleanTwist(twist);
  const look = preset ? `${preset.label.toLowerCase()}: ${preset.art}; ${preset.prompt}` : undefined;
  if (own && look) return `${own} (the maker's own words: they win), over ${look}`;
  return own || look;
}

/**
 * The style the PAINTER reads in "Rendered strictly in … style." (the fill
 * step): the twist, then the preset's name. The preset's full look goes in
 * the art brief (`styleArtBrief`), after it.
 */
export function composeArtStyle(presetId: string | null | undefined, twist: string | null | undefined): string | undefined {
  const preset = stylePresetById(presetId);
  const own = cleanTwist(twist);
  const label = preset?.label.toLowerCase();
  if (own && label) return `${own}, ${label}`;
  return own || label;
}

/** The preset's look as a sentence of the art prompt, or "" without one. */
export function styleArtBrief(presetId: string | null | undefined): string {
  const preset = stylePresetById(presetId);
  return preset ? `Art direction: ${preset.art}.` : "";
}

/** What a fill request's preset fields become (the jobs route). */
export type AssembledPrompt = {
  theme?: string;
  style?: string;
  artStyle?: string;
  styleArt: string;
};

/**
 * The prompt parts of a fill from its preset fields — null when the request
 * names none of them (an older client: its `theme` / `style` are used as
 * sent, byte for byte). Unknown preset ids are dropped, twists cleaned and
 * clipped (cleanTwist): never a refusal.
 */
export function assemblePrompt(input: {
  theme_preset?: string | null;
  theme_twist?: string | null;
  style_preset?: string | null;
  style_twist?: string | null;
}): AssembledPrompt | null {
  const named =
    input.theme_preset != null || input.theme_twist != null || input.style_preset != null || input.style_twist != null;
  if (!named) return null;
  return {
    theme: composeTheme(input.theme_preset, input.theme_twist),
    style: composeStyle(input.style_preset, input.style_twist),
    artStyle: composeArtStyle(input.style_preset, input.style_twist),
    styleArt: styleArtBrief(input.style_preset),
  };
}

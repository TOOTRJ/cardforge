// ---------------------------------------------------------------------------
// The glossary (/glossary, TODO NV9) — ONE list of the words on a Magic card
// and the words PipGlyph uses, read by the page AND by the creator's
// "Proxy, import or remix?" key (components/creator/card-glossary.tsx,
// `CARD_ORIGIN_TERMS`), so a definition is written once.
//
// The card-origin vocabulary (owner 2026-10-28, TODO DK2) is the creator's
// four, in its order:
//
//   Proxy    — any card made on PipGlyph, including one started from a real
//              card. The umbrella word (and the one people print).
//   Import   — a card started from a real card through Scryfall.
//   Remix    — a new card started from another PipGlyph card, anyone's.
//   Original — a card made from scratch.
//
// "Custom proxy" is retired: every card made here is a proxy. Nothing tags a
// card by these words — they describe where it started. Magic's own sense of
// "proxy" (a printed stand-in at the table) is its own entry,
// `proxy-printing`.
//
// Rules for an entry: a definition is plain and short, true to Magic and to
// what PipGlyph does TODAY (deck AI is paused — lib/ai/deck-ai-pause.ts); a
// guide link names a page that exists; the searchable words use the quotes
// and apostrophes a keyboard types (' and "), so the page's filter matches
// what people type without a fold. Pure data, client-safe.
// ---------------------------------------------------------------------------

export type GlossaryLink = { href: string; label: string };

export type GlossaryTerm = {
  /** The anchor: /glossary#<id>. Lowercase words joined by hyphens. */
  id: string;
  term: string;
  /** Other names people search for ("CMC" for mana value). */
  aliases?: readonly string[];
  definition: string;
  /** Whose word it is: Magic's (and card making's), or PipGlyph's own. */
  source: "magic" | "pipglyph";
  /** The guide that explains it at length. */
  guide?: GlossaryLink;
  /** Where to try it — usually the creator. */
  tryIt?: GlossaryLink;
  /** Other entries worth reading next, by id. */
  related?: readonly string[];
};

/** The creator is where most of these words become a card. */
const CREATOR: GlossaryLink = { href: "/create", label: "Try it in the creator" };

const ANATOMY: GlossaryLink = {
  href: "/articles/mtg-card-anatomy-explained",
  label: "Anatomy of an MTG card",
};
const LAYOUTS: GlossaryLink = {
  href: "/articles/mtg-card-layouts-explained",
  label: "MTG card layouts explained",
};
const MANA_SYMBOLS: GlossaryLink = {
  href: "/articles/mtg-mana-symbols-complete-guide",
  label: "The complete guide to MTG mana symbols",
};
const COMMANDER: GlossaryLink = {
  href: "/articles/designing-custom-commander-cards",
  label: "Designing custom Commander cards",
};
const ORACLE_TEXT: GlossaryLink = {
  href: "/articles/how-to-write-mtg-oracle-text",
  label: "How to write MTG oracle text",
};
const PRINTING: GlossaryLink = {
  href: "/articles/how-to-print-proxy-mtg-cards",
  label: "How to print proxy MTG cards",
};
const IMPORT_REMIX: GlossaryLink = {
  href: "/faq#import-remix",
  label: "Scryfall import and remixing, answered",
};

/** Every entry, A to Z (a test holds the order, so the file reads like the
 *  page). */
export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    id: "bleed",
    term: "Bleed",
    definition:
      "Extra card printed past the cut line, so a cut that drifts shows a little more card instead of a white sliver. Print shops usually ask for 1/8 inch, and Plus and Pro downloads can add it.",
    source: "magic",
    guide: PRINTING,
    related: ["proxy-printing"],
  },
  {
    id: "color-identity",
    term: "Color identity",
    definition:
      "Every color of mana symbol in a card's cost and rules text, plus any color the card is defined as. In Commander, each card in a deck must fit inside its commander's color identity.",
    source: "magic",
    guide: COMMANDER,
    related: ["commander", "color-pie"],
  },
  {
    id: "color-pie",
    term: "Color pie",
    definition:
      "Magic's split of what each of the five colors does well and what it is meant to be bad at, which keeps them balanced. Giving a color something outside its slice is a color-pie break.",
    source: "magic",
    guide: {
      href: "/articles/mtg-color-pie-explained",
      label: "The MTG color pie explained",
    },
    related: ["color-identity"],
  },
  {
    id: "commander",
    term: "Commander",
    aliases: ["EDH"],
    definition:
      "A multiplayer format: a 100-card deck with one copy of each card except basic lands, led by a legendary creature, its commander, which waits in the command zone. The word also means that creature.",
    source: "magic",
    guide: COMMANDER,
    related: ["color-identity", "legendary"],
  },
  {
    id: "double-faced-card",
    term: "Double-faced card",
    aliases: ["DFC"],
    definition:
      "A card with a face on each side and no Magic card back. A transforming card turns over during play; on a modal one you choose which face to play.",
    source: "magic",
    guide: LAYOUTS,
    tryIt: CREATOR,
    related: ["transform", "modal-double-faced-card"],
  },
  {
    id: "emblem",
    term: "Emblem",
    definition:
      "A lasting effect a planeswalker's ability leaves behind. It has no color, cost or types, nothing can remove it, and it stays for the rest of the game. In the creator, pick Token, then Emblem.",
    source: "magic",
    guide: {
      href: "/articles/designing-custom-mtg-tokens",
      label: "Designing custom MTG tokens",
    },
    tryIt: CREATOR,
    related: ["loyalty", "token"],
  },
  {
    id: "flavor-text",
    term: "Flavor text",
    definition:
      "The italic lines at the bottom of the text box that tell a story, often as a quote. They have no effect on the game.",
    source: "magic",
    guide: ANATOMY,
    related: ["reminder-text"],
  },
  {
    id: "frame",
    term: "Frame",
    definition:
      "The border and boxes around a card's art and text, the part that makes a card look like 1997, 2015 or a modern showcase. PipGlyph's frames span three decades of card design.",
    source: "magic",
    guide: {
      href: "/articles/mtg-card-frame-eras-explained",
      label: "MTG card frame eras explained",
    },
    tryIt: CREATOR,
    related: ["frame-verification"],
  },
  {
    id: "frame-verification",
    term: "Frame verification",
    definition:
      "Before the creator offers a frame in a color, PipGlyph checks it against scans of printed cards, so the name, pips and text sit where they do on a real card. A color still being checked says \"Soon\".",
    source: "pipglyph",
    tryIt: CREATOR,
    related: ["frame"],
  },
  {
    id: "hybrid-mana",
    term: "Hybrid mana",
    definition:
      "A mana symbol split between two colors, paid with either one. A card with a white-blue hybrid symbol is both white and blue.",
    source: "magic",
    guide: MANA_SYMBOLS,
    related: ["pip", "phyrexian-mana"],
  },
  {
    id: "import",
    term: "Import",
    definition:
      "A card started from a real card, pulled in from Scryfall. Change its art or words and it becomes your version.",
    source: "pipglyph",
    guide: IMPORT_REMIX,
    tryIt: CREATOR,
    related: ["proxy", "remix", "oracle-text"],
  },
  {
    id: "keyword-ability",
    term: "Keyword ability",
    aliases: ["keyword"],
    definition:
      "A word that stands for a longer rule, like flying, trample or lifelink. A keyword usually sits on its own line, capitalized there, often with reminder text.",
    source: "magic",
    guide: {
      href: "/articles/mtg-keyword-abilities-list",
      label: "MTG keyword abilities: the complete list",
    },
    related: ["reminder-text", "templating"],
  },
  {
    id: "legendary",
    term: "Legendary",
    definition:
      "A supertype for unique characters, places and things: if you control two legendary permanents with the same name, you keep one and the rest go to the graveyard. Modern frames crown them.",
    source: "magic",
    guide: ANATOMY,
    tryIt: CREATOR,
    related: ["commander", "type-line"],
  },
  {
    id: "loyalty",
    term: "Loyalty",
    definition:
      "A planeswalker's life total, in the shield at its bottom right. Each ability adds or removes loyalty as its cost, and a planeswalker with no loyalty goes to the graveyard.",
    source: "magic",
    guide: {
      href: "/articles/how-to-design-a-custom-planeswalker",
      label: "How to design a custom planeswalker",
    },
    tryIt: CREATOR,
    related: ["emblem", "power-and-toughness"],
  },
  {
    id: "mana-cost",
    term: "Mana cost",
    definition:
      "The mana symbols in a card's top right corner: what you pay to cast it. Lands have none, and neither does a transforming card's back face.",
    source: "magic",
    guide: MANA_SYMBOLS,
    tryIt: CREATOR,
    related: ["pip", "mana-value"],
  },
  {
    id: "mana-value",
    term: "Mana value",
    aliases: ["MV", "converted mana cost", "CMC"],
    definition:
      "The total amount of mana in a card's cost, whatever its colors: two generic and two green is a mana value of 4. X counts as zero except while the spell is being cast. It used to be called converted mana cost.",
    source: "magic",
    guide: MANA_SYMBOLS,
    related: ["mana-cost"],
  },
  {
    id: "modal-double-faced-card",
    term: "Modal double-faced card",
    aliases: ["MDFC"],
    definition:
      "A double-faced card where you choose which face to play, such as a spell on one side and a land on the other. It never turns over once it is on the battlefield.",
    source: "magic",
    guide: LAYOUTS,
    tryIt: CREATOR,
    related: ["double-faced-card", "transform"],
  },
  {
    id: "oracle-text",
    term: "Oracle text",
    definition:
      "A card's current official wording, kept up to date by Wizards of the Coast and shown on sites like Scryfall. It can differ from the words printed on an older copy.",
    source: "magic",
    guide: ORACLE_TEXT,
    related: ["templating", "import"],
  },
  {
    id: "original",
    term: "Original",
    definition: "A card made from scratch.",
    source: "pipglyph",
    tryIt: CREATOR,
    related: ["proxy", "import", "remix"],
  },
  {
    id: "phyrexian-mana",
    term: "Phyrexian mana",
    definition:
      "A mana symbol marked with the Phyrexian glyph, paid with one mana of its color or 2 life.",
    source: "magic",
    guide: MANA_SYMBOLS,
    related: ["pip", "hybrid-mana"],
  },
  {
    id: "pip",
    term: "Pip",
    aliases: ["mana symbol"],
    definition:
      "One mana symbol in a cost or in rules text, such as a colored circle, a number for generic mana or a hybrid split. PipGlyph's pip editor builds any cost and takes your own symbols too.",
    source: "magic",
    guide: MANA_SYMBOLS,
    tryIt: { href: "/mana-pip-editor", label: "See the pip editor" },
    related: ["mana-cost", "hybrid-mana", "phyrexian-mana"],
  },
  {
    id: "pipglyph-mark",
    term: "PipGlyph mark",
    definition:
      "The small pipglyph.com mark on every card image PipGlyph shows: the gallery, share images and the saved card. A Plus or Pro member's own downloads come without it.",
    source: "pipglyph",
    related: ["watermark"],
  },
  {
    id: "power-and-toughness",
    term: "Power and toughness",
    aliases: ["P/T"],
    definition:
      "The two numbers at a creature's bottom right, written 3/3. Power is the damage it deals in combat; toughness is the damage it takes to destroy it.",
    source: "magic",
    guide: {
      href: "/articles/how-to-design-a-custom-mtg-creature",
      label: "How to design a custom MTG creature",
    },
    tryIt: CREATOR,
    related: ["loyalty"],
  },
  {
    id: "proxy",
    term: "Proxy",
    definition:
      "Any card made on PipGlyph. A card you start from a real Magic card is a proxy too, and any proxy can be printed for your table.",
    source: "pipglyph",
    guide: PRINTING,
    tryIt: CREATOR,
    related: ["proxy-printing", "import", "remix", "original"],
  },
  {
    id: "proxy-printing",
    term: "Proxy (printing)",
    definition:
      "A printed stand-in for a Magic card, used in casual games and playtesting when everyone at the table agrees. Proxies aren't allowed at sanctioned tournaments, and they're never for sale.",
    source: "magic",
    guide: PRINTING,
    related: ["proxy", "bleed"],
  },
  {
    id: "rarity",
    term: "Rarity",
    definition:
      "How often a card turns up in packs: common, uncommon, rare or mythic rare, shown by its set symbol in black, silver, gold or orange-red.",
    source: "magic",
    guide: { href: "/articles/mtg-rarity-explained", label: "MTG rarity explained" },
    tryIt: CREATOR,
    related: ["set-symbol"],
  },
  {
    id: "reminder-text",
    term: "Reminder text",
    definition:
      "Italic words in parentheses that explain a keyword or mechanic. They are there to help and change nothing about how the card plays.",
    source: "magic",
    guide: ORACLE_TEXT,
    related: ["keyword-ability", "flavor-text"],
  },
  {
    id: "remix",
    term: "Remix",
    definition:
      "A new card started from another card made on PipGlyph, whether someone else's or one of yours. The card it came from keeps its credit.",
    source: "pipglyph",
    guide: IMPORT_REMIX,
    tryIt: { href: "/gallery", label: "Find a card to remix" },
    related: ["proxy", "import", "original", "restyle-with-ai"],
  },
  {
    id: "restyle-with-ai",
    term: "Restyle with AI",
    definition:
      "Gives the cards of a deck new names, flavor text and AI art in one theme, keeping their rules, as new cards of your own. It is paused while decks are rebuilt.",
    source: "pipglyph",
    related: ["remix"],
  },
  {
    id: "saga",
    term: "Saga",
    definition:
      "An enchantment that tells a story in chapters. It gets a lore counter as it enters and after each of your draw steps, each chapter happens in turn, and after the last one it is sacrificed.",
    source: "magic",
    guide: LAYOUTS,
    tryIt: CREATOR,
  },
  {
    id: "set-symbol",
    term: "Set symbol",
    aliases: ["expansion symbol"],
    definition:
      "The small symbol at the right of the type line that shows which set a card is from; its color shows the rarity. In the creator, use PipGlyph's mark, pick one from a library or upload your own.",
    source: "magic",
    guide: ANATOMY,
    tryIt: CREATOR,
    related: ["rarity", "type-line"],
  },
  {
    id: "templating",
    term: "Templating",
    definition:
      "Magic's fixed patterns for wording rules text, like \"When this creature enters,\" or \"Target creature gets +2/+2 until end of turn.\" Good templating makes a custom card read like a printed one.",
    source: "magic",
    guide: {
      href: "/articles/mtg-templating-cookbook",
      label: "An MTG templating cookbook",
    },
    related: ["oracle-text", "keyword-ability"],
  },
  {
    id: "token",
    term: "Token",
    definition:
      "A permanent made by an effect rather than cast from a deck, often shown with a token card. It stops existing if it leaves the battlefield.",
    source: "magic",
    guide: {
      href: "/articles/designing-custom-mtg-tokens",
      label: "Designing custom MTG tokens",
    },
    tryIt: CREATOR,
    related: ["emblem"],
  },
  {
    id: "transform",
    term: "Transform",
    aliases: ["TDFC", "transforming double-faced card"],
    definition:
      "To turn a double-faced card to its other face during play, like a werewolf becoming a beast. The back face has no mana cost of its own.",
    source: "magic",
    guide: LAYOUTS,
    tryIt: CREATOR,
    related: ["double-faced-card", "modal-double-faced-card"],
  },
  {
    id: "type-line",
    term: "Type line",
    definition:
      "The bar under the art that names a card's types: its supertype and card type, then its subtypes after the dash, as in \"Legendary Creature — Elf Druid\".",
    source: "magic",
    guide: ANATOMY,
    tryIt: CREATOR,
    related: ["legendary", "set-symbol"],
  },
  {
    id: "watermark",
    term: "Watermark",
    definition:
      "A faint symbol printed behind a card's rules text, such as a guild's crest. In the creator you can pick a mana symbol, one of PipGlyph's own marks, or upload your own.",
    source: "magic",
    tryIt: CREATOR,
    related: ["pipglyph-mark"],
  },
];

/** The creator's "Proxy, import or remix?" key: the four card-origin words,
 *  in its order (owner 2026-10-28, TODO DK2.1). */
export const CARD_ORIGIN_TERM_IDS = ["proxy", "import", "remix", "original"] as const;

function termById(id: string): GlossaryTerm {
  const found = GLOSSARY_TERMS.find((entry) => entry.id === id);
  if (!found) throw new Error(`glossary: no term "${id}"`);
  return found;
}

/** The four card-origin entries, as the creator lists them. */
export const CARD_ORIGIN_TERMS: readonly GlossaryTerm[] = CARD_ORIGIN_TERM_IDS.map(termById);

/** The page's path and an entry's link. */
export const GLOSSARY_PATH = "/glossary";

export function glossaryHref(id: string): string {
  return `${GLOSSARY_PATH}#${id}`;
}

/** The entry an id names, or undefined. */
export function glossaryTerm(id: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((entry) => entry.id === id);
}

/** A to Z — the jump list's letters, every one (an empty letter is drawn,
 *  dimmed). */
export const GLOSSARY_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/** The letter an entry files under. */
export function glossaryLetterOf(entry: Pick<GlossaryTerm, "term">): string {
  return entry.term.charAt(0).toUpperCase();
}

export type GlossaryLetterGroup = { letter: string; terms: GlossaryTerm[] };

/** Entries grouped by letter, letters in order, each group's entries in the
 *  list's order. Letters with no entry are left out. */
export function groupGlossaryByLetter(terms: readonly GlossaryTerm[]): GlossaryLetterGroup[] {
  const groups = new Map<string, GlossaryTerm[]>();
  for (const entry of terms) {
    const letter = glossaryLetterOf(entry);
    const group = groups.get(letter);
    if (group) group.push(entry);
    else groups.set(letter, [entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, entries]) => ({ letter, terms: entries }));
}

/** The text the filter searches: the name, the other names and the
 *  definition. */
function searchableText(entry: GlossaryTerm): string {
  return [entry.term, ...(entry.aliases ?? []), entry.definition].join(" ").toLowerCase();
}

/** The entries whose words hold every word of `query` (case-insensitive,
 *  any order). A blank query keeps every entry. */
export function filterGlossary(terms: readonly GlossaryTerm[], query: string): GlossaryTerm[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...terms];
  return terms.filter((entry) => {
    const text = searchableText(entry);
    return words.every((word) => text.includes(word));
  });
}

import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";
import { allFaqEntries, faqTopicOf, type FaqEntry } from "@/lib/content/faq";

// ---------------------------------------------------------------------------
// The help centre (/help, TODO NV6) — how to USE PipGlyph, kept apart from
// the design guides in Learn (mixing the two was the old "Guides"
// confusion). Eight sections, each a static page at /help/<slug>: a short
// how-to where the section has a task worth walking through, then its
// questions, in groups.
//
// The answers are lib/content/faq.ts — every entry lands in exactly ONE
// group of ONE section (tests/unit/content/help.test.ts), under its stable
// `id` as the anchor (/help/decks#decklist-formats). /faq is a 308 to /help;
// its nine topic anchors (/faq#exports…) arrive as /help#exports (a browser
// keeps the fragment across a redirect) and `helpForwardTarget` sends them
// on to the section that holds them.
//
// ONE FAQPage per answer, site-wide (Google: mark up one instance of a
// repeated Q&A). An answer from a landing page's topic (`guideHref`: the
// card maker, the pip editor, the AI generator, the comparison) is marked up
// on THAT page, as it has been since those pages shipped, and shown here
// with a link back to it; every other answer is marked up on its help
// section. `faqMarkupHomeOf` is the one rule both sides read.
//
// The how-tos describe the app as it is TODAY — each step names the label
// the screen shows. A renamed button or a moved step is a change here too.
// ---------------------------------------------------------------------------

export type HelpHowToStep = {
  title: string;
  body: string;
};

export type HelpHowTo = {
  /** Anchor on the section page; unique across the help centre. */
  id: string;
  title: string;
  /** One sentence under the title (and on the hub's how-to cards). */
  summary: string;
  steps: readonly HelpHowToStep[];
  /** One closing line: a caveat or the next thing to read. */
  tip?: string;
  cta: { href: string; label: string };
};

export type HelpGroup = {
  /** Anchor of the group's heading; unique across the help centre. */
  id: string;
  title: string;
  /** FaqEntry ids, in reading order. */
  entryIds: readonly string[];
};

export type HelpSection = {
  slug: string;
  title: string;
  /** One line: the hub's card, the meta description. */
  description: string;
  /** The paragraph under the section's H1. */
  intro: string;
  howTo?: HelpHowTo;
  groups: readonly HelpGroup[];
};

export const HELP_PATH = "/help";

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description:
      "What PipGlyph is, what it costs, how it compares with other card makers, and a walk through your first custom card.",
    intro:
      "PipGlyph is a free, browser-based creator for custom Magic: The Gathering-style cards. Start here for what you need to begin, how it compares with the other card makers, and a walk through your first card.",
    howTo: {
      id: "make-your-first-card",
      title: "Make your first card",
      summary: "From a blank frame to a saved card, one creator step at a time.",
      steps: [
        {
          title: "Open the creator",
          body: "Go to /create and sign in, or make a free account: signed out, the creator is read-only. Choose “Blank canvas” in the “Start with…” row.",
        },
        {
          title: "Choose what it is",
          body: "On the Card step, pick the card type, then its frame and color. The defaults are a fine place to start, so you can skip straight past.",
        },
        {
          title: "Name it and add art",
          body: "On Identity, type the name and upload a picture, or drag one onto the box. It fills the frame's art window; drag it to move it, zoom it, or press R to fit it again.",
        },
        {
          title: "Write the text",
          body: "On Text & stats, click pips to build the mana cost, pick the rarity and write the rules text — the toolbar above it inserts symbols like {T}. Add flavor text, and power and toughness for a creature.",
        },
        {
          title: "Check the preview",
          body: "The live preview shows the card as it will save, on every step. Set & collector info is optional: a set symbol, a set code and a collector number.",
        },
        {
          title: "Save it",
          body: "On Publish, choose Public or Unlisted, or tick “Save as a draft” to keep it private, then click Save. Nothing is saved before that, and the editor asks before you leave with changes unsaved.",
        },
      ],
      tip: "Once it's saved, the card's page has Download and Share — Printing & exports covers every format.",
      cta: { href: "/create", label: "Open the creator" },
    },
    groups: [
      {
        id: "the-basics",
        title: "The basics",
        entryIds: [
          "what-is-an-mtg-card-maker",
          "is-pipglyph-free-to-use",
          "do-i-need-an-account",
          "is-it-legal-to-make-custom-cards",
        ],
      },
      {
        id: "other-card-makers",
        title: "PipGlyph and other card makers",
        entryIds: [
          "pipglyph-vs-cardsmith-and-card-conjurer",
          "best-mtg-card-maker",
          "card-conjurer-alternative",
          "why-card-conjurer-was-taken-down",
          "are-card-makers-legal",
        ],
      },
    ],
  },
  {
    slug: "card-creator",
    title: "The card creator",
    description:
      "Building a card in the creator: card types, planeswalkers, rules text, saving drafts, and the mana symbols — including your own.",
    intro:
      "The creator builds a card in steps — what it is, its name and art, its text and stats, its set details, then publishing — with a live preview beside every step. These answers cover building a card and the mana symbols on it.",
    howTo: {
      id: "use-your-own-mana-symbols",
      title: "Use your own mana symbols",
      summary: "Swap the standard pips for icons of your own, on every card you own.",
      steps: [
        {
          title: "Make the icons",
          body: "One square image for each symbol you want to replace: white, blue, black, red, green or colorless. Each is cropped to a circle at 256 × 256, so keep the design inside it.",
        },
        {
          title: "Upload them",
          body: "In Settings, open Custom pips and upload an image for a symbol — or choose “Customize pips” beside the Cost field in the creator. Both open the same list.",
        },
        {
          title: "See them everywhere",
          body: "Your icons replace the standard symbols on every card you own: the live preview, gallery tiles, card pages and downloads. Costs and color identity work exactly as before.",
        },
        {
          title: "Change your mind",
          body: "“Reset to standard” puts a symbol back the way it was.",
        },
      ],
      tip: "Visitors always see a card with its owner's pips, so a set you share keeps one look.",
      cta: { href: "/mana-pip-editor", label: "More about the pip editor" },
    },
    groups: [
      {
        id: "building-a-card",
        title: "Building a card",
        entryIds: [
          "how-do-i-make-a-custom-card",
          "custom-planeswalker-cards",
          "writing-oracle-text",
          "does-the-editor-autosave",
        ],
      },
      {
        id: "mana-symbols",
        title: "Mana pips & symbols",
        entryIds: [
          "what-is-a-mana-pip-editor",
          "supported-mana-symbols",
          "hybrid-and-phyrexian-pips",
          "custom-mana-symbols",
          "custom-pips-on-exports",
          "is-the-pip-editor-free",
        ],
      },
    ],
  },
  {
    slug: "importing",
    title: "Importing & remixing",
    description:
      "Start from a real Magic card through Scryfall, or remix a card from the community, then make it your own in the creator.",
    intro:
      "Two ways to start from a card that already exists: import a real Magic card from Scryfall, or remix a public card someone made on PipGlyph. Either way you get your own editable copy, and the new card remembers where it came from.",
    howTo: {
      id: "import-and-customize-a-real-card",
      title: "Import a real card and customize it",
      summary: "Pull a printed card's text and art into the creator, then change what you like.",
      steps: [
        {
          title: "Search for the card",
          body: "In the creator, choose “Search a real card” (sign in first). Type a name, or use Scryfall's search syntax, such as t:dragon r:mythic. Switch to “Tokens & emblems” to find those.",
        },
        {
          title: "Pick a printing",
          body: "Choose the card, then the printing you want. The printings can be narrowed by look: borderless, showcase, full art, old border and more.",
        },
        {
          title: "Choose the frame and the art",
          body: "Take the printing's frame (or the nearest one PipGlyph has), or keep your current frame. Tick “Also import artwork” to bring the printing's art in as a starting point.",
        },
        {
          title: "Use it as a starting point",
          body: "“Use as starting point” fills the form: name, cost, type line, rules text, stats, rarity, flavor text, artist and set details.",
        },
        {
          title: "Make it yours",
          body: "Change anything — rename it, rewrite the text, upload your own art in place of the original — then save it as you would any card.",
        },
      ],
      tip: "Imported text and artwork remain subject to their original copyright; the Disclaimer page has the full notice.",
      cta: { href: "/create", label: "Open the creator" },
    },
    groups: [
      {
        id: "imports-and-remixes",
        title: "Imports & remixes",
        entryIds: ["import-a-real-card", "what-is-remixing", "rebuild-card-conjurer-cards"],
      },
    ],
  },
  {
    slug: "decks",
    title: "Decks",
    description:
      "Build a deck from a pasted decklist, turn its real cards into versions of your own, and copy, export or print the list.",
    intro:
      "A deck gathers real Magic cards and your own designs in one list, with a format, boards and a cover. Paste a list from another deck site to start, then turn the real cards you want into versions of your own.",
    // The deck vocabulary of TODO DK2.2 ("Customize", "Imported", "Edited"),
    // and the New deck dialog of TODO DK4.
    howTo: {
      id: "build-a-deck-from-a-decklist",
      title: "Build a deck from a decklist",
      summary: "Paste a list from any deck site, review it, then customize the cards you want.",
      steps: [
        {
          title: "Start a deck",
          body: "In My Decks, choose “New deck”. Give it a name and a format — the format sets its size and copy limits — and choose who sees it: public, unlisted or private.",
        },
        {
          title: "Paste your list",
          body: "Paste the list from MTG Arena, Moxfield, Archidekt, ManaBox or MTGO — or plain lines like “4 Lightning Bolt” — into the same dialog and create the deck: the cards it matches exactly are added with it, and a best guess is kept as the name you typed, for you to check. Or leave it empty and use “Import decklist” on the deck page.",
        },
        {
          title: "Review it",
          body: "On the deck page, “Import decklist” lets you check each row's quantity and board, the cards marked as a best guess, and the names Scryfall couldn't find, which come in as placeholders, before the cards are added. Importing uses none of your saved-card slots; the dialogs say how many you have left for the cards you customize.",
        },
        {
          title: "Customize a card",
          body: "Open a real card in the deck (marked Imported) and choose Customize. The creator opens with the card filled in, and the version you save takes its place in the deck, marked Edited.",
        },
        {
          title: "Share the list",
          body: "“Copy decklist” in the deck's header copies it as plain text or in Arena format, free for everyone. On Pro, Export makes a ZIP or a print PDF of your custom cards.",
        },
      ],
      tip: `${DECK_AI_PAUSED_MESSAGE} Deck guides written before the pause stay on their decks.`,
      cta: { href: "/decks", label: "Browse community decks" },
    },
    groups: [
      {
        id: "deck-questions",
        title: "Deck questions",
        entryIds: [
          "what-goes-in-a-deck",
          "decklist-formats",
          "import-uses-slots",
          "how-many-decks",
          "copy-export-or-print-a-deck",
          "ai-deck-building",
        ],
      },
    ],
  },
  {
    slug: "printing",
    title: "Printing & exports",
    description:
      "Card downloads, print-ready PDFs at true card size, 800 ppi files, bleeds, print sheets and MakePlayingCards exports.",
    intro:
      "Every card downloads as an image, and paid plans add clean, full-resolution print files: PDFs at true card size, 800 ppi images, a bleed for print shops and MakePlayingCards' own format. Proxies are for your own table, never for sale.",
    howTo: {
      id: "print-your-cards",
      title: "Print your cards",
      summary: "From one card on a home printer to a stack of sheets.",
      steps: [
        {
          title: "Open Download",
          body: "On a card's page, choose Download. The Image tab is open on every plan; the PDF tab is Plus and Pro.",
        },
        {
          title: "Pick the file",
          body: "Every account gets a 750 × 1050 image with the PipGlyph mark — fine for a test print. Plus and Pro get the clean 1500 × 2100 image and the print files: 800 ppi, a 1/8″ bleed, or sized for MakePlayingCards.",
        },
        {
          title: "Print one card at true size",
          body: "On Plus or Pro, choose PDF, then “One card”: the page is exactly 2.5 × 3.5 inches. Print at 100% with “fit to page” turned off, and measure the first card with a ruler.",
        },
        {
          title: "Fill a sheet",
          body: "On Pro, “Sheet of copies” puts 9 copies on US Letter or A4. For different cards, select them in My Cards and choose “Print / download”.",
        },
        {
          title: "Print a deck",
          body: "On Pro, a deck's Export makes a print PDF of its custom cards; real cards not customized yet are listed on a checklist page instead.",
        },
        {
          title: "Cut and sleeve",
          body: "Cut along the guides. Heavy matte stock holds up best — or sleeve each card in front of a basic land.",
        },
      ],
      tip: "Cut guides print only in the margins and gaps, never on a card.",
      cta: { href: "/articles/how-to-print-proxy-mtg-cards", label: "Read the printing guide" },
    },
    groups: [
      {
        id: "downloads",
        title: "Downloads",
        entryIds: [
          "export-formats",
          "exports-match-the-preview",
          "full-resolution-art",
          "why-a-card-looks-different",
        ],
      },
      {
        id: "print-files",
        title: "Printing",
        entryIds: [
          "can-i-print-my-cards",
          "print-at-real-card-size",
          "print-resolution",
          "what-is-a-bleed",
          "mixed-print-sheets",
          "makeplayingcards",
        ],
      },
    ],
  },
  {
    slug: "ai-and-credits",
    title: "AI & credits",
    description:
      "Generating cards and ideas with AI in the creator, what a credit buys, refunds, and how plans and credit packs add more.",
    intro:
      "The creator's AI drafts a whole card and paints its art, brainstorms ideas, or fills just the fields you pick. It runs on credits: every account starts with some, Plus and Pro add more each month, and packs top you up.",
    howTo: {
      id: "use-ai-credits",
      title: "Use AI credits",
      summary: "What a credit buys, and how to spend one well.",
      steps: [
        {
          title: "Check your balance",
          body: "Signed in, your credits show in the site header. A new account starts with 5; Plus adds 30 a month and Pro 100.",
        },
        {
          title: "Pick a tool",
          body: "In the creator's “Start with…” row, “Generate with AI” drafts a whole card and paints its art, and “Get ideas” brainstorms three text-only concepts to pick from. Each run costs one credit.",
        },
        {
          title: "Steer it",
          body: "Choose a theme and an art style (a preset, your own twist, or both), and tick the fields the AI may write; everything unticked stays as it is. On Pro, “For a deck” designs the card for one of your decks.",
        },
        {
          title: "Confirm the cost",
          body: "PipGlyph shows what the run uses before it starts — two credits for a double-faced card with art for both faces. A run that fails refunds its credits.",
        },
        {
          title: "Edit, then save",
          body: "The result lands in the form. Change anything you like; nothing is saved until you click Save.",
        },
        {
          title: "Top up",
          body: "Out of credits? A pack of 10, 30 or 100 never expires, and Plus and Pro members pay 20% less for packs. Or choose a plan that adds credits every month.",
        },
      ],
      tip: DECK_AI_PAUSED_MESSAGE,
      cta: { href: "/pricing", label: "See plans and packs" },
    },
    groups: [
      {
        id: "ai-generation",
        title: "AI generation",
        entryIds: [
          "what-is-an-ai-card-generator",
          "generate-a-card-with-ai",
          "ai-artwork",
          "ai-keyword-abilities",
          "ai-card-balance",
          "edit-ai-output",
          "ai-vs-chatgpt",
        ],
      },
      {
        id: "credits-and-plans",
        title: "Credits & plans",
        entryIds: [
          "is-the-ai-generator-free",
          "failed-generation-credits",
          "credit-balance",
          "is-pipglyph-free",
        ],
      },
    ],
  },
  {
    slug: "sharing-and-community",
    title: "Sharing & community",
    description:
      "Public, unlisted and private cards, sharing a card with your playgroup, design challenges, and how trending works.",
    intro:
      "Every card is private, unlisted or public — only public cards reach the gallery and your profile. Share a card's page and it unfurls with its picture; enter a design challenge and the community decides the spotlight.",
    groups: [
      {
        id: "sharing",
        title: "Sharing & visibility",
        entryIds: ["public-unlisted-private", "share-with-your-playgroup", "unpublish-a-card"],
      },
      {
        id: "challenges",
        title: "Challenges & trending",
        entryIds: ["design-challenges", "enter-a-challenge", "how-trending-works"],
      },
    ],
  },
  {
    slug: "account-and-privacy",
    title: "Account & privacy",
    description:
      "Download a copy of everything you've made, choose the emails PipGlyph sends you, or delete your account.",
    intro:
      "Everything you make belongs to your account. Settings is where you download a copy of it, choose which emails reach you, or delete the account for good.",
    groups: [
      {
        id: "your-account",
        title: "Your account & data",
        entryIds: ["download-your-data", "email-preferences", "delete-your-account"],
      },
    ],
  },
];

export const HELP_SECTION_SLUGS: readonly string[] = HELP_SECTIONS.map((section) => section.slug);

/** The landing pages a topic's answers live on, as the help centre names
 *  them in its "From the … page" link. Keys are `FaqTopic.guideHref`. */
export const LANDING_PAGE_LABELS: Readonly<Record<string, string>> = {
  "/mtg-card-maker": "MTG card maker",
  "/mana-pip-editor": "Mana pip editor",
  "/ai-mtg-card-generator": "AI card generator",
  "/best-mtg-card-makers": "Best MTG card makers",
};

/** Where the old /faq#<topic> anchors go. Only the nine topics /faq had;
 *  each lands on the section (and group) holding that topic's answers. */
export const LEGACY_FAQ_ANCHORS: Readonly<Record<string, string>> = {
  "card-maker": "/help/getting-started",
  "mana-pips": "/help/card-creator#mana-symbols",
  "ai-generation": "/help/ai-and-credits#ai-generation",
  choosing: "/help/getting-started#other-card-makers",
  sharing: "/help/sharing-and-community#sharing",
  exports: "/help/printing",
  "import-remix": "/help/importing",
  challenges: "/help/sharing-and-community#challenges",
  accounts: "/help/getting-started#do-i-need-an-account",
};

export function helpSectionPath(slug: string): string {
  return `${HELP_PATH}/${slug}`;
}

export function getHelpSection(slug: string): HelpSection | undefined {
  return HELP_SECTIONS.find((section) => section.slug === slug);
}

const ENTRIES_BY_ID = new Map(allFaqEntries().map((entry) => [entry.id, entry]));

export function faqEntryById(id: string): FaqEntry | undefined {
  return ENTRIES_BY_ID.get(id);
}

/** A group's answers, in its order. An id with no entry throws: a typo in
 *  the section list must fail the build, not drop an answer quietly. */
export function helpGroupEntries(group: HelpGroup): FaqEntry[] {
  return group.entryIds.map((id) => {
    const entry = ENTRIES_BY_ID.get(id);
    if (!entry) throw new Error(`Help group "${group.id}" names an unknown FAQ entry "${id}"`);
    return entry;
  });
}

export function helpSectionEntries(section: HelpSection): FaqEntry[] {
  return section.groups.flatMap(helpGroupEntries);
}

/** The section that shows an entry. */
export function helpSectionOf(entryId: string): HelpSection | undefined {
  return HELP_SECTIONS.find((section) =>
    section.groups.some((group) => group.entryIds.includes(entryId)),
  );
}

/** An answer's address in the help centre. */
export function helpEntryHref(entryId: string): string | null {
  const section = helpSectionOf(entryId);
  return section ? `${helpSectionPath(section.slug)}#${entryId}` : null;
}

/** The ONE page whose FAQPage JSON-LD carries an entry: its landing page
 *  when its topic has one, else its help section. */
export function faqMarkupHomeOf(entryId: string): string | null {
  const topic = faqTopicOf(entryId);
  if (topic?.guideHref) return topic.guideHref;
  const section = helpSectionOf(entryId);
  return section ? helpSectionPath(section.slug) : null;
}

/** The landing page an entry also lives on (shown as a link beside it). */
export function landingPageOf(entryId: string): { href: string; label: string } | null {
  const href = faqTopicOf(entryId)?.guideHref;
  if (!href) return null;
  return { href, label: LANDING_PAGE_LABELS[href] ?? href };
}

/** The answers a section page marks up — the ones whose home it is. */
export function helpSectionMarkupEntries(section: HelpSection): FaqEntry[] {
  const path = helpSectionPath(section.slug);
  return helpSectionEntries(section).filter((entry) => faqMarkupHomeOf(entry.id) === path);
}

/** Every anchor a section page carries: its how-to, its groups, its answers. */
export function helpSectionAnchors(section: HelpSection): string[] {
  return [
    ...(section.howTo ? [section.howTo.id] : []),
    ...section.groups.flatMap((group) => [group.id, ...group.entryIds]),
  ];
}

/** Every fragment the hub forwards, and where to: a section's slug to its
 *  page, any anchor of a section page (an answer, a how-to, a group — unique
 *  across the help centre) to that anchor there, and the old /faq topic
 *  anchors to the section holding their answers. Built on the server and
 *  handed to the hub's forwarder (components/content/help-hash-forward). */
export function helpForwardTargets(): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const section of HELP_SECTIONS) {
    const path = helpSectionPath(section.slug);
    targets[section.slug] = path;
    for (const anchor of helpSectionAnchors(section)) targets[anchor] = `${path}#${anchor}`;
  }
  return { ...targets, ...LEGACY_FAQ_ANCHORS };
}

/** Where a fragment on /help goes (`#exports` → "/help/printing"), or null
 *  to stay on the hub. */
export function helpForwardTarget(hash: string): string | null {
  const key = hash.startsWith("#") ? hash.slice(1) : hash;
  const targets = helpForwardTargets();
  return Object.hasOwn(targets, key) ? targets[key] : null;
}

/** One searchable item of the hub's filter box. */
export type HelpSearchItem = {
  kind: "answer" | "how-to";
  id: string;
  title: string;
  /** The text the filter reads besides the title (never rendered whole). */
  text: string;
  href: string;
  sectionTitle: string;
};

export function helpSearchItems(): HelpSearchItem[] {
  return HELP_SECTIONS.flatMap((section) => {
    const path = helpSectionPath(section.slug);
    const howTo: HelpSearchItem[] = section.howTo
      ? [
          {
            kind: "how-to",
            id: section.howTo.id,
            title: section.howTo.title,
            text: [
              section.howTo.summary,
              // "Title: body", so a snippet reads as sentences.
              ...section.howTo.steps.map((step) => `${step.title}: ${step.body}`),
            ].join(" "),
            href: `${path}#${section.howTo.id}`,
            sectionTitle: section.title,
          },
        ]
      : [];
    const answers = helpSectionEntries(section).map((entry) => ({
      kind: "answer" as const,
      id: entry.id,
      title: entry.q,
      text: entry.a,
      href: `${path}#${entry.id}`,
      sectionTitle: section.title,
    }));
    return [...howTo, ...answers];
  });
}

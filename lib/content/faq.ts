// ---------------------------------------------------------------------------
// FAQ content — the single source of truth for every Q&A on the site.
//
// The three SEO landing pages render their own topic's entries (unchanged
// UX), and /faq renders ALL topics with one combined FAQPage JSON-LD.
// Keeping the copy here means a reworded answer updates the landing page,
// the hub, and the structured data together.
//
// Writing style: every answer is a direct, self-contained response to a
// real user query — that's the unit AI answer engines extract and cite.
// ---------------------------------------------------------------------------

import { isSetsEnabled } from "@/lib/sets/flags";

export type FaqEntry = { q: string; a: string };

export type FaqTopic = {
  /** Anchor slug on /faq (e.g. #card-maker) */
  slug: string;
  title: string;
  /** The landing page that carries this topic, when one exists. */
  guideHref?: string;
  entries: FaqEntry[];
};

// --- The card maker (rendered on /mtg-card-maker) --------------------------

export const CARD_MAKER_FAQ: FaqEntry[] = [
  {
    q: "What is an MTG card maker?",
    a: "An MTG card maker is a web tool that lets you design custom Magic: The Gathering cards. You fill in the card's name, mana cost, type line, oracle text, power/toughness (or loyalty for planeswalkers), and upload art. The tool renders your inputs as a card that looks like a real MTG card. PipGlyph is a free, browser-based MTG card maker with a live preview editor.",
  },
  {
    q: "How do I make a custom MTG card?",
    a: "To make a custom MTG card on PipGlyph: (1) Go to the card creator at /create. (2) Enter the card's name and mana cost using pip notation like {2}{R}{R}. (3) Choose the card type — creature, instant, sorcery, enchantment, artifact, planeswalker, land, or battle. (4) Write the oracle text for the card's abilities. (5) Set power and toughness for creatures, or loyalty for planeswalkers. (6) Upload art or use the art prompt tool. (7) Download as PNG or publish to the gallery.",
  },
  {
    q: "Is PipGlyph free to use?",
    a: "Yes. PipGlyph is completely free to use. You can preview and design cards without creating an account. Creating an account (also free) lets you save cards, build sets, publish to the community gallery, and remix other players' cards.",
  },
  {
    q: "Can I make a custom planeswalker card?",
    a: "Yes. PipGlyph supports planeswalker cards with loyalty counters and +/– ability lines. Select 'Planeswalker' from the card type dropdown, enter the starting loyalty value, and write each loyalty ability in the oracle text field.",
  },
  {
    q: "Can I print my custom MTG cards?",
    a: "You can export your card as a high-resolution PNG and then print it at home or at a print shop. Custom fan-made cards are intended for personal, non-commercial use — such as playtesting a new Commander deck or sharing with your playgroup. PipGlyph does not use official Wizards of the Coast card backs, fonts, or set symbols.",
  },
  {
    q: "What is the difference between PipGlyph and MTG Cardsmith or Card Conjurer?",
    a: "PipGlyph, MTG Cardsmith, and Card Conjurer are all free browser-based MTG card makers. PipGlyph differentiates itself with a modern UI, a built-in AI assistant for oracle text and flavor text, full set management (group cards into named expansions), and a structured data model that keeps every card editable as JSON — not just a flat image.",
  },
  {
    q: "Is it legal to make custom MTG cards?",
    a: "Making custom Magic cards for personal, non-commercial use — playtesting, playgroup games, Commander homebrew — is generally accepted by the Magic community and falls under fan creation norms. PipGlyph uses original card frames, fonts, and design elements and does not reproduce Wizards of the Coast's proprietary assets. Users are responsible for any artwork they upload and must not sell or commercially distribute printed proxy cards.",
  },
  {
    q: "How do I write proper MTG oracle text?",
    a: "MTG oracle text follows specific conventions: keyword abilities are capitalized (Flying, Trample, Vigilance), triggered abilities start with 'When', 'Whenever', or 'At', activated abilities use the format 'Cost: Effect', and reminder text goes in parentheses in italics. PipGlyph's AI assistant can suggest properly templated oracle text for any ability you describe in plain English.",
  },
];

// --- Mana pips & symbols (rendered on /mana-pip-editor) --------------------

export const MANA_PIP_FAQ: FaqEntry[] = [
  {
    q: "What is a mana pip editor?",
    a: "A mana pip editor is a tool for building the mana symbols (pips) on a custom trading card — the circular icons that show a card's cost. PipGlyph's pip editor is click-driven: you tap colored pip buttons to build costs like {2}{R}{R}, and the same symbols render inline in rules text for activation costs like {T}: Add one mana.",
  },
  {
    q: "Can I upload my own custom mana symbols?",
    a: "Yes. PipGlyph lets you upload a custom icon for each core mana symbol — white, blue, black, red, green, and colorless. Your icon replaces the standard symbol everywhere your cards render: the editor preview, your gallery thumbnails, public card pages, and PNG or PDF exports. Costs, color identity, and rules keep working exactly the same; only the icon changes.",
  },
  {
    q: "Which mana symbols does PipGlyph support?",
    a: "PipGlyph supports the full MTG-style mana vocabulary: generic costs {0} through {20}, variable costs {X} {Y} {Z}, the five colors plus colorless {W} {U} {B} {R} {G} {C}, all ten hybrid pairs like {W/U}, twobrids like {2/W}, phyrexian symbols like {R/P}, and the utility symbols tap {T}, untap {Q}, snow {S}, and energy {E}.",
  },
  {
    q: "Do custom pips show up on exported cards?",
    a: "Yes. PipGlyph renders exports server-side with the same layout engine as the live preview, so your custom pips appear in downloaded PNGs, print-ready PDFs, and the social-share images — pixel-aligned with standard symbols at any resolution.",
  },
  {
    q: "How do hybrid and phyrexian pips work?",
    a: "Hybrid pips show two halves — either two colors like {W/U} or a generic-color twobrid like {2/W} — and phyrexian pips carry the phi symbol, meaning the cost can be paid with mana or life. In PipGlyph you insert them from the symbol toolbar in the rules editor or build them into the mana cost, and they render as proper split discs in both the preview and the export.",
  },
  {
    q: "Is the pip editor free?",
    a: "Yes. The mana cost builder, the full symbol vocabulary, and custom pip uploads are free for every account. Custom pips are per-user: visitors always see a card with its owner's pips, so your set keeps a consistent look when you share it.",
  },
];

// --- AI card generation (rendered on /ai-mtg-card-generator) ---------------

export const AI_GENERATOR_FAQ: FaqEntry[] = [
  {
    q: "What is an AI MTG card generator?",
    a: "An AI MTG card generator uses a large language model to draft a complete Magic: The Gathering card from a brief prompt or a click. PipGlyph's generator picks a rarity, color identity, type, mana cost, and rules text — then optionally generates original art with OpenAI's image model — and drops the result into the editor where you can tweak any field before publishing.",
  },
  {
    q: "How do I generate a random MTG card with AI?",
    a: "Open the card creator at /create and click 'Generate random card'. The AI picks every field for you and renders the result in the live preview. If you want a specific direction (e.g. 'a Selesnya Saga about a city of trees'), use the AI Assistant panel and pick 'Generate from concept'.",
  },
  {
    q: "Does the AI use real MTG keyword abilities?",
    a: "Yes. The AI assistant is allowed to use the full vocabulary of published MTG keyword abilities — Flying, Trample, Deathtouch, Lifelink, Vigilance, Menace, Cascade, Convoke, Cycling, Flashback, and so on — and to template rules text the same way Wizards' R&D does ('When …', 'Whenever …', 'Pay {N}'). The generator does NOT copy published card names, planeswalker names (Jace, Liliana, etc.), or set/world names — every card you generate is original.",
  },
  {
    q: "Can the AI generate artwork for my card?",
    a: "Yes. After the AI drafts the card's text, it composes a vivid art prompt and generates a single original image via OpenAI's image model. The image is uploaded to your card's art slot and you can replace it with your own upload at any time. Generated artwork is yours under the underlying OpenAI usage policy — typically free to use for non-commercial purposes.",
  },
  {
    q: "Is the AI random card generator free?",
    a: "Yes, within a daily quota. You need a free account to use the AI generator (it's disabled for signed-out visitors), and each account can generate up to 10 random cards per day so a single user can't drain the AI budget for everyone. Heavy users will eventually have an option to bring their own OpenAI API key.",
  },
  {
    q: "Will the AI design balanced cards?",
    a: "The AI is trained to follow MTG's color pie and mana curve heuristics, but it isn't infallible — a generated mythic might still be undercosted, and a generated common might be too weak. Run the 'Balance check' tool inside the AI assistant panel to get a risk-level read and concrete tweaks before publishing to the gallery.",
  },
  {
    q: "Can I edit the AI's output after it generates a card?",
    a: "Every field is editable in the live editor. The AI seeds the form; you ship the design. Change the title, swap the art, rewrite a rules-text line, downshift the mana cost — the AI's draft is a starting point, not a fixed output.",
  },
  {
    q: "How is this different from asking ChatGPT for a custom Magic card?",
    a: "A general chat assistant returns plain text — you'd still have to copy each field into a card editor, find or generate art, format the result, and share it. PipGlyph integrates the same kind of generation directly into the card editor: every AI output is a structured patch that lands on the canvas, the art lands in the right slot, and the published card has a real public URL with social previews, comments, likes, and remix lineage.",
  },
];

// --- Sharing & visibility (new — /faq only) ---------------------------------

const SHARING_FAQ: FaqEntry[] = [
  {
    q: "What's the difference between public, unlisted, and private cards?",
    a: "Every card has one of three visibility levels. Private cards are visible only to you, in your dashboard. Unlisted cards are reachable by anyone who has the link — good for sharing with a playgroup — but they don't appear in the community gallery and aren't indexed by search engines. Public cards appear in the gallery, on your profile, in search, and can be liked, commented on, and remixed by other members.",
  },
  {
    q: "How do I share a card with my playgroup?",
    a: "Publish the card as public or unlisted, then share its page URL (pipglyph.com/card/your-username/card-name). The link unfurls with a rendered image of the card on Discord, X, and other platforms. Your playgroup can also download the PNG straight from the card page, and you can hand them a print-ready PDF.",
  },
  {
    q: "Can I unpublish a card after sharing it?",
    a: "Yes. Flip the card's visibility back to private (or unlisted) in the editor at any time. It leaves the gallery and your public profile immediately, and the cached social-share image is invalidated so new link previews stop rendering it. Anyone who already downloaded the PNG keeps their copy, as with any shared file.",
  },
];

// --- Sets & expansions (new — /faq only) ------------------------------------

const SETS_FAQ: FaqEntry[] = [
  {
    q: "Can I build a full custom MTG set or expansion?",
    a: "Yes. PipGlyph has a dedicated set builder: group any of your cards into a named set with a cover image and description, reorder them, and publish the set publicly. Set pages show a live analytics breakdown — color distribution, rarity counts, and average mana cost — so you can balance the set like a real expansion.",
  },
  {
    q: "What does 'Open booster' on a set page do?",
    a: "Every set page has a booster simulator: it deals a random booster-style hand from the cards in that set, so you and your playgroup can preview what drafting the set would feel like. It works on any public set in the community, not just your own.",
  },
];

// --- Exports & printing (new — /faq only) -----------------------------------

const EXPORTS_FAQ: FaqEntry[] = [
  {
    q: "What export formats does PipGlyph support?",
    a: "Cards export as PNG at two sizes — a share-friendly 750×1050 and a print-oriented 1500×2100 — and as a print-ready PDF sized for standard card dimensions (2.5 × 3.5 inches). Sets can be exported as a JSON bundle for backup or external tools.",
  },
  {
    q: "How do I print a custom card at real card size?",
    a: "Use the PDF export from the card page's download menu and print it at 100% scale (turn OFF 'fit to page' in your print dialog). The PDF is laid out for standard MTG card dimensions — 63 × 88 mm — so the printed card matches a sleeved real card. For best results print on heavy matte stock or insert the cut-out in a sleeve in front of a basic land.",
  },
  {
    q: "Do exported cards look exactly like the editor preview?",
    a: "Yes. Exports are rendered server-side by the same layout engine that draws the live preview — identical fonts, frames, pips, and spacing — so what you see while designing is pixel-for-pixel what you download. Custom mana pips are included in exports too.",
  },
];

// --- Scryfall import & remixing (new — /faq only) ---------------------------

const IMPORT_REMIX_FAQ: FaqEntry[] = [
  {
    q: "Can I import a real Magic card as a starting point?",
    a: "Yes. The editor's import tool searches Scryfall (the community card database) for any published card and seeds the form with its name, mana cost, type line, and oracle text — optionally pulling its art as a placeholder. From there you edit it into your own design. Imports are for personal remixing and playtesting; the card page tracks the Scryfall lineage and shows other public remixes of the same source card.",
  },
  {
    q: "What is remixing on PipGlyph?",
    a: "Remixing forks any public community card into your own editor — the design lands as your editable copy, and the new card records its lineage. Card pages show an 'Also remixed by N others' chip that links to every public take on the same source, which turns popular designs into community design conversations.",
  },
];

// --- Challenges & community (new — /faq only) -------------------------------

const CHALLENGES_FAQ: FaqEntry[] = [
  {
    q: "What are PipGlyph design challenges?",
    a: "Design challenges are community competitions with a brief and a tag — for example, 'design an artifact that cares about the graveyard'. Each challenge runs for a set window. Entries are simply public cards carrying the challenge tag, and community likes decide the spotlight. The current featured challenge appears as a banner on the gallery.",
  },
  {
    q: "How do I enter the current design challenge?",
    a: "Two ways: flip on the 'Enter the challenge' toggle in the editor's publish panel (it adds the challenge tag for you), or manually add the challenge's tag to your card and publish it as public. Your card appears on the challenge page immediately, ranked by likes.",
  },
  {
    q: "How does the trending section work?",
    a: "Trending ranks public cards by their recent momentum: likes, comments, and remixes received over the last 7 days, with a freshness boost for newly published cards. Your own engagement on your own cards doesn't count, so trending reflects genuine community interest.",
  },
];

// --- Accounts & saving (new — /faq only) ------------------------------------

const ACCOUNTS_FAQ: FaqEntry[] = [
  {
    q: "Do I need an account to use PipGlyph?",
    a: "No account is needed to design and preview a card — the full editor is open at /preview. A free account unlocks saving cards to your dashboard, publishing to the gallery, building sets, uploading custom mana pips, and entering design challenges.",
  },
  {
    q: "Does the editor autosave my work?",
    a: "While you design, the editor keeps an in-browser draft, so an accidental tab close or refresh restores your work-in-progress when you come back on the same device. Clicking Save writes the card to your account permanently and makes it available from any device.",
  },
];

// --- Choosing a card maker (rendered on /best-mtg-card-makers) --------------

export const COMPARISON_FAQ: FaqEntry[] = [
  {
    q: "What is the best MTG card maker?",
    a: "The best MTG card maker depends on what you need. PipGlyph is a strong all-rounder: a free, browser-based editor with a live preview, precise mana pips (including custom uploaded pip icons), an AI assistant for rules and flavor text, a full expansion-set builder, and PNG/PDF export for proxies. MTG Cardsmith and MTGNexus are other popular browser tools with large communities, and Magic Set Editor is a free offline desktop program favored for building whole sets.",
  },
  {
    q: "Is there a CardConjurer alternative?",
    a: "Yes. CardConjurer was a popular browser-based card renderer that was taken down in late 2023 after its creator received a cease-and-desist from Wizards of the Coast. PipGlyph is a free, browser-based alternative with a live-preview editor, the full mana-symbol vocabulary, custom pip uploads, set building, sharing, and high-resolution PNG and PDF export — built on original frames and fonts rather than Wizards' proprietary assets.",
  },
  {
    q: "Why was CardConjurer taken down?",
    a: "CardConjurer was discontinued in late 2023 after receiving a cease-and-desist from Wizards of the Coast over the use of their intellectual property. It's a reminder that custom-card tools last only if they respect WotC's IP — which is why PipGlyph uses its own original card frames, fonts, and mana symbols and follows the spirit of the Wizards Fan Content Policy.",
  },
  {
    q: "Can I rebuild my CardConjurer cards in PipGlyph?",
    a: "There's no direct file import from CardConjurer, but rebuilding a card in PipGlyph's editor takes a minute or two — you re-enter the name, mana cost, type line, rules text, and art. If the card is based on a real Magic card, PipGlyph's Scryfall import can pre-fill those fields for you to customize.",
  },
  {
    q: "Are custom MTG card makers legal to use?",
    a: "Making custom Magic cards for personal, non-commercial use — playtesting, homebrew, gifts, design challenges — is broadly accepted within the Magic community. The lines to avoid are selling cards, passing proxies off as real, and using Wizards of the Coast's copyrighted art or assets without rights. PipGlyph uses original frames and assets and is not affiliated with Wizards of the Coast.",
  },
  {
    q: "Is PipGlyph free?",
    a: "Yes. PipGlyph's card maker is free — every card type, every frame, and the live preview, with no account needed to start. A free account adds saving, publishing to the gallery, set building, and custom pip uploads; paid plans add AI generation credits, watermark-free hi-res exports, and the AI set generator.",
  },
];

// --- The hub's topic list ---------------------------------------------------

export const FAQ_TOPICS: FaqTopic[] = [
  {
    slug: "card-maker",
    title: "The card maker",
    guideHref: "/mtg-card-maker",
    entries: CARD_MAKER_FAQ,
  },
  {
    slug: "mana-pips",
    title: "Mana pips & custom symbols",
    guideHref: "/mana-pip-editor",
    entries: MANA_PIP_FAQ,
  },
  {
    slug: "ai-generation",
    title: "AI card generation",
    guideHref: "/ai-mtg-card-generator",
    entries: AI_GENERATOR_FAQ,
  },
  {
    slug: "choosing",
    title: "Choosing a card maker",
    guideHref: "/best-mtg-card-makers",
    entries: COMPARISON_FAQ,
  },
  { slug: "sharing", title: "Sharing & visibility", entries: SHARING_FAQ },
  // Sets topic rides the feature flag — /faq and its JSON-LD both read
  // FAQ_TOPICS, so filtering here keeps them in sync.
  ...(isSetsEnabled()
    ? [{ slug: "sets", title: "Sets & expansions", entries: SETS_FAQ }]
    : []),
  { slug: "exports", title: "Exports & printing", entries: EXPORTS_FAQ },
  {
    slug: "import-remix",
    title: "Scryfall import & remixing",
    entries: IMPORT_REMIX_FAQ,
  },
  {
    slug: "challenges",
    title: "Challenges & community",
    entries: CHALLENGES_FAQ,
  },
  { slug: "accounts", title: "Accounts & saving", entries: ACCOUNTS_FAQ },
];

export function allFaqEntries(): FaqEntry[] {
  return FAQ_TOPICS.flatMap((topic) => topic.entries);
}

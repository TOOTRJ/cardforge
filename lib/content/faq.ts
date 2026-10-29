// ---------------------------------------------------------------------------
// FAQ content — the single source of truth for every Q&A on the site.
//
// The four SEO landing pages render their own topic's entries (unchanged
// UX) and mark them up as FAQPage JSON-LD; the help centre (/help, TODO NV6
// — lib/content/help.ts) shows EVERY entry in exactly one of its sections
// and marks up the rest. Each answer is marked up on ONE page only: its
// landing page when its topic has one (`guideHref`), else its help section.
// /faq is a 308 to /help now. Keeping the copy here means a reworded answer
// updates the landing page, the help centre and the structured data
// together.
//
// Writing style: every answer is a direct, self-contained response to a
// real user query — that's the unit AI answer engines extract and cite.
// ---------------------------------------------------------------------------

import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";

import {
  CARD_CAPACITY,
  CARD_CAPACITY_UNLIMITED,
  privateDecksByPlanSentence,
} from "@/lib/billing/plans";

export type FaqEntry = {
  /** The answer's anchor in the help centre (/help/<section>#<id>), stable
   *  across rewordings: links point at it. Unique across every topic. */
  id: string;
  q: string;
  a: string;
};

/** A plan's saved-card cap as a word, from CARD_CAPACITY. */
const cardCap = (tier: keyof typeof CARD_CAPACITY) =>
  CARD_CAPACITY[tier] === CARD_CAPACITY_UNLIMITED ? "unlimited" : CARD_CAPACITY[tier].toLocaleString("en-US");

export type FaqTopic = {
  /** The topic's key. The nine topics /faq had keep their old anchor
   *  (/faq#card-maker…) here: /help forwards it to the help section. */
  slug: string;
  title: string;
  /** The landing page that carries this topic, when one exists. */
  guideHref?: string;
  entries: FaqEntry[];
};

// --- The card maker (rendered on /mtg-card-maker) ---------------------------

export const CARD_MAKER_FAQ: FaqEntry[] = [
  {
    id: "what-is-an-mtg-card-maker",
    q: "What is an MTG card maker?",
    a: "An MTG card maker is a web tool that lets you design custom Magic: The Gathering cards. You fill in the card's name, mana cost, type line, oracle text, power/toughness (or loyalty for planeswalkers), and upload art. The tool renders your inputs as a card that looks like a real MTG card. PipGlyph is a free, browser-based MTG card maker with a live preview editor.",
  },
  {
    id: "how-do-i-make-a-custom-card",
    q: "How do I make a custom MTG card?",
    a: "To make a custom MTG card on PipGlyph: (1) Go to the card creator at /create. (2) Choose the card type — creature, instant, sorcery, enchantment, artifact, planeswalker, land, or battle — and its frame and color. (3) Enter the card's name and upload art, or let the AI paint it. (4) Build the mana cost by clicking pips like {2}{R}{R}, then write the oracle text for the card's abilities. (5) Set power and toughness for creatures, or loyalty for planeswalkers. (6) Save it, then download it as a PNG or publish it to the gallery.",
  },
  {
    id: "is-pipglyph-free-to-use",
    q: "Is PipGlyph free to use?",
    a: "Yes. PipGlyph's card maker is free — every card type, every frame, the live preview and the AI tools. A free account (it takes seconds) is all you need: it saves your cards, lets you publish to the community gallery, build decks, and remix other players' cards.",
  },
  {
    id: "custom-planeswalker-cards",
    q: "Can I make a custom planeswalker card?",
    a: "Yes. PipGlyph supports planeswalker cards with loyalty counters and +/– ability lines. Pick 'Planeswalker' as the card type, enter the starting loyalty value, and add each loyalty ability as its own row in the Loyalty abilities editor — its cost and its text, or no cost for a static line.",
  },
  {
    id: "can-i-print-my-cards",
    q: "Can I print my custom MTG cards?",
    a: "Yes. Every account can download a card as a PNG to print at home. Plus and Pro download it without the watermark: as a PDF at true card size, or as a print PNG at 600 or 800 ppi, with an optional 1/8-inch bleed for print shops or sized for MakePlayingCards. Pro also prints sheets of any cards you pick, or one of your decks. Custom fan-made cards are intended for personal, non-commercial use — such as playtesting a new Commander deck or sharing with your playgroup. PipGlyph does not use official Wizards of the Coast card backs, fonts, or set symbols.",
  },
  {
    id: "pipglyph-vs-cardsmith-and-card-conjurer",
    q: "What is the difference between PipGlyph and MTG Cardsmith or Card Conjurer?",
    a: "PipGlyph, MTG Cardsmith, and Card Conjurer all make custom MTG cards in a web browser, although the original Card Conjurer is gone: cardconjurer.com is now a stripped-down template tool, and the full editor survives as open-source forks you host yourself. PipGlyph differentiates itself with a modern UI, a built-in AI assistant for oracle text, flavor text and art, and deck building with decklist import and proxy sheets of a deck's custom cards. Unlike a Card Conjurer fork, it keeps your cards in an account, editable from any device, rather than in one browser's storage.",
  },
  {
    id: "is-it-legal-to-make-custom-cards",
    q: "Is it legal to make custom MTG cards?",
    a: "Making custom Magic cards for personal, non-commercial use — playtesting, playgroup games, Commander homebrew — is generally accepted by the Magic community and falls under fan creation norms. PipGlyph uses original card frames, fonts, and design elements and does not reproduce Wizards of the Coast's proprietary assets. Users are responsible for any artwork they upload and must not sell or commercially distribute printed proxy cards.",
  },
  {
    id: "writing-oracle-text",
    q: "How do I write proper MTG oracle text?",
    a: "MTG oracle text follows specific conventions: keyword abilities are capitalized (Flying, Trample, Vigilance), triggered abilities start with 'When', 'Whenever', or 'At', activated abilities use the format 'Cost: Effect', and reminder text goes in parentheses in italics. PipGlyph's AI assistant can suggest properly templated oracle text for any ability you describe in plain English.",
  },
];

// --- Mana pips & symbols (rendered on /mana-pip-editor) ---------------------

export const MANA_PIP_FAQ: FaqEntry[] = [
  {
    id: "what-is-a-mana-pip-editor",
    q: "What is a mana pip editor?",
    a: "A mana pip editor is a tool for building the mana symbols (pips) on a custom trading card — the circular icons that show a card's cost. PipGlyph's pip editor is click-driven: you tap colored pip buttons to build costs like {2}{R}{R}, and the same symbols render inline in rules text for activation costs like {T}: Add one mana.",
  },
  {
    id: "custom-mana-symbols",
    q: "Can I upload my own custom mana symbols?",
    a: "Yes. PipGlyph lets you upload a custom icon for each core mana symbol — white, blue, black, red, green, and colorless. Your icon replaces the standard symbol everywhere your cards render: the editor preview, your gallery thumbnails, public card pages, and PNG or PDF exports. Costs, color identity, and rules keep working exactly the same; only the icon changes.",
  },
  {
    id: "supported-mana-symbols",
    q: "Which mana symbols does PipGlyph support?",
    a: "PipGlyph supports the full MTG-style mana vocabulary: generic costs {0} through {20}, variable costs {X} {Y} {Z}, the five colors plus colorless {W} {U} {B} {R} {G} {C}, all ten hybrid pairs like {W/U}, twobrids like {2/W}, phyrexian symbols like {R/P}, and the utility symbols tap {T}, untap {Q}, snow {S}, and energy {E}.",
  },
  {
    id: "custom-pips-on-exports",
    q: "Do custom pips show up on exported cards?",
    a: "Yes. The server renderer that draws exports reads the same pip geometry as the live preview, so your custom pips appear in downloaded PNGs, print-ready PDFs, and the social-share images — pixel-aligned with standard symbols at any resolution.",
  },
  {
    id: "hybrid-and-phyrexian-pips",
    q: "How do hybrid and phyrexian pips work?",
    a: "Hybrid pips show two halves — either two colors like {W/U} or a generic-color twobrid like {2/W} — and phyrexian pips carry the phi symbol, meaning the cost can be paid with mana or life. In PipGlyph you insert them from the symbol toolbar in the rules editor or build them into the mana cost, and they render as proper split discs in both the preview and the export.",
  },
  {
    id: "is-the-pip-editor-free",
    q: "Is the pip editor free?",
    a: "Yes. The mana cost builder, the full symbol vocabulary, and custom pip uploads are free for every account. Custom pips are per-user: visitors always see a card with its owner's pips, so your set keeps a consistent look when you share it.",
  },
];

// --- AI card generation (rendered on /ai-mtg-card-generator) ----------------

export const AI_GENERATOR_FAQ: FaqEntry[] = [
  {
    id: "what-is-an-ai-card-generator",
    q: "What is an AI MTG card generator?",
    a: "An AI MTG card generator uses a large language model to draft a complete Magic: The Gathering card from a brief prompt or a click. PipGlyph's generator picks a rarity, color identity, type, mana cost, and rules text — then optionally paints original art with the FLUX image model (through the Vercel AI Gateway) — and drops the result into the editor where you can tweak any field before publishing.",
  },
  {
    id: "generate-a-card-with-ai",
    q: "How do I generate a random MTG card with AI?",
    a: "Open the card creator at /create and choose 'Generate with AI'. Pick a theme and art style — or hit 'Surprise me' — and the AI fills every field and paints the art, then drops the card into the editor. Each generation costs one AI credit (a free account starts with 5). Want just ideas first? 'Get ideas' gives you three concepts to pick from for a single credit.",
  },
  {
    id: "ai-keyword-abilities",
    q: "Does the AI use real MTG keyword abilities?",
    a: "Yes. The AI assistant is allowed to use the full vocabulary of published MTG keyword abilities — Flying, Trample, Deathtouch, Lifelink, Vigilance, Menace, Cascade, Convoke, Cycling, Flashback, and so on — and to template rules text the same way Wizards' R&D does ('When …', 'Whenever …', 'Pay {N}'). The generator does NOT copy published card names, planeswalker names (Jace, Liliana, etc.), or set/world names — every card you generate is original.",
  },
  {
    id: "ai-artwork",
    q: "Can the AI generate artwork for my card?",
    a: "Yes. After the AI drafts the card's text, it composes a vivid art prompt and generates a single original image with an AI image model. The image lands in your card's art slot and you can replace it with your own upload at any time. Generated artwork is yours to use for your custom cards.",
  },
  {
    id: "is-the-ai-generator-free",
    q: "Is the AI random card generator free?",
    a: "Yes. Every AI tool is available on the free plan — AI generation runs on credits, and a free account starts with 5 credits (one credit designs and illustrates one card, or buys a batch of three text-only ideas) and doesn't refill. Plus and Pro refill with 30 and 100 credits a month, and anyone can buy a top-up pack that never expires — Plus and Pro members pay 20% less for packs. The only Pro-exclusive AI features are the deck-aware ones: designing a card for a specific deck and theming ideas to a deck.",
  },
  {
    id: "ai-card-balance",
    q: "Will the AI design balanced cards?",
    a: "The AI is trained to follow MTG's color pie and mana curve heuristics, but it isn't infallible — a generated mythic might still be undercosted, and a generated common might be too weak. Use the per-field Generate with AI buttons to draft an alternative cost or rules text and compare, then playtest before publishing to the gallery.",
  },
  {
    id: "edit-ai-output",
    q: "Can I edit the AI's output after it generates a card?",
    a: "Every field is editable in the live editor. The AI seeds the form; you ship the design. Change the title, swap the art, rewrite a rules-text line, downshift the mana cost — the AI's draft is a starting point, not a fixed output.",
  },
  {
    id: "ai-vs-chatgpt",
    q: "How is this different from asking ChatGPT for a custom Magic card?",
    a: "A general chat assistant returns plain text — you'd still have to copy each field into a card editor, find or generate art, format the result, and share it. PipGlyph integrates the same kind of generation directly into the card editor: every AI output is a structured patch that lands on the canvas, the art lands in the right slot, and the published card has a real public URL with social previews, comments, likes, and remix lineage.",
  },
];

// --- Sharing & visibility (help centre only) --------------------------------

const SHARING_FAQ: FaqEntry[] = [
  {
    id: "public-unlisted-private",
    q: "What's the difference between public, unlisted, and private cards?",
    a: "Every card has one of three visibility levels. Private cards are visible only to you, in your dashboard. Unlisted cards are reachable by anyone who has the link — good for sharing with a playgroup — but they don't appear in the community gallery and aren't indexed by search engines. Public cards appear in the gallery, on your profile, in search, and can be liked, commented on, and remixed by other members.",
  },
  {
    id: "share-with-your-playgroup",
    q: "How do I share a card with my playgroup?",
    a: "Publish the card as public or unlisted, then share its page URL (pipglyph.com/card/your-username/card-name). The link unfurls with a rendered image of the card on Discord, X, and other platforms. Your playgroup can also download the PNG straight from the card page, and you can hand them a print-ready PDF.",
  },
  {
    id: "unpublish-a-card",
    q: "Can I unpublish a card after sharing it?",
    a: "Yes. Flip the card's visibility back to private (or unlisted) in the editor at any time. It leaves the gallery and your public profile immediately, and the cached social-share image is invalidated so new link previews stop rendering it. Anyone who already downloaded the PNG keeps their copy, as with any shared file.",
  },
];

// --- Exports & printing (help centre only) ----------------------------------

const EXPORTS_FAQ: FaqEntry[] = [
  {
    id: "export-formats",
    q: "What export formats does PipGlyph support?",
    a: "Every account can download a card as a 750 × 1050 PNG or JPEG that carries the PipGlyph mark, with rounded or square corners. Plus and Pro download without the mark: a 1500 × 2100 PNG or JPEG; print PNGs at 600 or 800 ppi, with an optional 1/8-inch bleed or sized for MakePlayingCards; and a PDF of one card at true size, with or without the bleed. Pro adds print sheets (copies of one card, any cards you select in My Cards, or one of your decks) and ZIPs of card images. Your account data (profile, cards, decks, comments) downloads as JSON from Settings.",
  },
  {
    id: "print-at-real-card-size",
    q: "How do I print a custom card at real card size?",
    a: "On Plus or Pro, open the card's Download menu, choose PDF, then One card. Print it at 100% scale, with 'fit to page' turned OFF in your print dialog. The page is exactly 2.5 × 3.5 inches, so the printed card matches a sleeved real card. On Pro, 'Sheet of copies' puts 9 copies on a US Letter or A4 page instead (6 or 8 with the bleed). Measure the first print with a ruler before printing the rest. For best results, print on heavy matte stock, or sleeve the cut-out in front of a basic land.",
  },
  {
    id: "print-resolution",
    q: "Should I print at 600 or 800 ppi?",
    a: "600 ppi (1500 × 2100 pixels) is plenty for home printers and most print shops, and every PDF is printed from it. Choose 800 ppi (2000 × 2800) when a shop asks for it. At 800 ppi the text, mana symbols and your art are drawn at 800 ppi, but the frame artwork is enlarged from its 600 ppi master, and the download says so. The 800 ppi file is a PNG with square corners, on Plus and Pro.",
  },
  {
    id: "what-is-a-bleed",
    q: "What is a bleed, and do I need one?",
    a: "A bleed is extra card printed past the cut line. If the cut drifts, you see a little more card instead of a white sliver. Print shops usually ask for 1/8 inch, and that is what PipGlyph adds on every side: the file becomes 2.75 × 3.75 inches (1650 × 2250 pixels at 600 ppi). The bleed continues the card's own edge outward: the border where the card has one, the art where the art runs to the edge. Nothing is scaled, so the card inside the cut line is unchanged. It comes as a PNG, or as a PDF with crop marks on the cut lines, on Plus and Pro; Pro's print sheets take it too. At home it is optional, and fewer cards fit on a sheet with it.",
  },
  {
    id: "mixed-print-sheets",
    q: "Can I print different cards on one sheet?",
    a: "Yes, on Pro. In My Cards, select the cards (your own, or ones on the Liked tab) and choose Print / download. Print PDF lays them out on US Letter or A4 sheets, or one card per page. On sheets you choose copies per card, no gap or a 1/16-inch gap, corner marks or full-length cut lines, and a card size of 2.5 × 3.5 inches or 63 × 88 mm. A sheet holds 9 cards. With the 1/8-inch bleed it holds 6 on Letter or 8 on A4, printed landscape. Cut guides print only in the margins and gaps, never on a card, and one export takes up to 150 cards. The same options are in a deck's export and in a single card's 'Sheet of copies'.",
  },
  {
    id: "makeplayingcards",
    q: "Can I order my cards from MakePlayingCards?",
    a: "Yes. PipGlyph exports the image MakePlayingCards asks for on its poker-size cards: 822 × 1122 at 300 dpi, delivered at 600 ppi as 1644 × 2244 pixels (2192 × 2992 at 800 ppi). The file includes MPC's own bleed and has square corners. It is always portrait: a Battle or Split is turned sideways onto the card, the way it is printed. On Plus and Pro, choose MakePlayingCards as the Bleed on the download's Image tab. On Pro, a ZIP of MPC files comes from a selection in My Cards or from a deck's export. PipGlyph exports card fronts only, so set the back in MPC's builder. Proxies are for your own table, never for sale.",
  },
  {
    id: "full-resolution-art",
    q: "Do print downloads use my full-resolution art?",
    a: "Yes. Every PDF (one card, a sheet or a deck), the 800 ppi, bleed and MakePlayingCards images, and the HD and MakePlayingCards images in a Pro ZIP place your original uploaded art at full resolution. This matters most on full-art and borderless frames, where the art fills the card. The whole card is 1500 × 2100 pixels at 600 ppi and 2000 × 2800 at 800 ppi, so art that large prints without being enlarged.",
  },
  {
    id: "exports-match-the-preview",
    q: "Do exported cards look exactly like the editor preview?",
    a: "They're built to. The live preview is drawn in your browser and the export by a separate server renderer that reads the same frames, fonts, pips and text geometry, and parity tests check the two agree. If a character can't be drawn on the card image (an emoji, for example), the creator says so before you save. Custom mana pips are included in exports too.",
  },
  {
    id: "why-a-card-looks-different",
    q: "Why does my card look slightly different than before?",
    a: "PipGlyph keeps matching its frames to real printed Magic cards. When an update corrects something that was drawn wrong — a text size, a misplaced symbol, the edge of a frame — every published card it affects is re-rendered with the fix automatically, usually within a few hours of the update, and private cards show it the next time you open them. A correction changes how the card is drawn, not what you made: its name, rules text, art and stats stay as you left them. A new style that is a matter of taste is never forced on an existing card — you choose whether to switch it on. Images you downloaded earlier don't change; download the card again for the updated image. Bigger updates are announced on the What's new page.",
  },
];

// --- Scryfall import & remixing (help centre only) --------------------------

const IMPORT_REMIX_FAQ: FaqEntry[] = [
  {
    id: "import-a-real-card",
    q: "Can I import a real Magic card as a starting point?",
    a: "Yes. The editor's import tool searches Scryfall (the community card database) for any published card and seeds the form with its name, mana cost, type line, and oracle text — optionally pulling its art as a placeholder. From there you edit it into your own design. Imports are for personal remixing and playtesting; the card page tracks the Scryfall lineage and shows other public remixes of the same source card.",
  },
  {
    id: "what-is-remixing",
    q: "What is remixing on PipGlyph?",
    a: "Remixing forks any public community card into your own editor — the design lands as your editable copy, and the new card records its lineage. Card pages show an 'Also remixed by N others' chip that links to every public take on the same source, which turns popular designs into community design conversations.",
  },
];

// --- Challenges & community (help centre only) ------------------------------

const CHALLENGES_FAQ: FaqEntry[] = [
  {
    id: "design-challenges",
    q: "What are PipGlyph design challenges?",
    a: "Design challenges are community competitions with a brief and a tag — for example, 'design an artifact that cares about the graveyard'. Each challenge runs for a set window. Entries are simply public cards carrying the challenge tag, and community likes decide the spotlight. The current featured challenge appears as a banner on the gallery.",
  },
  {
    id: "enter-a-challenge",
    q: "How do I enter the current design challenge?",
    a: "Two ways: flip on the 'Enter the challenge' toggle in the editor's publish panel (it adds the challenge tag for you), or manually add the challenge's tag to your card and publish it as public. Your card appears on the challenge page immediately, ranked by likes.",
  },
  {
    id: "how-trending-works",
    q: "How does the trending section work?",
    a: "Trending ranks public cards by their recent momentum: likes, comments, and remixes received over the last 7 days, with a freshness boost for newly published cards. Your own engagement on your own cards doesn't count, so trending reflects genuine community interest — and it shows at most one card per creator, so the row is a showcase of the community rather than one account's week.",
  },
];

// --- Accounts & saving (help centre only) -----------------------------------

const ACCOUNTS_FAQ: FaqEntry[] = [
  {
    id: "do-i-need-an-account",
    q: "Do I need an account to use PipGlyph?",
    a: "Yes — a free one, which takes seconds. Signed out, /create shows the whole creator — every step and the live preview — read-only; designing, saving and publishing a card need an account, so your cards are always yours, on any device. The same free account unlocks the gallery, decks, custom mana pips, design challenges and 5 AI credits to get started.",
  },
  {
    id: "does-the-editor-autosave",
    q: "Does the editor autosave my work?",
    a: "No — a card is only saved when you click Save, so nothing half-finished ever lands in your library by accident. Tick “Save as a draft” on the Publish step to keep a work-in-progress private (a draft only needs a title). If you try to leave the editor with unsaved changes, PipGlyph asks whether to save it as a draft first.",
  },
  {
    id: "download-your-data",
    q: "How do I download a copy of my data?",
    a: "In Settings, under “Your data & account”, choose Download beside “Export your data”. You get one JSON file with your profile, your cards, your decks and your comments.",
  },
  {
    id: "delete-your-account",
    q: "How do I delete my account?",
    a: "In Settings, under “Your data & account”, choose “Delete account” and type DELETE to confirm. It permanently deletes your account, your profile and every card, deck and comment you've made, and it can't be undone — export your data first if you want a copy. A paid plan on the account is cancelled straight away.",
  },
  {
    id: "email-preferences",
    q: "Can I choose which emails PipGlyph sends me?",
    a: "Yes. The Email section of Settings has a switch for each kind: account and team messages (replies from the team, credit grants, plan changes), a weekly activity digest (sent only when there's unread activity), and the newsletter, which stays off unless you turn it on. Every email carries a one-click unsubscribe link. Security emails, such as password resets and email changes, are always sent.",
  },
];

// --- Decks (help centre only) -----------------------------------------------
//
// What decks do TODAY, in the deck vocabulary (TODO DK2.2,
// components/creator/card-glossary.tsx: a real card is "Imported", your
// version of it "Edited", made with "Customize"). The rest of the rebuild
// changes them again — a create dialog instead of the stepper (DK4), other
// creators' public cards in your decks (DK2.9, owner D3): rewrite with it.
// The private-deck limits (owner D1, migration 0145) and the import's slot
// rule (D2) are said from lib/billing/plans.ts — tests/unit/content/
// help.test.ts and tests/unit/billing/plan-limits-copy.test.tsx hold the
// numbers to DECK_CAPACITY and CARD_CAPACITY.

const DECKS_FAQ: FaqEntry[] = [
  {
    id: "what-goes-in-a-deck",
    q: "What can I put in a PipGlyph deck?",
    a: "Real Magic cards and cards you design yourself. Paste a decklist and each line is matched to its card on Scryfall, marked Imported; choose Customize on one and the version you save takes its place in the deck, marked Edited. A new card can join one of your decks from the creator's Publish step, and a deck entry can be linked to a card you've already saved. Every deck has a format, which sets its size and copy limits, and boards for the commander, companion, main deck, sideboard and maybeboard.",
  },
  {
    id: "decklist-formats",
    q: "Which decklist formats can I import?",
    a: "Paste a list exported from MTG Arena, Moxfield, Archidekt, ManaBox or MTGO, or plain lines like “4 Lightning Bolt”. Commander, sideboard and maybeboard sections are detected automatically. You review every line before anything is added: change a quantity or a board, check the cards marked as a best guess, and expect a name Scryfall can't find to come in as a name-only placeholder.",
  },
  {
    // Owner decision D2 (2026-10-28): an import takes no slot; customizing
    // a card does.
    id: "import-uses-slots",
    q: "Does importing a decklist use my saved-card slots?",
    a: `No. A pasted decklist is a list of real cards, and it uses none of your saved-card slots however long it is. A card takes a slot when you customize it — turn the imported card into your own design — like any card you save (Free holds ${cardCap("free")}, Plus ${cardCap("plus")}, Pro ${cardCap("pro")}). The import's review says how many slots you have left.`,
  },
  {
    // The private-deck cap (owner decision D1, migration 0145).
    id: "how-many-decks",
    q: "How many decks can I make?",
    a: `As many public decks as you like, on every plan. The limit is on private and unlisted decks: ${privateDecksByPlanSentence()} A downgrade or a lapsed plan never locks a deck: every deck you have stays editable, and only a NEW private or unlisted deck needs a free slot — make another deck public, delete one, or upgrade.`,
  },
  {
    id: "copy-export-or-print-a-deck",
    q: "Can I copy, export or print a deck?",
    a: "Copying the list is free: the deck's owner, and every visitor to a public or unlisted deck, can copy it as plain text or in Arena format, ready to paste into another deck site or an import. Exporting files is a Pro feature for the deck's owner: a ZIP with clean images of the deck's custom cards, its decklist and a PDF of its stats, or a print-ready PDF of those cards at true size, one per page or on US Letter or A4 sheets. Real cards not customized yet go on a checklist page instead of being printed.",
  },
  {
    id: "ai-deck-building",
    q: "Can the AI build a deck for me?",
    // The pause's own sentence (lib/ai/deck-ai-pause.ts). Lifting the pause
    // fails tests/unit/content/help.test.ts until this answer changes.
    a: `Not right now. ${DECK_AI_PAUSED_MESSAGE} Deck guides written before the pause stay on their decks. The creator's AI still designs single cards on every plan, and on Pro it can design a card for one of your decks.`,
  },
];

// --- AI credits (help centre only) ------------------------------------------

const CREDITS_FAQ: FaqEntry[] = [
  {
    id: "failed-generation-credits",
    q: "What happens to my credits if an AI generation fails?",
    a: "You get them back automatically. PipGlyph tells you how many credits a run uses before it starts — one for a card with its art or for a batch of three ideas, two for a double-faced card with art for both faces — and a run that fails to generate refunds what it took.",
  },
  {
    id: "credit-balance",
    q: "Where do I see my credits, and do they expire?",
    a: "When you're signed in, your balance shows in the site header (in the menu on a phone) and under Billing in Settings. Credits from a pack never expire and stack with any plan's credits. A free account's 5 starting credits don't refill; Plus adds 30 credits a month and Pro 100.",
  },
];

// --- Choosing a card maker (rendered on /best-mtg-card-makers) --------------

export const COMPARISON_FAQ: FaqEntry[] = [
  {
    id: "best-mtg-card-maker",
    q: "What is the best MTG card maker?",
    a: "The best MTG card maker depends on what you need. PipGlyph is a strong all-rounder: a free, browser-based editor with a live preview, precise mana pips (including custom uploaded pip icons), an AI assistant for rules and flavor text, deck building with proxy printing, and PNG/PDF export for proxies. MTG Cardsmith and MTGNexus are other popular browser tools with large communities, and Magic Set Editor is a free offline desktop program favored for building whole sets.",
  },
  {
    id: "card-conjurer-alternative",
    q: "Is there a CardConjurer alternative?",
    a: "Yes. CardConjurer was a popular browser-based card renderer that was taken down in November 2022 after its creator received a cease-and-desist from Wizards of the Coast. PipGlyph is a free, browser-based alternative with a live-preview editor, the full mana-symbol vocabulary, custom pip uploads, deck building, sharing, and high-resolution PNG and PDF export — built on original frames and fonts rather than Wizards' proprietary assets.",
  },
  {
    id: "why-card-conjurer-was-taken-down",
    q: "Why was CardConjurer taken down?",
    a: "CardConjurer was discontinued in November 2022 after receiving a cease-and-desist from Wizards of the Coast over the use of their intellectual property. It's a reminder that custom-card tools last only if they respect WotC's IP — which is why PipGlyph uses its own original card frames, fonts, and mana symbols and follows the spirit of the Wizards Fan Content Policy.",
  },
  {
    id: "rebuild-card-conjurer-cards",
    q: "Can I rebuild my CardConjurer cards in PipGlyph?",
    a: "There's no direct file import from CardConjurer, but rebuilding a card in PipGlyph's editor takes a minute or two — you re-enter the name, mana cost, type line, rules text, and art. If the card is based on a real Magic card, PipGlyph's Scryfall import can pre-fill those fields for you to customize.",
  },
  {
    id: "are-card-makers-legal",
    q: "Are custom MTG card makers legal to use?",
    a: "Making custom Magic cards for personal, non-commercial use — playtesting, homebrew, gifts, design challenges — is broadly accepted within the Magic community. The lines to avoid are selling cards, passing proxies off as real, and using Wizards of the Coast's copyrighted art or assets without rights. PipGlyph uses original frames and assets and is not affiliated with Wizards of the Coast.",
  },
  {
    id: "is-pipglyph-free",
    q: "Is PipGlyph free?",
    a: "Yes. PipGlyph's card maker is free with a free account — every card type, every frame, the live preview, saving, publishing to the gallery, deck building and custom pip uploads, plus 5 AI credits to get started (Free doesn't refill). Plus and Pro add monthly credits, watermark-free hi-res downloads, print files (800 ppi, bleed, MakePlayingCards) and print-ready PDFs, and Pro adds deck-aware AI design, print sheets and whole-deck export.",
  },
];

// --- Every topic, in the old /faq order -------------------------------------

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
  // Topics the help centre added (no /faq anchor ever pointed at them).
  { slug: "decks", title: "Decks", entries: DECKS_FAQ },
  { slug: "credits", title: "AI credits", entries: CREDITS_FAQ },
];

export function allFaqEntries(): FaqEntry[] {
  return FAQ_TOPICS.flatMap((topic) => topic.entries);
}

/** The topic an entry belongs to — its landing page, when the topic has one. */
export function faqTopicOf(entryId: string): FaqTopic | undefined {
  return FAQ_TOPICS.find((topic) => topic.entries.some((entry) => entry.id === entryId));
}

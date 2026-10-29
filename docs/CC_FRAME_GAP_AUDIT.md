# Card Conjurer frame gap audit (2026-10-28)

Which frames Card Conjurer offers that PipGlyph has not built yet, pack by
pack. This is PipGlyph's own analysis: it reads the names in Card
Conjurer's frame configuration and compares them with our templates. No
Card Conjurer code or image is copied into this repository, and none may be
(`docs/FRAMES.md`, "Card Conjurer frames": the fork carries no licence).

It refreshes the inventory of the frame roadmap of 2026-10-13 (TODO.md,
Phase 4, "Frame roadmap"). That roadmap's 260-row table lives in the
owner's backup folder, not in the repo; this file is the repo copy, with
fifteen days of building since.

## Sources and method

- **Card Conjurer.** The fork the importer pins: `Investigamer/cardconjurer`
  at `2fcddba8966156d484cedf54d8214996748dd5e1` (`CC_REPO` / `CC_COMMIT` in
  `scripts/lib/cc-frames.mjs`; June 2024). The tree was listed through the
  GitHub API, and only the text configuration was read: the 15
  `js/frames/group*.js` files (the creator's frame groups, with Card
  Conjurer's own names) and the 260 `js/frames/pack*.js` files (each pack's
  frames and image paths). No frame image was downloaded. 259 packs are
  named by a group; one, `packM15LandsNew.js`, by none (the accurate pack's
  land tints, which `m15land` uses).
- **PipGlyph.** The 97 templates of `FRAME_TEMPLATE_VALUES`
  (`types/card.ts`), their `PROFILES` entries
  (`lib/cards/template-layout.ts`), and `lib/cards/frame-sources.json` —
  which Card Conjurer files made each master in the frames bucket
  (`lib/frames/frame-manifest.json`). A pack counts as **built** when a
  template on `main` draws its masters (or, for "twin pack", when the same
  look is built from Card Conjurer's other drawing of it, or for "other
  source", from MSE or our own drawing). It is not a pixel comparison, and
  "built" says nothing about verification: several built frames still wait
  for the owner's promote and ticks (TODO 4.11, 4.25).
- **Printed cards.** Scryfall's public search API on 2026-10-28,
  `unique=prints`, extras and variations included: the query is given
  beside each count, so it can be run again. "About" marks a count read
  from collector-number ranges rather than a single query. Counts quoted
  from TODO.md (the 2026-10-13 roadmap, an item's own census) say so.
- **TODO.** Every pack is matched to the open TODO item that already covers
  it. Where none did, a new P3 item was added (4.57–4.74, in bold in the
  tables below).

## Summary

| Group | Packs | Built | Built-partially | Not built | Out of scope |
| --- | --- | --- | --- | --- | --- |
| M15 core frames and add-ons | 23 | 14 | 5 | 4 | 0 |
| Layout, two-part and double-faced bodies | 41 | 14 | 3 | 24 | 0 |
| Set showcases | 49 | 15 | 0 | 34 | 0 |
| Borderless, extended-art and full-art variants | 16 | 2 | 2 | 7 | 5 |
| Promos and textless | 7 | 1 | 0 | 6 | 0 |
| Full-art basic lands | 9 | 4 | 0 | 5 | 0 |
| Token variants | 15 | 6 | 0 | 8 | 1 |
| Planeswalkers (ask the owner first: listed only) | 19 | 5 | 1 | 13 | 0 |
| Old frames and other card types | 13 | 4 | 0 | 8 | 1 |
| Universes Beyond | 9 | 4 | 0 | 5 | 0 |
| Out of scope: community designs, print margins, other games | 59 | 0 | 0 | 0 | 59 |
| **All** | **260** | **69** | **11** | **114** | **66** |

"Out of scope" is: declined by the owner (foil-etched, 4.28; Card
Conjurer's 'Regular' token, which matches no print), Card Conjurer's
community designs (not printings: the roadmap's question 7, "leave out"),
print margins and the card back (PipGlyph makes its own bleed), and other
games (Flesh and Blood, Pokémon).

Against the 2026-10-13 roadmap (built 34 + covered 14, partly 4, not built
140): **69 built** (59 from the pack itself, 7 from a twin pack, 3 from
another source), **11 built-partially, 114 not built**. Built since
2026-10-13: Universes Beyond (`m15ub` ×3 and its crown), the Nyx dress and
its crown, the extended art and the textless promos re-sourced from Card
Conjurer, the three older full-art basics, the double-faced saga, and the
showcase rebuild — ZNR hedron, both Expeditions, THB constellation, LTR
ring and scroll, Tarkir sketch, Mystical Archive, D&D Sourcebook, MKM
dossier, Enchanting Tales, DMU stained glass, SNC art deco, TARDIS and
Breaking News (merged 2026-10-22 → 10-28). The MDFC helper cards moved from "not
needed" to "not built": TODO 5.3b asks for them.

Of the 114 not built, 13 are planeswalker packs (ask the owner first:
listed, not scheduled) and 8 are packs this audit could not tie to a
printing (4.70). The rest are spread over 18 new P3 items (4.57–4.74) and
the items that already held them (4.5d, 4.5e, 4.7, 4.11, 4.15, 4.25,
4.37, 4.43, 4.44, 5.3b, 5.7a–c, 5.9, 6.3a, 6.4).

## Top 10 not-built families by printed cards

In scope and not declined; a family is one look, however many Card
Conjurer packs draw it.

| # | Family | Card Conjurer pack(s) | Printings | Item |
| --- | --- | --- | --- | --- |
| 1 | "The List" stamp | `TheList` | 5,741 (`set:plst`) | 4.15 |
| 2 | Gold border (World Championship decks, CE / IE) | `M15Borders` (gold) | 1,373 (`border:gold`) | **4.69** |
| 3 | Universes Beyond extended art | `UBExtendedArt` | 1,124 (TODO 4.25's count, before 2025-09) | 4.25 |
| 4 | Playtest cards | `Playtest` | 952 (`is:playtest`) | 4.15 |
| 5 | Borderless flavour-name ("Godzilla") | `M15Nickname`, `PromoNickname` | about 550 (TODO 6.3a) | 6.3a |
| 6 | Double Feature (DBL) | `DoubleFeature`, `DoubleFeatureTransform` | 535 (`set:dbl`) | 5.9 |
| 7 | Borderless light box | `GenericShowcase` | 519 (TODO 4.37) | 4.37 |
| 8 | Old-frame tokens | `TokenOld` | 405 (`is:token (frame:1993 or frame:1997 or frame:2003)`) | 4.43 |
| 9 | Fourth Edition | `Fourth` | 380 (`set:4ed`) | 4.30b, 4.10h (ask first) |
| 10 | Planechase planes and phenomena | `Planechase` | 329 (`t:plane or t:phenomenon`) | 4.15 |

Next: Universes Beyond sagas 263 (`is:universesbeyond t:saga`), Future
Sight 252, the textured saga 221 (TODO 4.5d), mutate 146, attractions 135,
the colour indicator 130, extended-art Nyx 127, Vanguard 119, the NEO
showcases about 98, the Vault 95, Oil Slick 85.

Counted by printings, the list leans on products that print many copies of
few looks (The List, gold-bordered decks, playtest cards). Ranked by
distinct cards, or by what people ask for (the request log, 1.6 — readable
by admins only), the showcase families would rank higher.

## New TODO items (P3 unless the owner says otherwise)

| Item | Family | Printings | Size |
| --- | --- | --- | --- |
| 4.57 | The Vault (BIG) showcase | 95 | M |
| 4.58 | OTJ Wanted Poster showcase | 13 | S |
| 4.59 | Fallout Pip-Boy showcase | 52 | M |
| 4.60 | MUL Ikoria Crystal | about 15 | S |
| 4.61 | Ravnica City (MUL + MKM) | 15 + 14 | S |
| 4.62 | SNC Golden Age (CC 'Art Deco (SNC)') | 20 | S |
| 4.63 | NEO showcases: Ninja, Samurai, Neon | about 98 + 4 | M |
| 4.64 | VOW Fang | about 31 | M |
| 4.65 | MID Equinox (one-faced and transform) | 26 | M |
| 4.66 | Eternal Night (MID / VOW black-and-white) | 26 + 20 basics | S |
| 4.67 | MH2 sketch showcase | 54 | M |
| 4.68 | Kaldheim showcase | 35 | M |
| 4.69 | Gold border on the old frames | 1,373 | S–M |
| 4.70 | Map the eight Card Conjurer packs this audit could not tie to a print | — | S (research) |
| 4.71 | M21 showcase | 29 | S |
| 4.72 | Extended-art Nyx and snow | 127 + 10 | S |
| 4.73 | The FNM promos' dress | 64 | S |
| 4.74 | Legends' gold (the 1993 frame's multicolour) | 55 | S |

Families already in TODO 4.11's backlog line (Oil Slick, the three
Storybooks, Ixalan coin, D&D Module, Mystical Archive JP, Inventions,
Invocations, the Phyrexian praetors, Signature Spellbook) were not given
items of their own.

## The owner's three medium-priority (P2) frame items of 2026-10-28

None is a Card Conjurer pack (its fork ends June 2024 and has no
colourless modal frame); they are recorded in TODO.md with this audit:

- **4.5d — the saga-creature body** (expanded in place, already P2): 85
  printings of 30 cards (FIN, FIC, PFIN): 51 one-faced "Summon:" sagas and
  34 transform backs. Needs the textured saga, a raised type bar with a
  second box and a P/T, and a ▼-back variant.
- **4.27b — Prepared creatures, what `prepare` does not draw yet**: the
  plain card is covered by 4.27; missing are the holofoil stamp notch (79
  stamped printings), the collector line and the extended-art dress (29),
  plus two serialized headliners. No borderless or showcase Prepare is
  printed.
- **5.11a — Wandering Archaic (STX #6)**: the only colourless, non-artifact
  modal nonland card (3 paper printings). Needs a see-through `c` master on
  both modal bodies, the gate opened for a colourless face on the modal
  bodies, and the import's `dfc/colourless-face` gap lifted for it. The
  other colourless non-artifact faces are transform backs (13 EMN Eldrazi,
  7 TLA), left with 5.11.

## Packs this audit could not tie to a print (4.70)

Card Conjurer's names do not say which printing these draw, and reading
the images was out of bounds for this audit (no frame image is
downloaded). Each needs one look at the pack's frames beside Scryfall
before it is sized:

- `CommanderLegends` 'Commander Legends (CMR)' — Scryfall flags no CMR
  showcase (`set:cmr frame:showcase`: 0); CMR prints borderless (2) and
  extended art (102).
- `Ixalan` 'Ixalan Maps' — a map frame with card-type icons in the title
  bar; LCI's showcase (`set:lci frame:showcase`: 27, #292–319) is the
  first candidate.
- `SNCSkyscraper` 'Skyscraper (SNC)' — SNC's borderless inverted
  printings (#285–295 and the box toppers #450–460) are the candidates.
- `ModalShort`, `ModalShortNickname` — a shorter text box on the modal
  bodies.
- `M15ExtendedArtShort` 'Extended Art (Shorter Textbox)'.
- `PromoOpenHouse` 'Regular Frames', `PromoExtended` 'Extended Art Frames',
  `PromoGenericShowcase` 'Generic Showcase' (the Promo group).

## Notes

- Card Conjurer has no pack for anything printed after June 2024, so the
  station frame, Room, Omen, Prepare and the saga creature are not in
  this table (4.27a, 4.27, 4.27b, 4.5d). Four files its packs name are
  missing from its own tree (the roadmap of 2026-10-13 lists them).
- "Built" counts the `m15borderless` family and the double-faced bodies
  whole; their open looks (the light borderless double-faced faces, the
  extended-art faces) are the built-partially and not-built rows of their
  own packs.
- Planeswalker packs are listed only (owner 2026-09-29: ask first before
  any walker work).

## The inventory

Every one of the 260 packs, by group. "Card Conjurer pack" is the name its
creator shows (a pack listed in two groups shows both). Size: S = a recipe
and a profile on a body that exists; M = new anatomy in both renderers; L =
a new layout end to end; ? = not sized until 4.70 maps it.

### M15 core frames and add-ons

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Regular Frames | `packM15RegularNew.js` | `m15`, `m15artifact`, `m15land`, `m15devoid`, `m15vehicle` | built | the 2015 frame (M15 → today) |  | 4.4 |
| Regular Frames | `packM15Regular-1.js` | as above | built (twin pack) | the same frame, Card Conjurer's older drawing |  |  |
| (listed in no group) | `packM15LandsNew.js` | `m15land` (its land tints) | built | nonbasic lands, 2015 frame |  |  |
| Lands | `packM15Lands.js` | as above | built (twin pack) | the older drawing |  |  |
| Snow (Kaldheim) | `packSnowNew.js` | `m15snow`, `m15snowland` | built | KHM snow (2021) and later snow |  |  |
| Snow (Kaldheim) | `packM15Snow.js` | as above | built (twin pack) | the older drawing |  |  |
| Nyx (Theros) | `packM15NyxNew.js` | `m15nyx` | built | enchantment creatures / artifacts (THB on), every enchantment (FDN on) |  | 4.7 |
| Nyx (Theros) | `packM15Nyx.js` | as above | built (twin pack) | the older drawing |  |  |
| Devoid (Zendikar) | `packM15Devoid.js` | `m15devoid` | built | BFZ / OGW / MH3 devoid |  |  |
| Legend Crowns | `packM15LegendCrownsNew.js` | `m15crown` overlay | built | every legendary since DOM 2018 |  | 4.6 |
| Legend Crowns | `packM15LegendCrowns.js` | as above | built (twin pack) | the older drawing |  |  |
| Floating Legend Crowns | `packM15LegendCrownsFloating.js` | `extendedcrown`, `m20tokencrown` | built | extended-art legends, legendary tokens |  | 4.6 |
| Inner Crowns | `packM15InnerCrownsNew.js` | the Nyx strip inside `m15nyxcrown` / `nyxcrown` | built-partially | Nyx legends (built); the COMPANION inner crowns of IKO (65, `frame:companion`) are not | S | 4.7 (marks) |
| Inner Crowns | `packM15InnerCrowns.js` | as above | built-partially | the older drawing |  | 4.7 |
| Nicknames | `packM15Nickname-2.js` | the 6.3 nickname plate (our own SVG) | built (other source) | black-bordered flavour-name printings |  | 6.3 |
| Holo Stamps | `packM15HoloStamps.js` | `m15holostamp` | built | the oval stamp on rares / mythics |  | 4.9 |
| Dark Power/Toughness | `packM15DarkPT.js` | the ZNR showcase plate only | built-partially | the dark P/T of nickname and showcase printings | S | 6.3a |
| Colored Borders | `packM15Borders.js` | `frame_style.border: "white"` on the four old frames | built-partially | white (built, 4.30); silver: 666 (`border:silver`, Un-sets); gold: 1,373 (`border:gold`, World Championship decks, CE / IE) | S | 4.30 (white), 4.15 (silver), **4.69** (gold) |
| Color Identity Pips | `packM15CIPips.js` | the colour dot on transform backs | built-partially | the colour indicator on ordinary cards: 130 (`has:indicator -is:dfc`) | S | 4.6c |
| Miracle | `packM15Miracle.js` | — | not built | 50 (`frame:miracle`): AVR, EMN, SOI… | S | 4.7 (marks) |
| "The List" Stamp | `packTheList.js` | — | not built | 5,741 (`set:plst`): The List's small stamp | S | 4.15 |
| Colorshifted (Planar Chaos) | `packColorshifted.js` | — | not built | 64 (`frame:colorshifted`): Planar Chaos, TSR | S | 4.15 |
| Conspiracies (Draft Matters) | `packConspiracy.js` | — | not built | 31 (`t:conspiracy`): CNS, CN2 | S | 4.15 |

### Layout, two-part and double-faced bodies

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Adventures (Eldraine) | `packAdventure.js` | `adventure` | built | 460 adventures (ELD on) |  | 4.21a |
| Aftermath (Amonkhet) | `packAftermath.js` | `aftermath` | built | AKH / HOU aftermath |  | 4.21a |
| Split Cards | `packSplit.js` | `split` | built | split cards (2015 frame) |  | 4.21b |
| Flip (Kamigawa) | `packFlip.js` | `flip` | built | CHK-block flip cards and reprints |  | 4.21a |
| Battle (March of the Machine) | `packBattle.js` | `battle` | built | MOM / MAT battles |  | 4.21b |
| Regular Frames | `packSagaRegular.js` | `saga` | built | sagas (DOM 2018 → 2025) |  | 4.21c |
| Sagas (Front) | `packSagaDFC.js` | `sagadfcfront` (+ our own `sagadfcback`) | built | NEO transforming sagas; MOM / LCI saga backs |  | 5.5 |
| Nyx Frames | `packSagaNyx.js` | — | not built | the textured saga, TDM 2025 on: 221 printings | S | 4.5d |
| Scrolls of Middle-earth (LTR) | `packSagaLTR.js` | — | not built | LTR scroll sagas: 10 | S | 4.5d |
| Fuse Cards | `packFuse.js` | — | not built | 46 (`keyword:fuse`): DGM, MH…  | S | 4.7 |
| Spree (Outlaws of Thunder Junction) | `packSpree.js` | — | not built | 57 (`keyword:spree`): OTJ, OTC, BIG… | M | 4.7 |
| Cases (Murders at Karlov Manor) | `packCase.js` | — | not built | 27 (`layout:case`): MKM | L | 4.5e |
| Class (D&D) | `packClass.js` | — | not built | 72 (`layout:class`): AFR, CLB, BLB… | L | 4.5e |
| Levelers (Zendikar) | `packLevelers.js` | — | not built | 63 (`layout:leveler`): ROE, MH2… | M | 4.5e |
| Prototype (Brothers' War) | `packPrototype.js` | — | not built | 49 (`keyword:prototype`): BRO | M | 4.7 |
| Prototype (Extended Art) (Brothers' War) | `packPrototypeExtended.js` | — | not built | the extended-art BRO prototypes | S | 4.7 |
| Mutate (Ikoria) | `packM15Mutate.js` | — | not built | 146 (`keyword:mutate`): IKO | M | 4.7 |
| Attractions (Unfinity) | `packAttraction.js` | — | not built | 135 (`t:attraction`): UNF | L | 4.15 |
| Transform (Front) | `packM15TransformFront.js` | `m15dfcfront`, `m15dfclandfront` | built | transform fronts (2015 frame) |  | 5.1a |
| Transform (Back) | `packM15TransformBack.js` | `m15dfcbackleft` | built | the 2016–22 left-well backs |  | 5.1a |
| Transform (Back) (New) | `packM15TransformBackNew.js` | `m15dfcback`, `m15dfclandback` | built | the ▼ backs, 2022-11 on |  | 5.1a |
| Transform Icons | `packM15TransformTypes.js` | `dfcicon` | built | the transform icon families |  | 5.1a |
| Legend Crowns | `packTransformLegendCrowns.js` | `m15dfccrown`, `m15dfccrownright` | built | legendary transform faces |  | 5.1d |
| Borderless (Front) | `packTransformBorderlessFront.js` | pieces grafted into `m15borderlessdfcfront` | built-partially | the DARK borderless look is built (5.7); the LIGHT one is not: 36 | M | 5.7a |
| Borderless (Back) | `packTransformBorderlessBack.js` | pieces grafted into `m15borderlessdfcback` | built-partially | as above | M | 5.7a |
| Extended Art (Front) | `packTransformExtendedFront.js` | — | not built | 60 transform extended-art printings | M | 5.7b |
| Extended Art (Back) | `packTransformExtendedBack.js` | — | not built | as above | M | 5.7b |
| Floating Legend Crowns | `packTransformLegendCrownsFloating.js` | — | not built | crowned borderless / extended transform faces | S | 5.7a, 5.7b |
| Nickname Legend Crowns | `packTransformLegendCrownsNickname.js` | — | not built | VOW #332–341's nickname backs | S | 5.7c |
| Regular | `packModalRegular.js` | `m15mdfcfront`, `m15mdfcback`, the land pair | built | modal DFCs (ZNR 2020 on) |  | 5.1b |
| Regular Legend Crowns | `packModalLegendCrowns.js` | `m15mdfccrown` | built | legendary modal faces |  | 5.1d |
| Borderless | `packModalBorderless.js` | pieces grafted into `m15borderlessmdfc*` | built-partially | dark look built (5.7); light look not | M | 5.7a |
| Extended Art | `packModalExtended.js` | — | not built | 24 modal extended-art printings | M | 5.7b |
| Floating Legend Crowns | `packModalLegendCrownsFloating.js` | — | not built | crowned borderless / extended modal faces | S | 5.7a, 5.7b |
| Nickname | `packModalNickname.js` | — | not built | modal flavour-name printings | S | 5.7c, 6.3a |
| Nickname Legend Crowns | `packModalLegendCrownsNickname.js` | — | not built | as above | S | 5.7c, 6.3a |
| Short | `packModalShort.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Short-Nickname | `packModalShortNickname.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Helper Cards | `packModalHelper.js` | — | not built | MDFC / transform checklist cards | S | 5.3b |
| Double Feature (DBL) | `packDoubleFeature.js` | — | not built | DBL's black-and-white dress: 535 (`set:dbl`) | M | 5.9 |
| Double Feature: Transform (DBL) | `packDoubleFeatureTransform.js` | — | not built | DBL's double-faced cards (98 `inverted` + `sunmoondfc`) | M | 5.9 |

### Set showcases

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Breaking News (OTP) | `packBreakingNews.js` | `breakingnews` | built | OTP (2024) |  | 4.11 |
| Vault (BIG) | `packVault.js` | — | not built | The Big Score: 95 (`set:big`) | M | **4.57** |
| Wanted Poster (OTJ) | `packWanted.js` | — | not built | OTJ wanted posters: 13 (`set:otj frame:showcase`) | S | **4.58** |
| Pip-Boy (PIP) | `packPipboy.js` | — | not built | Fallout Pip-Boy: 52 (`set:pip frame:showcase`) | M | **4.59** |
| Dossier (MKM) | `packDossier.js` | `dossier` | built | MKM #336–389, #433 |  | 4.11 |
| Scrolls of Middle-earth (LTR) | `packScroll.js` | `lotrscroll` | built | LTR / LTC scrolls |  | 4.11 |
| Enchanting Tales (WOT) | `packEnchantingTales.js` | `enchantingtales` | built | WOT #1–63 |  | 4.11 |
| Eldraine Storybooks: Adventures (WOE) | `packStorybookWOE.js` | — | not built | WOE showcase adventures: 20 (`set:woe frame:showcase`) | M | 4.11 |
| TARDIS (WHO) | `packTARDIS.js` | `tardis` | built | WHO #535–564 + twins |  | 4.11 |
| Ring (LTR) | `packRing.js` | `lotr` | built | LTR #302–331 + twins |  | 4.11 |
| Eldraine Storybooks (MOM) | `packStorybookMUL.js` | — | not built | MUL's Eldraine legends: about 15 (5 legends × 3 finishes) | S | 4.11 |
| Ixalan Coin (MOM) | `packIxalanCoin.js` | — | not built | MUL's Ixalan legends: about 15 | S | 4.11 |
| Tarkir Sketch (MOM) | `packTarkir.js` | `tarkirdragon` | built | MUL's Tarkir legends |  | 4.11 |
| Ikoria Crystal (MOM) | `packCrystal.js` | — | not built | MUL's Ikoria legends: about 15 | S | **4.60** |
| Ravnica City (MOM) | `packRavnica.js` | — | not built | MUL's Ravnica legends (15, `ravnicacity`) and MKM #317–323 (14) | S | **4.61** |
| Oil Slick (ONE) | `packOilSlick.js` | — | not built | ONE borderless showcase: 85 | M | 4.11 |
| Stained Glass (DMU) | `packDMUStainedGlass.js` | `stainedglass` | built | DMU #287–368, MUL's Dominaria legends |  | 4.11 |
| Golden Age (SNC) | `packSNCGilded.js` | `sncartdeco` | built | SNC #296–340 + gilded twins (CC names it 'Golden Age') |  | 4.11 |
| Art Deco (SNC) | `packSNCArtDeco.js` | — | not built | SNC #341–360, the pale Golden Age cards (CC names it 'Art Deco'): 20 | S | **4.62** |
| Skyscraper (SNC) | `packSNCSkyscraper.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Ninja (NEO) | `packNeoNinja.js` | — | not built | NEO showcase ninjas / samurai: about 98 together (#309–426) | M | **4.63** |
| Samurai (NEO) | `packNeoSamurai.js` | — | not built | as above | M | **4.63** |
| Neon (NEO) | `packNeoNeon.js` | — | not built | NEO #429–432, Hidetsugu's neon ink: 4 | S | **4.63** |
| Fang (VOW) | `packFang.js` | — | not built | VOW's vampire showcase: about 31 (#286–328, not inverted) | M | **4.64** |
| Equinox: Single-faced (MID) | `packEquinox.js` | — | not built | MID's Equinox: 26 printings, 20 of them double-faced (#286–311) | M | **4.65** |
| Equinox: Transform Front (MID) | `packEquinoxFront.js` | — | not built | as above (the transform fronts) | M | **4.65** |
| Equinox: Transform Back (MID) | `packEquinoxBack.js` | — | not built | as above (the backs) | M | **4.65** |
| Eternal Night (MID) | `packEternalNight.js` | — | not built | MID / VOW black-and-white: 26 (MID 14, VOW 12) + 20 showcase basics | S | **4.66** |
| D&D Sourcebook (AFR) | `packDNDSourcebook.js` | `dndsourcebook` | built | AFR #299–349, CLB #375–450 |  | 4.11 |
| D&D Module (AFR) | `packDNDModule.js` | — | not built | AFR #350–358 dungeon-module lands: 9 | S | 4.11 |
| Sketch Cards (MH2) | `packMH2.js` | — | not built | MH2 sketch showcase: 54 (`set:mh2 frame:showcase`) | M | **4.67** |
| Mystical Archive (STA) | `packMysticalArchive.js` | `mysticalarchive` | built | STA #1–63 |  | 4.11 |
| Japanese Mystical Archive (STA) | `packMysticalArchiveJP.js` | — | not built | STA #64–126 (Japanese): 63 | M | 4.11 |
| Horizontal Japanese Mystical Archive (STA) | `packMysticalArchiveJPHorizontal.js` | — | not built | the horizontal Japanese archive cards (in the 63) | S | 4.11 |
| Kaldheim (KHM) | `packKaldheim-2.js` | — | not built | KHM showcase: 35 (`set:khm frame:showcase`), legendary and not | M | **4.68** |
| Nonlegendary Kaldheim (KHM) | `packKaldheimNonleg.js` | — | not built | as above | M | **4.68** |
| Commander Legends (CMR) | `packCommanderLegends.js` | — | not built | not mapped to a printing yet (Scryfall flags no CMR showcase) | ? | **4.70** |
| Zendikar Rising (ZNR) | `packZendikarRising.js` | `fullart` (the ZNR hedron showcase) | built | ZNR #290–313 |  | 4.11 |
| M21 Signature Spellbooks (M21) | `packM21.js` | — | not built | M21 showcase (Basri, Teferi, Liliana, Chandra, Garruk and basics): 29 | S | **4.71** |
| Theros Beyond Death (THB) | `packM15NyxShowcase.js` | `nyx` | built | THB #258–268 constellation |  | 4.11 |
| Eldraine Storybooks: Adventures (ELD) | `packStorybook.js` | — | not built | ELD showcase adventures: 30 (`set:eld frame:showcase`) | M | 4.11 |
| Phyrexian | `packPraetors.js` | — | not built | the Phyrexian frame: MUL's New Phyrexia legends (borderless, about 18 with finishes) | M | 4.11 |
| ZNR Expeditions (2020) | `packExpeditionZNR-1.js` | `expeditionland` | built | ZNE (2020) |  | 4.11 |
| BFZ Expeditions (2015) | `packExpeditionBFZ-1.js` | `expeditionlandbfz` | built | EXP (2015) |  | 4.11 |
| Signature Spellbook (Jace/Gideon) | `packSignatureSpellbook.js` | — | not built | SS1–SS3: 24 | S | 4.11 |
| Ixalan Maps | `packIxalan.js` | — | not built | not mapped to a printing yet (a map frame with type icons) | ? | **4.70** |
| Amonkhet Invocations (u/Smyris) | `packInvocation.js` | — | not built | MP2 Amonkhet Invocations: 54 (`set:mp2`) | M | 4.11 |
| Amonkhet Invocations (Multiverse Legends) | `packInvocationMUL.js` | — | not built | MUL's Amonkhet legends: about 15 | S | 4.11 |
| Kaladesh Inventions | `packInvention.js` | — | not built | MPS Kaladesh Inventions: 54 (`set:mps`) | M | 4.11 |

### Borderless, extended-art and full-art variants

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Borderless (Alt) | `packBorderless.js` | `m15borderless`, `m15borderlessartifact`, `m15borderlessland` (+ station) | built | the 2019+ dark-box borderless |  | 4.32, 4.34 |
| Borderless | `packGenericShowcase.js` | its box only | built-partially | the light-box borderless: 519 | S | 4.37 |
| Extended Art Frames | `packM15ExtendedArtNew.js` | `extendedart`, `extendedartland`, `extendedartstation` | built | extended art: 4,238 (`frame:extendedart`) |  | 4.7 |
| Extended Art (Regular) | `packM15BoxTopper.js` | as above (regular) | built-partially | its Nyx and snow extended art are not built: 127 Nyx (`frame:extendedart frame:nyxtouched`), 10 snow | S | **4.72** |
| Extended Art (Shorter Textbox) | `packM15ExtendedArtShort.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Nickname ("Godzilla") | `packM15Nickname.js` | — | not built | Godzilla and the borderless flavour-name printings: about 550 | M | 6.3a |
| Borderless Frames (Extra Short) | `packIkoShort.js` | — | not built | the borderless short box (SNC triomes, UNF lands…) | S | 4.37 |
| Fullart | `packM15ClearTextboxes.js` | — | not built | Card Conjurer's own 'clear text box' look (no printing) | S | 4.44 |
| Full Art | `packFullArtNew.js` | — | not built | Card Conjurer's own 'Full Art' look (no printing) | S | 4.44 |
| Full Text | `packFullText.js` | — | not built | 'Full Text' (no art) | S | 4.15 |
| FNM Promo (Inverted Promos) | `packFNM.js` | — | not built | the FNM promos' dress: 64 (`is:fnm frame:2015`); which ones wear it is to be read | S | **4.73** |
| Etched | `packEtched.js` | — | out of scope: declined | 849 (`frame:etched`): owner 2026-10-13 |  | 4.28 |
| Etched (Nyx) | `packEtchedNyx.js` | — | out of scope: declined | as above |  | 4.28 |
| Etched (Snow) | `packEtchedSnow.js` | — | out of scope: declined | as above |  | 4.28 |
| Legend Crowns (Etched) | `packLegendCrownsEtched.js` | — | out of scope: declined | as above |  | 4.28 |
| Inner Crowns (Etched) | `packInnerCrownsEtched.js` | — | out of scope: declined | as above |  | 4.28 |

### Promos and textless

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Magic Fest Promos | `packMagicFest.js` | `m15textless`, `m15textlessland` | built | the black-bordered textless promos |  | 4.42 |
| Generic Showcase | `packTextlessGenericShowcase.js` | — | not built | borderless textless: 71 (`is:textless border:borderless`) | S | 4.37 |
| Borderless Frames | `packPromoRegular-1.js` | — | not built | the borderless mid box (type at 65 %H) | S | 4.37 |
| Nickname Frames | `packPromoNickname.js` | — | not built | borderless flavour-name promos | S | 6.3a |
| Regular Frames | `packPromoOpenHouse.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Extended Art Frames | `packPromoExtended.js` | — | not built | not mapped to a printing yet | ? | **4.70** |
| Generic Showcase | `packPromoGenericShowcase.js` | — | not built | not mapped to a printing yet | ? | **4.70** |

### Full-art basic lands

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Fullart Basics (2022) | `packTextlessBasics2022.js` | `m15fullartland`, `fullartland` | built | the 2022+ full-art basics |  | 4.39 |
| Fullart Basics (ZEN) | `packZendikarBasic-1.js` | `m15fullartlandzen` | built | BFZ / OGW / AKH / HOU stone ring |  | 4.40 |
| Fullart Basics (SNC) | `packTextlessBasicsSNC.js` | `m15fullartlandsnc` | built | SNC |  | 4.40 |
| Fullart Basics (THB) | `packTextlessBasics.js` | `m15fullartlandthb` | built | THB |  | 4.41 |
| Fullart Snow Basics | `packFullartBasicRoundBottom.js` | — | not built | full-art snow basics: 27 (`t:basic t:snow is:fullart`) | S | 4.40 |
| Fullart Basics (Universes Beyond) | `packTextlessBasics2022UB.js` | — | not built | Universes Beyond full-art basics: 180 | S | 4.11 (iii) |
| Kamigawa Basics (NEO) | `packNeoBasics.js` | — | not built | NEO's Japanese basics: 10 | S | 4.11 (iii) |
| Unstable Basics (UST) | `packUnstable.js` | — | not built | UST basics: 5 | S | 4.11 (iii) |
| Unhinged Basics (UNH) | `packUnhinged.js` | — | not built | UNH basics: 5 | S | 4.11 (iii) |

### Token variants

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Textless | `packTokenTextless-1.js` | `m20token`, `m20tokenartifact` (+ Nyx) | built | M20+ textless tokens |  | 4.48 |
| Short | `packTokenShort-1.js` | `m20tokentext`, `m20tokenartifacttext` | built | M20+ tokens with a box |  | 4.48 |
| Tall | `packTokenTall-1.js` | `m20tokentall`, `m20tokenartifacttall` | built | M20+ tall-box tokens |  | 4.50 |
| Textless (Bordered M15) | `packTokenTextlessM15.js` | `m15token`, `m15tokenartifact` | built | the 2014–19 arch |  | 4.49 |
| Regular (Bordered M15) | `packTokenRegularM15.js` | `m15tokentext`, `m15tokenartifacttext` (+ our tall cut) | built | the 2014–19 arch with a box |  | 4.49, 4.55 |
| Planeswalker Emblems | `packEmblem.js` | `emblem` | built | M20+ emblems |  | 4.52 |
| Regular | `packTokenRegular-1.js` | — | out of scope: declined | matches no print (owner 2026-09-29) |  | 4.48 |
| Textless (Borderless) | `packTokenTextlessBorderless.js` | — | not built | borderless tokens: 20 | S | 4.37 |
| Original (Old Bordered) | `packTokenOld.js` | — | not built | old-frame tokens: 405 (`is:token frame:1993/1997/2003`) | M | 4.43 |
| Unglued | `packTokenUnglued.js` | — | not built | Unglued tokens: 6 | S | 4.15 |
| Monarch Token | `packTokenMonarch.js` | — | not built | the Monarch card | S | 6.4 |
| Initiative Token | `packTokenInitiative.js` | — | not built | the Initiative card | S | 6.4 |
| Day/Night Marker | `packTokenDayNight.js` | — | not built | the Day // Night card | S | 6.4 |
| Jumpstart Front Cards | `packJMPFront.js` | — | not built | Jumpstart front cards (with J22: 92) | S | 4.15 |
| Jumpstart 2022 Front Cards | `packJ22Front.js` | — | not built | as above | S | 4.15 |

### Planeswalkers (ask the owner first: listed only)

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Regular | `packPlaneswalkerRegular.js` | `m15pw` | built | planeswalkers, 2015 frame |  |  |
| Holo Stamps | `packPlaneswalkerHoloStamps.js` | `m15pwholostamp` | built |  |  | 4.9 |
| Borderless | `packPlaneswalkerBorderless.js` | `m15borderlesspw` | built |  |  | 4.33 |
| Tall Borderless | `packPlaneswalkerTallBorderless.js` | `m15borderlesspwtall` | built |  |  | 4.33 |
| Transform Icons | `packPlaneswalkerTransformIcons.js` | `dfcicon` | built |  |  | 5.1a |
| Tall | `packPlaneswalkerTall.js` | its masks only | built-partially | the tall bordered walker | S | 4.5b |
| Extended Art | `packPlaneswalkerBoxTopper.js` | — | not built | extended-art walkers | S | 4.5b |
| Compleated | `packPlaneswalkerCompleated.js` | — | not built | compleated walkers: 56 | S | 4.5b |
| Nickname | `packPlaneswalkerNickname.js` | — | not built | flavour-name walkers | S | 4.5b, 6.3a |
| Blackout (SDCC15) | `packPlaneswalkerSDCC15.js` | — | not built | SDCC 2015 blackout walkers (PS15: 5) | S | 4.5b |
| SDCC15 (Blackout) | `packSDCC15.js` | — | not built | as above (their creature fronts) | S | 4.5b |
| SDCC15 (Blackout) | `packTransformSDCC15.js` | — | not built | as above | S | 4.5b, 5.13 |
| Innistrad: Double Feature | `packPlaneswalkerDBL.js` | — | not built | DBL walkers | S | 5.9, 5.13 |
| Innistrad: Double Feature (Tall) | `packPlaneswalkerTallDBL.js` | — | not built | as above | S | 5.9, 5.13 |
| MDFC | `packPlaneswalkerMDFC.js` | — | not built | modal walker faces | M | 5.13 |
| Transform (Front) | `packPlaneswalkerTransformFront.js` | — | not built | transform walker faces | M | 5.13 |
| Transform (Back) | `packPlaneswalkerTransformBack.js` | — | not built | as above | M | 5.13 |
| Innistrad: Double Feature: Transform (Front) | `packPlaneswalkerTransformFrontDBL.js` | — | not built | as above, DBL | S | 5.9, 5.13 |
| Innistrad: Double Feature: Transform (Back) | `packPlaneswalkerTransformBackDBL.js` | — | not built | as above, DBL | S | 5.9, 5.13 |

### Old frames and other card types

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| 8th Edition | `pack8th.js` | `modern`, `modernland` | built | the 2003 frame (8ED → JOU) |  | 4.10b |
| Seventh Edition | `packSeventh.js` | `retro`, `retroland` | built | the 1997 frame |  | 4.10a |
| Fifth Edition | `packSeventhButFifth.js` | the white border on `retro` | built (other source) | Fifth / Sixth Edition white border |  | 4.30 |
| Alpha/Beta/Unlimited | `packABU.js` | `agclassic`, `alphaland` (from MSE) | built (other source) | Alpha / Beta / Unlimited |  | 4.10c |
| Colorshifted | `pack8thColorshifted.js` | — | not built | Planar Chaos colour-shifted on the 2003 frame (in the 64) | S | 4.15 |
| Fourth Edition | `packFourth.js` | — | not built | Fourth Edition: 380 (`set:4ed`) | S | 4.30b, 4.10h |
| Legends Multicolored | `packLegends.js` | — | not built | Legends' gold cards: 55 (`set:leg c:m`) | S | **4.74** |
| Future Shifted | `packFutureRegular.js` | — | not built | Future Sight: 252 (`frame:future`) | L | 4.15 |
| Playtest Cards | `packPlaytest.js` | — | not built | playtest cards: 952 (`is:playtest`) | M | 4.15 |
| Dungeon (AFR) | `packDungeon.js` | — | not built | dungeons: 10 (`t:dungeon`) | L | 4.15 |
| Planechase | `packPlanechase.js` | — | not built | planes and phenomena: 329 | L | 4.15 |
| Vanguard | `packVanguard.js` | — | not built | Vanguard: 119 | M | 4.15 |
| Cardback | `packCardback.js` | — | out of scope: not needed | the card back |  |  |

### Universes Beyond

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Universes Beyond | `packUBNew.js` | `m15ub`, `m15ubartifact`, `m15ubland`, `m15ubholostamp` | built | the streaked UB dress, 2022-10 → 2025-06 |  | 4.25 |
| Legend Crowns (Universes Beyond) | `packUBLegendCrownsNew.js` | `m15ubcrown` | built |  |  | 4.25 |
| Universes Beyond | `packUB.js` | as above | built (twin pack) | the older drawing |  | 4.25 |
| Legend Crowns (Universes Beyond) | `packUBLegendCrowns.js` | as above | built (twin pack) | the older drawing |  | 4.25 |
| Universes Beyond (Extended art) | `packUBExtendedArt.js` | — | not built | UB extended art: 1,124 | S–M | 4.25 |
| Universes Beyond (Full art) | `packUBFull.js` | — | not built | UB full art | S–M | 4.25 |
| Floating Legend Crowns (Universes Beyond) | `packUBLegendCrownsFloating.js` | — | not built | the crowns of those two looks | S | 4.25 |
| Sagas (Universes Beyond) / Universes Beyond Frames | `packSagaUB.js` | — | not built | UB sagas: 254 | S | 4.5d, 4.25 |
| Spree (Universes Beyond) | `packSpreeUB.js` | — | not built | UB spree: 3 | S | 4.7, 4.25 |

### Out of scope: community designs, print margins, other games

| Card Conjurer pack (its name) | File | PipGlyph | Status | Printed cards | Size | TODO |
| --- | --- | --- | --- | --- | --- | --- |
| Misc. Custom Frames | `packMiscCustom.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Deck Covers | `packCustomDeckCover.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Simple Inventions | `packSimpleInventions.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Tapped (Horizontal M15) | `packTapped.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Textless Duals | `packCustomDualLands.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Textless Seventh | `packSeventhTextless.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Seventh Edition Planeswalkers | `packPlaneswalkerSeventh.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Seventh Edition Sagas | `packOldSaga.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Seventh Edition Snow Lands | `packSeventhSnowLands.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Floating Old Border | `packOldFloating.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Floating Old Border (Short) | `packOldFloatingShort.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Regular | `packM15Eighth.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Nyx | `packM15EighthNyx.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Snow | `packM15EighthSnow.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Universes Beyond | `packM15EighthUB.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted | `packClassicshifted.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted Lands | `packClassicshiftedLands.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted Planeswalkers | `packClassicshiftedPlaneswalker.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted Planeswalker Transform Addons | `packClassicshiftedPlaneswalkerTransform.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted Sagas | `packClassicshiftedSaga.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted MDFC Addons | `packClassicshiftedDFC.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Classicshifted Transform Addons | `packClassicshiftedTransform.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Color Identity Pips | `packClassicshiftedCIPips.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Short Neon (NEO) | `packNEONeonShort.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Colored Golden Age (SNC) | `packSNCGildedColored.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Textless Golden Age (SNC) | `packSNCGildedTextless.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Textless Equinox (MID) | `packEquinoxTextless.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Extended Art Invocations | `packAKHInvocationExtended.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Textless Inventions | `packTextlessInvention.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Brawl Legend Crowns | `packBrawl.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Brawl Legend Crowns | `packModalLegendCrownsBrawl.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Brawl Crowns | `packTransformLegendCrownsBrawl.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Cartoony - Sheepwave | `packCartoony.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Neon - Elry | `packCustomNeon.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Ixalan - @feuer_ameise | `packFeuerAmeiseIxalan.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Kaldheim, Fullart - @feuer_ameise | `packFeuerAmeiseKaldheim.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Celid's Asap | `packCustomCelidAsap.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Magrao's Kaldheim | `packCustomMagraoKaldheim.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Circuit | `packCircuit.js` | — | out of scope: community design |  |  | Q7 of the 2026-10-13 roadmap |
| Generic Margins | `packMargin-1.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Breaking News Margin | `packMarginBreakingNews.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Vault Margin | `packMarginVault.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Wanted Poster Margin | `packMarginWanted.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Enchanting Tales Margins | `packMarginEnchantingTales.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| LTR Ring Margins | `packMarginRing.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| D&D Module Margins | `packMarginDNDModule.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Mystical Archive Margins | `packMarginMysticalArchive.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Unstable Basics Margins | `packMarginUnstable.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Invocation Margins | `packMarginInvocation.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Accurate Frame Margins | `packMarginNew.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Celid's Asap Margins | `packCustomMarginCelidAsap.js` | — | out of scope: not needed | print margins: PipGlyph makes its own bleed (`EDGE_CONTRACTS`) |  |  |
| Generic Frames | `packFABRegular.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Class Frames | `packFABClasses.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Hero Frames | `packFABHeroes.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Fabled Frame | `packFABFabled.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Light Frames | `packFABLight.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Shadow Frames | `packFABShadow.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Elemental Frames | `packFABElemental.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |
| Pokemon | `packPokemon.js` | — | out of scope: not Magic | Flesh and Blood / Pokémon |  |  |

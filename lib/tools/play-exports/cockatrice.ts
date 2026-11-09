import { cardColors, mainTypeOf, statsLine } from "./card-words";
import { fullNameOf, PLAY_TARGET_LABELS, type PlayBoard, type PlayCustomCard, type PlayExport, type PlayFace } from "./model";

// ---------------------------------------------------------------------------
// Cockatrice — a custom set (card database v4, `cockatrice_carddatabase
// version="4"`, Cockatrice 3.1.2's doc/carddatabase_v4/cards.xsd) plus a deck
// file (.cod, `cockatrice_deck version="1"`) and the pictures, in one ZIP:
//
//   <stem>/<stem>.xml          Card Database → "Add custom sets/cards" (it
//                              takes an .xml only — never the ZIP itself —
//                              and reloads the database by itself)
//   <stem>/<stem>.cod          the deck editor opens it
//   <stem>/pictures/<SET>/…    Card Database → "Open custom image folder":
//                              the folder is scanned recursively, each file
//                              found by `{name}_{SET}` (the extension is
//                              ignored, the content read: PNG or JPEG only)
//   <stem>/HOW-TO-IMPORT.txt
//
// Each printing also carries `picurl` = the card's stored display bake, which
// Cockatrice tries FIRST when picture downloads are on; a private card has
// none (lib/tools/play-exports/build.ts) and plays as text.
//
// Faces as Oracle (Cockatrice's importer) writes them: a double-faced card is
// TWO cards, each `side` front/back, joined by `<related attach="transform">`;
// a one-picture two-part card (split, adventure…) is ONE card "A // B". Mana
// costs lose their braces but for the two-part symbols ("2{W/U}"). Real
// cards are in the .cod by name only: Cockatrice plays them from its own
// database. Pure.
// ---------------------------------------------------------------------------

export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "{2}{W/U}{G}" → "2{W/U}G" — Oracle's rule: braces kept only on the
 *  two-part symbols. */
export function cockatriceManaCost(cost: string | null | undefined): string {
  if (!cost) return "";
  return cost.replace(/\{([^}]*)\}/g, (_, inner: string) => (/^[0-9WUBGRPSCX]+\/[0-9WUBGRPSCX]+$/i.test(inner) ? `{${inner.toUpperCase()}}` : inner.toUpperCase()));
}

/** A set code for the export: "PG" + four letters from its stem, so two
 *  exports' pictures never share a file name. */
export function cockatriceSetCode(stem: string): string {
  let hash = 2166136261;
  for (const ch of stem) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += letters[hash % letters.length];
    hash = Math.floor(hash / letters.length);
  }
  return `PG${code}`;
}

/** Cockatrice's picture-name cleaning (card_info.cpp): " // " and
 *  `*<>:"\?` and control characters removed, "/" a space. */
export function cockatriceSimpleName(name: string): string {
  return name
    .replace(/ \/\/ /g, "")
    .replace(/[*<>:"\\?\u0000-\u001f]/g, "")
    .replace(/\//g, " ");
}

/** The picture's path in the ZIP (under the export's folder). */
export function cockatricePicturePath(cardName: string, setCode: string): string {
  return `pictures/${setCode}/${cockatriceSimpleName(cardName)}_${setCode}.jpg`;
}

/** Oracle's table row: 0 lands, 2 creatures, 3 instants and sorceries, 1
 *  every other permanent. */
export function tableRowOf(mainType: string): number {
  if (mainType === "Land") return 0;
  if (mainType === "Creature") return 2;
  if (mainType === "Instant" || mainType === "Sorcery") return 3;
  return 1;
}

type CardEntry = {
  name: string;
  text: string;
  face: PlayFace;
  layout: string;
  side: "front" | "back" | null;
  manacost: string;
  cmc: number;
  colors: string;
  picurl: string | null;
  related: string | null;
  isToken: boolean;
  rarity: string;
  num: number;
};

function cardXml(entry: CardEntry, setCode: string): string {
  const mainType = mainTypeOf(entry.face.typeLine);
  const props: Array<[string, string]> = [
    ["layout", entry.layout],
    ...(entry.side ? ([["side", entry.side]] as Array<[string, string]>) : []),
    ["type", entry.face.typeLine],
    ["maintype", mainType],
    ["manacost", entry.manacost],
    ["cmc", String(entry.cmc)],
    ["colors", entry.colors],
    ["coloridentity", entry.colors],
  ];
  if (entry.face.power != null || entry.face.toughness != null) {
    props.push(["pt", entry.face.toughness != null ? `${entry.face.power ?? "?"}/${entry.face.toughness}` : `${entry.face.power}`]);
  }
  // A battle's defense rides the loyalty counter: Cockatrice has no slot of
  // its own for it.
  const loyalty = entry.face.loyalty ?? entry.face.defense;
  if (loyalty != null) props.push(["loyalty", loyalty]);
  const setAttrs = [
    `rarity="${xmlEscape(entry.rarity)}"`,
    `num="${entry.num}"`,
    ...(entry.picurl ? [`picurl="${xmlEscape(entry.picurl)}"`] : []),
  ].join(" ");
  return [
    "    <card>",
    `      <name>${xmlEscape(entry.name)}</name>`,
    `      <text>${xmlEscape(entry.text)}</text>`,
    "      <prop>",
    ...props.filter(([, value]) => value !== "").map(([key, value]) => `        <${key}>${xmlEscape(value)}</${key}>`),
    "      </prop>",
    `      <set ${setAttrs}>${xmlEscape(setCode)}</set>`,
    ...(entry.related ? [`      <related attach="transform">${xmlEscape(entry.related)}</related>`] : []),
    ...(entry.isToken ? ["      <token>1</token>"] : []),
    `      <tablerow>${tableRowOf(mainType)}</tablerow>`,
    "    </card>",
  ].join("\n");
}

/** The card entries of one custom card (two for a double-faced card). */
function entriesOf(card: PlayCustomCard, num: number): CardEntry[] {
  const colors = cardColors(card).join("");
  const base = { cmc: card.manaValue, colors, isToken: card.isToken, rarity: card.rarity, num };
  if (card.back) {
    return [
      {
        ...base,
        name: card.front.name,
        text: card.front.rulesText ?? "",
        face: card.front,
        layout: card.layout,
        side: "front",
        manacost: cockatriceManaCost(card.front.cost),
        picurl: card.front.image,
        related: card.back.name,
      },
      {
        ...base,
        name: card.back.name,
        text: card.back.rulesText ?? "",
        face: card.back,
        layout: card.layout,
        side: "back",
        manacost: cockatriceManaCost(card.back.cost),
        picurl: card.back.image,
        related: card.front.name,
      },
    ];
  }
  if (card.secondPart) {
    // One picture, one card: both parts' words, as Oracle merges a split card.
    const second = card.secondPart;
    const text = [
      card.front.rulesText ?? "",
      "---",
      [second.name, second.cost].filter(Boolean).join(" "),
      second.typeLine,
      second.rulesText ?? "",
      statsLine(second) ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    const costs = [card.front.cost, second.cost].filter(Boolean).map((cost) => cockatriceManaCost(cost));
    return [
      {
        ...base,
        name: fullNameOf(card),
        text,
        face: { ...card.front, typeLine: `${card.front.typeLine} // ${second.typeLine}` },
        layout: "split",
        side: null,
        manacost: costs.join(" // "),
        picurl: card.front.image,
        related: null,
      },
    ];
  }
  return [
    {
      ...base,
      name: card.front.name,
      text: card.front.rulesText ?? "",
      face: card.front,
      layout: "normal",
      side: null,
      manacost: cockatriceManaCost(card.front.cost),
      picurl: card.front.image,
      related: null,
    },
  ];
}

/** The name the .cod plays a custom card by (a two-part card's whole name). */
function deckNameOf(card: PlayCustomCard): string {
  return card.secondPart ? fullNameOf(card) : card.front.name;
}

export type CockatricePicture = {
  /** Path inside the export's folder. */
  path: string;
  /** The stored bake to fetch (its thumbnail, else the HD PNG). */
  url: string;
};

export type CockatriceFiles = {
  setCode: string;
  xml: string;
  /** Null for a selection of cards (no deck to load). */
  cod: string | null;
  pictures: CockatricePicture[];
  readme: string;
};

const ZONE_OF: Record<PlayBoard, "main" | "side"> = {
  commander: "main",
  main: "main",
  companion: "side",
  side: "side",
};

export function buildCockatrice(exp: PlayExport, opts: { today: string }): CockatriceFiles {
  const setCode = cockatriceSetCode(exp.fileStem);
  const entries = exp.cards.flatMap((card, i) => entriesOf(card, i + 1));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<cockatrice_carddatabase version="4">',
    "  <info>",
    "    <author>PipGlyph</author>",
    `    <createdAt>${xmlEscape(opts.today)}</createdAt>`,
    "  </info>",
    "  <sets>",
    "    <set>",
    `      <name>${setCode}</name>`,
    `      <longname>${xmlEscape(`${exp.title} (PipGlyph)`)}</longname>`,
    "      <settype>Custom</settype>",
    `      <releasedate>${xmlEscape(opts.today)}</releasedate>`,
    "    </set>",
    "  </sets>",
    "  <cards>",
    ...entries.map((entry) => cardXml(entry, setCode)),
    "  </cards>",
    "</cockatrice_carddatabase>",
    "",
  ].join("\n");

  const pictures: CockatricePicture[] = entries.flatMap((entry) => {
    const url = entry.face.thumb ?? entry.face.image;
    return url ? [{ path: cockatricePicturePath(entry.name, setCode), url }] : [];
  });

  let cod: string | null = null;
  if (exp.source === "deck") {
    const byId = new Map(exp.cards.map((card) => [card.id, card]));
    const zones: Record<"main" | "side" | "tokens", string[]> = { main: [], side: [], tokens: [] };
    for (const line of exp.lines) {
      const custom = line.kind === "custom" ? byId.get(line.cardId) : null;
      const name = custom ? deckNameOf(custom) : line.kind === "real" ? line.name : null;
      if (!name) continue;
      const zone = custom?.isToken ? "tokens" : ZONE_OF[line.board];
      zones[zone].push(`    <card number="${line.quantity}" name="${xmlEscape(name)}"/>`);
    }
    cod = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<cockatrice_deck version="1">',
      `  <deckname>${xmlEscape(exp.title)}</deckname>`,
      `  <comments>${xmlEscape(`Exported from PipGlyph on ${opts.today}. Load ${exp.fileStem}.xml first (Card Database → Add custom sets/cards).`)}</comments>`,
      ...(["main", "side", "tokens"] as const)
        .filter((zone) => zone !== "tokens" || zones.tokens.length > 0)
        .map((zone) => [`  <zone name="${zone}">`, ...zones[zone], "  </zone>"].join("\n")),
      "</cockatrice_deck>",
      "",
    ].join("\n");
  }

  const readme = [
    `${exp.title} — for ${PLAY_TARGET_LABELS.cockatrice}`,
    `Exported from PipGlyph on ${opts.today}.`,
    "",
    "1. In Cockatrice, open Card Database → Add custom sets/cards and pick",
    `   ${exp.fileStem}.xml. Cockatrice reloads its card database by itself.`,
    "2. Open Card Database → Open custom image folder and copy the",
    `   pictures folder into it (the ${setCode} folder inside is fine as it is).`,
    ...(cod
      ? ["3. In the deck editor, open " + `${exp.fileStem}.cod.`, "   Real cards play from Cockatrice's own database."]
      : []),
    "",
    "If a picture doesn't show, check Settings → Card Sources: Cockatrice",
    "keeps a picture it downloaded before. Delete Downloaded Images there",
    "after you change a card and export it again.",
    "",
  ].join("\n");

  return { setCode, xml, cod, pictures, readme };
}

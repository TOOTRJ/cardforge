// ---------------------------------------------------------------------------
// Visual-accuracy audit: render every frame template through the real Satori
// bake (via the dev-only /api/dev/render harness) using the SAME content as an
// official Magic card, then composite our render side-by-side with the
// official Scryfall scan for review.
//
//   1. `npm run dev` (the harness route is dev-only)
//   2. node scripts/visual-audit.mjs [frame ...]
//
// Output: tmp/visual-audit/<frame>.png   (left: official, right: ours)
//         tmp/visual-audit/<frame>.json  (the payload we rendered, for repro)
//
// Scryfall etiquette: identifying User-Agent + ~10 req/s max.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const HARNESS = process.env.HARNESS_URL ?? "http://localhost:3000/api/dev/render";
const OUT_DIR = path.join(process.cwd(), "tmp", "visual-audit");
const UA = { "User-Agent": "PipGlyphVisualAudit/1.0", Accept: "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scryfall(url) {
  await sleep(120);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${url}`);
  return res.json();
}

const named = (name, set) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}${set ? `&set=${set}` : ""}`;
const search = (q) =>
  `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;

// --- Scryfall card JSON → our CardPreviewData -------------------------------

const TYPE_WORDS = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
];

function parseTypeLine(typeLine) {
  const [left, right] = typeLine.split("—").map((s) => s.trim());
  const words = left.split(/\s+/);
  const cardType =
    TYPE_WORDS.find((t) => words.some((w) => w.toLowerCase() === t)) ?? "creature";
  const supertype = words
    .filter((w) => !TYPE_WORDS.includes(w.toLowerCase()))
    .filter((w) => !["Token"].includes(w))
    .join(" ");
  return {
    cardType,
    supertype: supertype || null,
    subtypes: right ? right.split(/\s+/) : [],
  };
}

const COLOR_NAME = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

function colorIdentity(colors) {
  if (!colors || colors.length === 0) return ["colorless"];
  if (colors.length > 1) return ["multicolor"];
  return [COLOR_NAME[colors[0]] ?? "colorless"];
}

function faceToPreviewFields(face) {
  const t = parseTypeLine(face.type_line ?? "");
  return {
    title: face.name,
    cost: face.mana_cost || null,
    cardType: t.cardType,
    supertype: t.supertype,
    subtypes: t.subtypes,
    rulesText: face.oracle_text || null,
    flavorText: face.flavor_text || null,
    power: face.power ?? null,
    toughness: face.toughness ?? null,
    loyalty: face.loyalty ?? null,
    defense: face.defense ?? null,
  };
}

function faceToBackFace(face) {
  const t = parseTypeLine(face.type_line ?? "");
  return {
    title: face.name,
    cost: face.mana_cost || undefined,
    card_type: t.cardType,
    supertype: t.supertype ?? undefined,
    subtypes: t.subtypes,
    rules_text: face.oracle_text || undefined,
    flavor_text: face.flavor_text || undefined,
    power: face.power ?? undefined,
    toughness: face.toughness ?? undefined,
  };
}

function buildPreviewData(card, frame) {
  const faces = card.card_faces?.length ? card.card_faces : [card];
  const front = faces[0];
  const back = faces[1];
  const img = front.image_uris ?? card.image_uris ?? {};
  return {
    ...faceToPreviewFields(front),
    rarity: card.rarity === "special" ? "rare" : card.rarity,
    colorIdentity: colorIdentity((card.colors?.length ? card.colors : null) ?? (front.colors?.length ? front.colors : null) ?? card.color_identity),
    artistCredit: card.artist ?? front.artist ?? null,
    artUrl: img.art_crop ?? null,
    frameStyle: { template: frame, finish: "regular" },
    backFace: back
      ? { ...faceToBackFace(back), art_url: img.art_crop ?? undefined }
      : null,
  };
}

// --- The reference matrix ----------------------------------------------------
// rotate: degrees to rotate the OFFICIAL scan so it reads the way our render
// does (battles/splits are printed portrait but designed sideways).

const REFS = [
  { frame: "m15", url: named("Colossal Dreadmaw", "xln") },
  { frame: "m15land", url: named("Evolving Wilds") },
  { frame: "m15token", url: search("t:token is:fullart frame:2015 -is:digital t:soldier") },
  { frame: "m15snow", url: named("Berg Strider", "khm") },
  { frame: "m15devoid", url: named("Reality Smasher", "ogw") },
  { frame: "m15pw", url: named("Vivien Reid", "m19") },
  { frame: "agclassic", url: named("Llanowar Elves", "lea") },
  { frame: "retro", url: named("Mogg Fanatic", "tmp") },
  { frame: "retroland", url: named("Wasteland", "tmp") },
  { frame: "modern", url: named("Shivan Dragon", "8ed") },
  { frame: "modernland", url: named("Evolving Wilds", "dka") },
  { frame: "alphaland", url: search("set:lea t:forest") },
  // alphatoken: no official 1993 token exists — rendered solo, judged vs MSE intent.
  { frame: "alphatoken", url: null, sample: alphaTokenSample() },
  { frame: "battle", url: named("Invasion of Zendikar", "mom"), rotate: 90 },
  { frame: "saga", url: named("History of Benalia", "dom") },
  { frame: "adventure", url: named("Bonecrusher Giant", "eld") },
  { frame: "flip", url: named("Nezumi Graverobber", "chk") },
  { frame: "split", url: named("Connive // Concoct", "grn"), rotate: 90 },
  { frame: "aftermath", url: named("Dusk // Dawn", "akh") },
  { frame: "lotr", url: search('e:ltr frame:showcase t:creature -is:digital "Frodo"') },
  { frame: "lotrscroll", url: search("e:ltc frame:showcase -is:digital") },
  { frame: "avatar", url: search("e:tla frame:showcase t:creature -is:digital") },
  { frame: "bloomburrow", url: search("e:blb frame:showcase t:creature -is:digital") },
  { frame: "bloomanime", url: search("e:blb is:borderless t:creature -is:digital") },
  { frame: "tarkirdragon", url: search("e:tdm frame:showcase t:creature -is:digital") },
  { frame: "tarkirdraconic", url: search("e:tdm frame:showcase t:dragon -is:digital") },
  { frame: "tarkirghostfire", url: named("Craterhoof Behemoth", "tdm") },
];

function alphaTokenSample() {
  return {
    title: "Goblin",
    cardType: "token",
    subtypes: ["Goblin"],
    rarity: "common",
    colorIdentity: ["red"],
    rulesText: "Haste",
    power: "1",
    toughness: "1",
    artistCredit: "PipGlyph",
    artUrl: null,
    frameStyle: { template: "alphatoken", finish: "regular" },
  };
}

// --- Render + composite ------------------------------------------------------

async function renderOurs(card) {
  const res = await fetch(HARNESS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card, preset: "default", watermark: false }),
  });
  if (!res.ok) throw new Error(`Harness ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchOfficialPng(card) {
  const img =
    card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;
  const url = img?.png ?? img?.large ?? img?.normal;
  if (!url) throw new Error(`No image for ${card.name}`);
  await sleep(120);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Image ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function composite(officialBuf, oursBuf, outPath, rotate) {
  let official = sharp(officialBuf);
  if (rotate) official = official.rotate(rotate);
  const H = 1040;
  const left = await official.resize({ height: H }).png().toBuffer();
  const right = await sharp(oursBuf).resize({ height: H }).png().toBuffer();
  const lm = await sharp(left).metadata();
  const rm = await sharp(right).metadata();
  const gutter = 24;
  await sharp({
    create: {
      width: lm.width + rm.width + gutter * 3,
      height: H + gutter * 2,
      channels: 3,
      background: { r: 24, g: 24, b: 28 },
    },
  })
    .composite([
      { input: left, left: gutter, top: gutter },
      { input: right, left: lm.width + gutter * 2, top: gutter },
    ])
    .png()
    .toFile(outPath);
}

// --- Main --------------------------------------------------------------------

const only = process.argv.slice(2);

await fs.mkdir(OUT_DIR, { recursive: true });

for (const ref of REFS) {
  if (only.length && !only.includes(ref.frame)) continue;
  try {
    let official = null;
    let sample = ref.sample ?? null;
    if (ref.url) {
      let card = await scryfall(ref.url);
      if (card.object === "list") card = card.data[0];
      official = card;
      sample = sample ?? buildPreviewData(card, ref.frame);
    }
    const oursBuf = await renderOurs(sample);
    await fs.writeFile(
      path.join(OUT_DIR, `${ref.frame}.json`),
      JSON.stringify({ official: official?.scryfall_uri ?? null, name: official?.name ?? sample.title, sample }, null, 2),
    );
    if (official) {
      const officialBuf = await fetchOfficialPng(official);
      await composite(officialBuf, oursBuf, path.join(OUT_DIR, `${ref.frame}.png`), ref.rotate);
      console.log(`✓ ${ref.frame}  (vs ${official.name} · ${official.set.toUpperCase()})`);
    } else {
      await fs.writeFile(path.join(OUT_DIR, `${ref.frame}.png`), oursBuf);
      console.log(`✓ ${ref.frame}  (no official reference — rendered solo)`);
    }
  } catch (err) {
    console.error(`✗ ${ref.frame}: ${err.message}`);
  }
}

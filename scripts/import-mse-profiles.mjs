// MSE style → frame-profile review report.
//
// Parses the Full-Magic-Pack style files the site's frame PNGs were built
// from and diffs their element geometry against the live FrameProfile
// values. OUTPUT IS A REVIEW REPORT (docs/mse-profile-report.md + .json) —
// this script NEVER writes profiles: scan-measured values beat MSE where
// they exist (proven: MSE m15 type font is 13/375 where real cards print
// ~17/375-equivalent), so merges into lib/cards/template-layout.ts are a
// deliberate human step per template.
//
// Run: node scripts/import-mse-profiles.mjs
// (Node ≥23 — imports lib TS directly via native type stripping.)

import fs from "node:fs";
import path from "node:path";

const PACK = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const OUT_MD = "docs/mse-profile-report.md";
const OUT_JSON = "docs/mse-profile-report.json";

const { parseMseStyle, extractElement, cardDimensions, getNode } = await import(
  "../lib/mse/parse-mse-style.ts"
);
const { getFrameProfile } = await import("../lib/cards/template-layout.ts");

// template → style dir (relative to PACK) + optional extra elements.
// Standard elements (always attempted): name→title, image→artSlot,
// type→type, text→rules, pt→pt, casting cost→costSizePct (symbol font),
// symbol→set-symbol box, illustrator→footer (old frames only).
const TEMPLATE_SOURCES = {
  m15: { dir: "magic-m15.mse-style" },
  m15land: { dir: "magic-m15.mse-style", note: "land variant shares magic-m15 geometry" },
  m15token: { dir: "magic-m15-token.mse-style" },
  m15snow: { dir: "magic-m15-snow.mse-style" },
  m15devoid: { dir: "magic-m15-devoid.mse-style" },
  m15pw: { dir: "magic-m15-planeswalker.mse-style", extras: ["loyalty", "loyalty box"] },
  battle: { dir: "magic-m15-mainframe-battles.mse-style", extras: ["loyalty", "defense box"] },
  saga: { dir: "magic-m15-saga.mse-style", extras: ["level 2", "level 3", "level 4", "chapter 1"] },
  adventure: { dir: "magic-m15-adventure.mse-style", extras: ["name 2", "type 2", "text 2", "casting cost 2"] },
  flip: { dir: "magic-m15-flip.mse-style", extras: ["name 2", "type 2", "text 2", "pt 2"] },
  split: { dir: "magic-m15-planeshifted-split.mse-style", extras: ["name 2", "type 2", "text 2", "casting cost 2"] },
  aftermath: { dir: "magic-m15-aftermath.mse-style", extras: ["name 2", "type 2", "text 2", "casting cost 2"] },
  agclassic: { dir: "magic-agclassic.mse-style" },
  alphaland: { dir: "magic-agclassic.mse-style", note: "land variant shares agclassic geometry" },
  alphatoken: { dir: "magic-agclassic-token.mse-style" },
  retro: { dir: "magic-old.mse-style" },
  retroland: { dir: "magic-old.mse-style", note: "land variant shares magic-old geometry" },
  modern: { dir: "magic-new.mse-style" },
  modernland: { dir: "magic-new.mse-style", note: "land variant shares magic-new geometry" },
  lotr: { dir: "magic-m15-showcase-lotr.mse-style" },
  lotrscroll: { dir: "magic-m15-showcase-lotr-scroll.mse-style" },
  avatar: { dir: "magic-m15-showcase-avatar-elemental.mse-style" },
  bloomburrow: { dir: "magic-m15-showcase-bloomburrow-woodland.mse-style" },
  bloomanime: { dir: "magic-m15-showcase-bloomburrow-borderless-anime.mse-style" },
  tarkirdragon: { dir: "magic-m15-showcase-tarkir-dragon-wing.mse-style" },
  tarkirdraconic: { dir: "magic-m15-showcase-tarkir-draconic.mse-style" },
  tarkirghostfire: { dir: "magic-m15-showcase-tarkir-ghostfire-walker.mse-style" },
};

// MSE element → profile slot for the standard comparisons.
const SLOT_MAP = [
  { mse: "name", slot: "title", rect: (p) => p.title.rect, size: (p) => p.title.sizePct },
  { mse: "image", slot: "artSlot", rect: (p) => p.artSlot, size: () => null },
  { mse: "type", slot: "type", rect: (p) => p.type.rect, size: (p) => p.type.sizePct },
  { mse: "text", slot: "rules", rect: (p) => p.rules.rect, size: (p) => p.rules.sizePct },
  { mse: "pt", slot: "pt", rect: (p) => p.pt?.rect ?? null, size: (p) => p.pt?.sizePct ?? null },
  { mse: "illustrator", slot: "footer", rect: (p) => p.footer?.rect ?? null, size: (p) => p.footer?.sizePct ?? null },
  { mse: "symbol", slot: "symbol", rect: () => null, size: (p) => p.symbolSizePct ?? p.type.sizePct * 1.1 },
];

// Size fields are small fractions of card width — keep 4 decimals for them.
const fmt = (v) =>
  v === null || v === undefined
    ? "—"
    : typeof v !== "number"
      ? String(v)
      : Math.abs(v) < 1
        ? String(Math.round(v * 10000) / 10000)
        : String(Math.round(v * 100) / 100);
const delta = (mse, cur) =>
  mse === null || mse === undefined || cur === null || cur === undefined
    ? "—"
    : Math.abs(mse) < 1 && Math.abs(cur) < 1
      ? (Math.round((mse - cur) * 10000) / 10000).toFixed(4)
      : (Math.round((mse - cur) * 100) / 100).toFixed(2);

const report = {};
const mdParts = [
  "# MSE profile review report",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by scripts/import-mse-profiles.mjs from ${PACK}.`,
  "",
  "> **How to read this:** MSE values are the coordinates the frame ART was authored",
  "> against — a strong *baseline* for untuned templates, **not** ground truth vs real",
  "> printed cards (e.g. MSE m15 type font is 13/375 where real prints measure ~17/375).",
  "> **Scan-measured values in template-layout.ts beat MSE — keeping the current value",
  "> is a first-class outcome.** Rect fields are % of card size; sizes are fractions of",
  "> card width. `dynamic` = content-dependent MSE expression (shown raw; human call).",
  "",
];

for (const [template, source] of Object.entries(TEMPLATE_SOURCES)) {
  const stylePath = path.join(PACK, source.dir, "style");
  if (!fs.existsSync(stylePath)) {
    mdParts.push(`## ${template}\n\n**MISSING style file:** \`${source.dir}\`\n`);
    report[template] = { error: `missing ${source.dir}` };
    continue;
  }
  const root = parseMseStyle(fs.readFileSync(stylePath, "utf8"));
  const dims = cardDimensions(root);
  const profile = getFrameProfile(template);

  const rows = [];
  const json = { source: source.dir, cardDims: dims, slots: {}, extras: {} };

  for (const map of SLOT_MAP) {
    const mse = extractElement(root, map.mse);
    if (!mse) continue;
    const rect = map.rect(profile);
    const size = map.size(profile);
    json.slots[map.slot] = { mse, current: { rect, sizePct: size } };

    const fields = [
      ["topPct", mse.topPct, rect?.topPct],
      ["leftPct", mse.leftPct, rect?.leftPct],
      ["widthPct", mse.widthPct, rect?.widthPct],
      ["heightPct", mse.heightPct, rect?.heightPct],
      ["sizePct", mse.fontSizeFrac, size],
    ];
    for (const [field, mseVal, curVal] of fields) {
      if (mseVal === null && curVal === null) continue;
      rows.push(
        `| ${map.slot}.${field} | ${fmt(curVal)} | ${fmt(mseVal)} | ${delta(mseVal, curVal)} |` +
          ` ${mse.dynamic[field.replace("Pct", "").toLowerCase()] ?? ""} |`,
      );
    }
    if (map.mse === "casting cost" || map.slot === "title") {
      const cost = extractElement(root, "casting cost");
      if (cost?.symbolFontSizeFrac != null && map.slot === "title") {
        rows.push(
          `| costSizePct | ${fmt(profile.costSizePct ?? profile.title.sizePct)} | ${fmt(cost.symbolFontSizeFrac)} | ${delta(cost.symbolFontSizeFrac, profile.costSizePct ?? profile.title.sizePct)} | symbol font of casting cost |`,
        );
        json.slots.costSizePct = { mse: cost.symbolFontSizeFrac, current: profile.costSizePct ?? null };
      }
    }
  }

  for (const extra of source.extras ?? []) {
    const mse = extractElement(root, extra);
    if (!mse) continue;
    json.extras[extra] = mse;
    rows.push(
      `| _extra:_ ${extra} | — | t${fmt(mse.topPct)} l${fmt(mse.leftPct)} w${fmt(mse.widthPct)} h${fmt(mse.heightPct)} s${fmt(mse.fontSizeFrac)} | — | ${Object.entries(mse.dynamic).map(([k, v]) => `${k}: ${v}`).join("; ")} |`,
    );
  }

  report[template] = json;
  mdParts.push(
    `## ${template}  \`${source.dir}\` (${dims.w}×${dims.h})${source.note ? ` — _${source.note}_` : ""}`,
    "",
    "| field | current | MSE | Δ (MSE−cur) | notes |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  );
}

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(OUT_MD, mdParts.join("\n"));
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 1));
console.log(`Wrote ${OUT_MD} and ${OUT_JSON} (${Object.keys(report).length} templates).`);

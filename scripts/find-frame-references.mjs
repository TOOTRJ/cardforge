// ---------------------------------------------------------------------------
// find-frame-references.mjs — candidate reference printings for every
// (template, colour) combination of the frame-compare tool.
//
// For each combo it runs a Scryfall search that describes the frame the
// template reproduces, keeps only printings the compare tool can use
// (`highres_scan`, has a non-foil version, not a promo, not digital,
// English), and reports two candidates: the printing with the SHORTEST
// rules text and the one with the LONGEST — the two ends of the fit ladder
// a single reference can't exercise. Combos whose signature no real printing
// carries (mono-colour split cards, 1993 tokens…) report `null`.
//
//   node scripts/find-frame-references.mjs [out.json]
//
// Output: a JSON report keyed template → colour → candidates, plus a
// summary on stdout. The report is REVIEWED by a human before anything
// lands in lib/cards/frame-references.json (some families — Bloomburrow
// woodland vs anime, Tarkir draconic vs dragon-wing — are only separable by
// collector-number range, so they are flagged `confirm`).
//
// Scryfall etiquette: one request every 600 ms (their search limit is
// ~2 req/s), a descriptive User-Agent, and the `q` is logged on failure.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";

const API = "https://api.scryfall.com";
const UA = "PipGlyph-frame-references/1.0 (+https://www.pipglyph.com)";
const DELAY_MS = 600;
// Reprint products whose frames carry extra marks (The List planeswalker
// stamp, Secret Lair layouts, Mystery Booster test cards) or that are not
// sold in boosters are excluded up front; quality (scan resolution, foil-
// only, promo) is a TIER below, not a filter, because 2025+ sets and some
// showcase runs have no ideal printing at all.
const BASE = "lang:en -is:digital -set:plst -set:sld -set:mb1 -set:mb2 -set:unk -st:funny -st:memorabilia -st:promo";

const COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"];

/** Colour clause for spells (by printed colour) and lands (by identity). */
function spellColor(key) {
  if (key === "c") return "c:c";
  if (key === "m") return "c>=2 -is:hybrid";
  return `c=${key}`;
}
function identityColor(key) {
  if (key === "c") return "id=c";
  if (key === "m") return "id>=2";
  return `id=${key}`;
}

const STANDARD_EXCLUSIONS =
  "-is:showcase -is:extended -is:borderless -is:fullart -is:textless -frame:legendary -is:dfc -is:split -is:adventure -t:saga";

// template → { q(key) | null per colour, confirm?: string, note?: string }
const TEMPLATES = {
  m15: {
    note: "Plain M15 spell frame (artifacts → m15artifact). Booster-sold expansion/core printings only.",
    q: (k) =>
      `frame:2015 (st:expansion or st:core) is:booster (t:creature or t:instant or t:sorcery or t:enchantment) -t:artifact -t:land -t:token -t:planeswalker -t:battle -frame:snow -frame:devoid ${STANDARD_EXCLUSIONS} ${spellColor(k)}`,
  },
  m15artifact: {
    note: "Silver artifact frame; coloured artifacts carry the colour border blend. Non-legendary only (no crown).",
    q: (k) => `frame:2015 (st:expansion or st:core) is:booster t:artifact -t:land -t:token -frame:snow ${STANDARD_EXCLUSIONS} ${spellColor(k)}`,
  },
  m15land: {
    note: "M15 land frame: basics for w/u/b/r/g/c (Wastes), a five-colour nonbasic for m (single gold plate).",
    q: (k) =>
      k === "m"
        ? `frame:2015 (st:expansion or st:core or st:commander) t:land -t:basic -t:snow id=5 ${STANDARD_EXCLUSIONS}`
        : `frame:2015 (st:expansion or st:core) t:basic -t:snow -is:showcase -is:fullart -is:textless ${identityColor(k)}`,
  },
  m15snowland: {
    q: (k) =>
      k === "m"
        ? `frame:2015 t:snow t:land -t:basic id>=2 -is:showcase -is:fullart`
        : `frame:2015 t:snow t:basic -is:showcase -is:fullart ${identityColor(k)}`,
  },
  m15token: {
    q: (k) => `t:token -t:artifact -t:emblem frame:2015 -is:fullart -is:showcase -set:tunf -set:tund ${spellColor(k)}`,
  },
  m15tokenartifact: {
    q: (k) => `t:token t:artifact frame:2015 -is:fullart -is:showcase ${spellColor(k)}`,
  },
  m15snow: {
    q: (k) => `frame:2015 frame:snow -t:land -t:token ${STANDARD_EXCLUSIONS} ${spellColor(k)}`,
  },
  m15devoid: {
    note: "Devoid cards are colourless by rule; the frame colour follows the identity.",
    q: (k) => (k === "m" ? `frame:devoid -t:land id>=2` : `frame:devoid -t:land ${identityColor(k)}`),
  },
  m15pw: {
    q: (k) => `t:planeswalker frame:2015 (st:expansion or st:core) is:booster -is:showcase -is:borderless -is:extended -is:dfc ${spellColor(k)}`,
  },
  battle: {
    note: "Every printed battle is a transform DFC; the front face is the landscape siege.",
    q: (k) => `t:battle ${spellColor(k)}`,
  },
  saga: {
    q: (k) => `t:saga frame:2015 (st:expansion or st:core) is:booster -is:showcase -is:dfc -is:borderless -is:extended ${spellColor(k)}`,
  },
  adventure: {
    q: (k) => (k === "c" ? null : `is:adventure frame:2015 (st:expansion or st:core) is:booster -is:showcase -is:borderless -is:extended ${spellColor(k)}`),
  },
  split: {
    note: "Mono-colour split cards were never printed in the M15 frame.",
    q: (k) => (k === "m" ? `is:split -kw:aftermath frame:2015 -is:showcase c>=2` : null),
  },
  aftermath: {
    q: (k) => (k === "c" ? null : `kw:aftermath ${spellColor(k)}`),
  },
  flip: {
    note: "Printed flip cards are 2003-frame (Kamigawa); our frame is the MSE modernisation — expect an era warning.",
    q: (k) => (k === "c" || k === "m" ? null : `is:flip ${spellColor(k)}`),
  },
  agclassic: {
    q: (k) => `frame:1993 -t:land -t:token ${spellColor(k)}`,
  },
  alphaland: {
    q: (k) =>
      k === "m"
        ? `frame:1993 t:land id>=2`
        : k === "c"
          ? `frame:1993 t:land -t:basic id=c`
          : `frame:1993 t:basic ${identityColor(k)}`,
  },
  alphatoken: {
    note: "No 1993-frame tokens were printed.",
    q: () => null,
  },
  retro: {
    q: (k) => `frame:1997 -t:land -t:token -is:showcase (st:expansion or st:core) ${spellColor(k)}`,
  },
  retroland: {
    q: (k) =>
      k === "m"
        ? `frame:1997 t:land id>=2 -is:showcase`
        : k === "c"
          ? `frame:1997 t:land -t:basic id=c -is:showcase`
          : `frame:1997 t:basic ${identityColor(k)}`,
  },
  modern: {
    q: (k) => `frame:2003 -t:land -t:token -t:planeswalker -is:showcase (st:expansion or st:core) ${spellColor(k)}`,
  },
  modernland: {
    q: (k) =>
      k === "m"
        ? `frame:2003 t:land id>=2 -is:showcase`
        : k === "c"
          ? `frame:2003 t:land -t:basic id=c -is:showcase`
          : `frame:2003 t:basic ${identityColor(k)}`,
  },
  extendedart: {
    q: (k) => `is:extended frame:2015 -is:showcase -t:land -t:token (st:expansion or st:core) ${spellColor(k)}`,
  },
  fullart: {
    confirm: "ZNR showcase (hedron) frame — check the thumbnail is the hedron treatment, not a full-art land.",
    q: (k) => `set:znr is:showcase -t:land ${spellColor(k)}`,
  },
  fullartland: {
    q: (k) => (k === "m" ? null : `t:basic is:fullart frame:2015 -is:showcase -is:textless ${identityColor(k)}`),
  },
  m15textless: {
    q: (k) => `is:textless frame:2015 -t:land -t:token ${spellColor(k)}`,
  },
  m15textlessland: {
    q: (k) => (k === "m" ? null : `t:basic is:textless ${identityColor(k)}`),
  },
  expeditionland: {
    note: "Expeditions are nonbasic lands: fetches are colourless identity (c), duals multicolour (m); no mono-colour printing exists.",
    q: (k) =>
      k === "c"
        ? `(set:exp or set:zne) t:land id=c`
        : k === "m"
          ? `(set:exp or set:zne) t:land id>=2`
          : null,
  },
  nyx: {
    q: (k) => `set:thb is:showcase ${spellColor(k)}`,
  },
  lotr: {
    confirm: "LTR ring frame = showcase + borderless; scroll = showcase + black border.",
    q: (k) => `set:ltr is:showcase border:borderless ${spellColor(k)}`,
  },
  lotrscroll: {
    q: (k) => `set:ltr is:showcase border:black ${spellColor(k)}`,
  },
  avatar: {
    q: (k) => `set:tla is:showcase border:borderless ${spellColor(k)}`,
  },
  bloomburrow: {
    confirm: "BLB woodland vs anime showcase share the same Scryfall flags; only the collector-number range separates them — confirm the thumbnail is the woodland frame.",
    q: (k) => `set:blb is:showcase border:borderless cn<=315 ${spellColor(k)}`,
  },
  bloomanime: {
    confirm: "See bloomburrow — confirm the thumbnail is the anime frame.",
    q: (k) => `set:blb is:showcase border:borderless cn>=316 cn<=336 ${spellColor(k)}`,
  },
  tarkirdragon: {
    confirm: "TDM borderless showcase run (#327+) — confirm the thumbnail shows the dragon-wing treatment.",
    q: (k) => `set:tdm is:showcase border:borderless -border:white ${spellColor(k)}`,
  },
  tarkirdraconic: {
    confirm: "TDM black-border showcase run (#292–326) — confirm the thumbnail shows the draconic clan treatment.",
    q: (k) => `set:tdm is:showcase border:black ${spellColor(k)}`,
  },
  tarkirghostfire: {
    q: (k) => `set:tdm border:white ${spellColor(k)}`,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q) {
  const url = `${API}/cards/search?${new URLSearchParams({ q, unique: "prints", order: "released", dir: "desc" })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  await sleep(DELAY_MS);
  if (res.status === 404) return []; // no matches
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`  ! ${res.status} for q=${q}\n    ${body.slice(0, 160)}`);
    return null;
  }
  const body = await res.json();
  // One page (≤175) is plenty; we only need extremes.
  return body.data ?? [];
}

/** Quality tier of a printing as a compare reference: 0 = ideal (highres
 *  scan, non-foil, not a promo), 1 = low-res scan only, 2 = foil-only or
 *  promo (scans of foils distort), null = unusable (placeholder/missing
 *  image, digital, non-English). */
function tier(card) {
  if (card.digital || card.lang !== "en") return null;
  if (card.image_status !== "highres_scan" && card.image_status !== "lowres") return null;
  let t = 0;
  if (card.image_status === "lowres") t = Math.max(t, 1);
  if (!(card.finishes ?? []).includes("nonfoil") || card.promo) t = Math.max(t, 2);
  return t;
}

function textLength(card) {
  const face = card.card_faces?.[0];
  const text = (face?.oracle_text ?? card.oracle_text ?? "") + (face?.flavor_text ?? card.flavor_text ?? "");
  return text.length;
}

function summarise(card) {
  return {
    name: card.name,
    set: card.set,
    cn: card.collector_number,
    scryfallId: card.id,
    frame: card.frame,
    effects: card.frame_effects ?? [],
    border: card.border_color,
    textLen: textLength(card),
  };
}

async function main() {
  const out = process.argv[2] ?? "frame-references-report.json";
  const report = {};
  let queries = 0;
  for (const [template, def] of Object.entries(TEMPLATES)) {
    report[template] = { note: def.note ?? null, confirm: def.confirm ?? null, colors: {} };
    for (const key of COLOR_KEYS) {
      const q = def.q(key);
      if (!q) {
        report[template].colors[key] = null;
        continue;
      }
      queries += 1;
      const cards = await search(`${q} ${BASE}`);
      if (cards === null) {
        report[template].colors[key] = { error: q };
        continue;
      }
      const graded = cards.map((c) => ({ c, t: tier(c) })).filter((x) => x.t !== null);
      if (graded.length === 0) {
        report[template].colors[key] = { none: true, q, raw: cards.length };
        console.log(`${template}/${key}: no usable printing (${cards.length} raw)`);
        continue;
      }
      const bestTier = Math.min(...graded.map((x) => x.t));
      const ok = graded.filter((x) => x.t === bestTier).map((x) => x.c);
      const byLen = [...ok].sort((a, b) => textLength(a) - textLength(b));
      const short = byLen[0];
      const long = byLen[byLen.length - 1];
      const picks = short.id === long.id ? [short] : [short, long];
      const tierLabel = ["ideal", "LOWRES", "FOIL/PROMO"][bestTier];
      report[template].colors[key] = { q, usable: ok.length, tier: bestTier, picks: picks.map(summarise) };
      console.log(
        `${template}/${key}: ${ok.length} ${tierLabel} — ${picks.map((c) => `${c.name} (${c.set.toUpperCase()} #${c.collector_number}, ${textLength(c)} ch)`).join(" | ")}`,
      );
    }
  }
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${queries} queries → ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

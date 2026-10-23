import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";
import {
  CARD_TYPE_VALUES,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";
import {
  CARD_KIND_VALUES,
  FRAME_COLOR_KEYS,
  baseFrameFor,
  framesForKind,
  planKindChange,
  skinVariantsFor,
  templateRefusesKind,
  templateSupportsKind,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import {
  basicOnlyFrameFallback,
  describeFrame,
  eraGroupFrameLabel,
  finalizeImportMatch,
  importFrameCandidates,
  remixFrameFor,
  resolveImportFrame,
  resolvePublishedFrame,
  setQualifiedFrameLabel,
} from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { importFramePlan, importedKindOf } from "@/lib/creator/import-frame-choice";
import { walkthroughKindFor } from "@/lib/creator/frame-preview";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { ownCardRemixFrame } from "@/lib/ai/remix-mechanics";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  printingTreatmentNotice,
  type PrintingTreatment,
} from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// The frame picker's GROUPS (2026-10-13): extended art, the full-art basics
// and the textless frames left "Showcase & Universes Beyond" for the M15 era
// — general treatments of the 2015 frame that any set prints (Scryfall:
// `extendedart` 4,235 printings in 86 sets; black-bordered full-art basics
// 588 in 52; 2015-frame textless promos 78 in 24), offered as variations of
// the M15 standard like Borderless (frames plan 4.32).
//
// A CLASSIFICATION change: which group a frame sits in, and its label. What
// a card may wear, where an import, a remix or an AI card lands and what a
// save stores must not move. This file computes every frame decision the
// creator makes — the gallery per kind, the kind gate, the base of each
// frame, a kind change, the published-frame resolver, the import's
// candidates, landing and chooser, the remix's landing, the AI's pools — over
// every template × kind × colour, with production's verified list
// (supabase/seed.sql) and with everything verified, and holds it to
// `fixtures/frame-picker-groups-main.json`: what THIS FILE recorded on
// `origin/main` (00bc2ca7, after #544 — the commit this branch was last folded onto; first on c1c7b2e7 / a6d1a486). Everything is equal
// but the differences listed under "what changed", each asserted exactly.
// To re-record on a checkout of that commit:
//   FRAME_GROUPS_CAPTURE=<path/to/out.json> npx vitest run <this file>
// ---------------------------------------------------------------------------

/** The frames that moved, in gallery order. */
const MOVED: readonly FrameTemplate[] = [
  "extendedart",
  "m15fullartland",
  "fullartland",
  "m15textless",
  "m15textlessland",
];
const isMoved = (template: string) => (MOVED as readonly string[]).includes(template);

/** Templates ADDED after the recording (TODO 4.40 / 4.41: the older
 *  full-art basics, new and unverified). This file pins #556's
 *  classification, so it computes over the recording's templates: an added
 *  frame is left out of every policy ("all verified" included) and out of
 *  the variations lists — its own decisions are its own PR's tests'
 *  (tests/unit/creator/older-fullart-basics.test.ts). */
const ADDED_SINCE: readonly FrameTemplate[] = ["m15fullartlandzen", "m15fullartlandsnc", "m15fullartlandthb"];
const isAdded = (template: string) => (ADDED_SINCE as readonly string[]).includes(template);
const TEMPLATES = FRAME_TEMPLATE_VALUES.filter((t) => !isAdded(t));
/** Extended art's LAND dress (TODO 4.7, owner Round 63, 2026-10-14), made
 *  after the recording: `extendedart` split by kind — a land on extended art
 *  wears `extendedartland`, the pack's land frames. That changes WHICH
 *  template a land wears, not the picker's groups, so every comparison below
 *  reads the dump with the land dress folded back onto `extendedart`
 *  (asOneExtendedFrame). The split itself — the kind gate, the gallery, the
 *  import over every extended-art printing, the AI request, the own-card
 *  remix — is pinned in tests/unit/creator/extended-art-land.test.ts. */
const LAND_DRESS: FrameTemplate = "extendedartland";

/** The dump with the land dress folded onto `extendedart`: every VALUE that
 *  names it names `extendedart`; the kind gate's land answers for
 *  `extendedart` are the dress's; a resolver row for a land on the dress is
 *  the row a land on `extendedart` had (renamed); every other decision about
 *  the dress as a template of its own (its kind gate for other kinds, its
 *  base, label, kind change…) is new, and dropped. */
function asOneExtendedFrame(dump: Dump): Dump {
  const fold = (text: string) => text.split(`"${LAND_DRESS}"`).join('"extendedart"').split(`${LAND_DRESS}|`).join("extendedart|");
  const out: Dump = {};
  for (const [section, rows] of Object.entries(dump)) {
    out[section] = {};
    for (const [key, value] of Object.entries(rows)) {
      const parts = key.split("|");
      const folded = JSON.parse(fold(JSON.stringify(value ?? null))) as unknown;
      if (!parts.includes(LAND_DRESS)) {
        out[section][key] = value === undefined ? undefined : folded;
        continue;
      }
      if (section === "resolve") out[section][parts.map((p) => (p === LAND_DRESS ? "extendedart" : p)).join("|")] = folded;
    }
  }
  for (const section of ["refuses", "supports", "kindGate"]) {
    for (const face of ["land", "basic"]) {
      const own = dump[section][`${LAND_DRESS}|${face}`];
      if (own !== undefined) out[section][`extendedart|${face}`] = own;
    }
  }
  return out;
}

/** The Spacecraft's extended-art and borderless dresses (TODO 4.27a step 2),
 *  made after the recording: two NEW templates — pick-only subtype dresses
 *  a Spacecraft alone may wear. They change no group and no other frame's
 *  decision, so every comparison below reads the dump without them: every
 *  row about them dropped, every list that names them without their name.
 *  Their gate, follow, pool and import are pinned in
 *  tests/unit/creator/station-dresses.test.ts and
 *  tests/unit/scryfall/station-imports.test.ts. */
// …and the borderless double-faced bodies (TODO 5.7), new templates of
// their own the same way — pinned in tests/unit/creator/dfc-borderless.test.ts
// and tests/unit/scryfall/dfc-borderless-imports.test.ts.
const STATION_DRESSES: readonly string[] = [
  "extendedartstation",
  "m15borderlessstation",
  "m15borderlessdfcfront",
  "m15borderlessdfcback",
  "m15borderlessmdfcfront",
  "m15borderlessmdfcback",
  // …and the full-art token's Nyx dress (TODO 4.51), pinned in
  // tests/unit/creator/token-nyx-dress.test.ts and
  // tests/unit/scryfall/token-imports.test.ts.
  "m20tokennyx",
  "m20tokennyxtext",
  "m20tokennyxtall",
  "m20tokenartifactnyx",
  "m20tokenartifactnyxtext",
  "m20tokenartifactnyxtall",
  // …and the double-faced saga front (TODO 5.5 (b)) — pinned in
  // tests/unit/creator/saga-dfc-front.test.ts and the dfc import tests.
  "sagadfcfront",
  // …and its back (5.5 (b), PR 2) — pinned in
  // tests/unit/creator/saga-dfc-back.test.ts.
  "sagadfcback",
  // …and the arch token's tall box (TODO 4.55) — pinned in
  // tests/unit/creator/token-tall.test.ts and tests/unit/scryfall/token-imports.test.ts.
  "m15tokentall",
  "m15tokenartifacttall",
  // …and the Prepare frame AND kind (TODO 4.27): a new template and a new
  // kind, each the other's alone — every row naming either dropped, as
  // above; pinned in tests/unit/creator/prepare-kind.test.ts and
  // tests/unit/scryfall/prepare-imports.test.ts.
  "prepare",
  // …and the 2015 Expeditions (TODO 4.11 wave 1): a new template in the
  // Expeditions set — pinned in tests/unit/scryfall/expedition-imports.test.ts
  // (EXP's printings land there; read below as the one Expedition frame).
  "expeditionlandbfz",
];
function withoutStationDresses(dump: Dump): Dump {
  const named = (text: string) => STATION_DRESSES.some((t) => text === t || text.startsWith(`${t}|`));
  // (…recursing into an import row's plan: the chooser's more options list a
  // DFC kind's every front body, the borderless ones since TODO 5.7.)
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((v) => !(typeof v === "string" && named(v))).map(strip)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)]))
        : value;
  const out: Dump = {};
  for (const [section, rows] of Object.entries(dump)) {
    out[section] = {};
    for (const [key, value] of Object.entries(rows)) {
      if (key.split("|").some((part) => STATION_DRESSES.includes(part))) continue;
      out[section][key] = value === undefined ? undefined : strip(value);
    }
  }
  return out;
}

function productionVerifiedKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    out.add(frameComboKey(template as FrameTemplate, colour));
  }
  return out;
}
const ALL = new Set(TEMPLATES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
/**
 * The combos production ticked AFTER the recording was made (the seed mirror
 * of 2026-10-14: the Nyx dress, the Universes Beyond trio and the station
 * pair). The recording computed "prod" against the 2026-10-13 list, so this
 * suite keeps reading that list: a data refresh is not a classification
 * change. Re-recording the fixture is the time to drop this.
 */
const TICKED_AFTER_RECORDING = new Set([
  ...["m15nyx", "m15ub", "m15ubartifact", "m15ubland", "m15station"].flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))),
  ...["w", "u", "b", "r", "g"].map((k) => frameComboKey("m15stationland", k)),
]);
const PROD = new Set([...productionVerifiedKeys()].filter((key) => !TICKED_AFTER_RECORDING.has(key)));
/** Production's list plus every colour of the frames that moved (today
 *  production has only the two full-art basics ticked, in w u b r g c): the
 *  day they are all ticked. */
// …and extended art's LAND dress (TODO 4.7, owner Round 63, after the
// recording): the land half of a moved frame, ticked the same day.
const PROD_PLUS_MOVED = new Set([...PROD, ...[...MOVED, LAND_DRESS].flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)))]);
const VERIFIED: Record<string, ReadonlySet<string>> = { prod: PROD, prodPlusMoved: PROD_PLUS_MOVED, all: ALL };

const IDENTITY: Record<FrameColorKey, ColorIdentity[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};

const fixtures = { ...signaturePrintings, ...treatmentPrintings, ...tokenPrintings } as Record<string, unknown>;

type Dump = Record<string, Record<string, unknown>>;

function compute(): Dump {
  const out: Dump = {
    gallery: {},
    refuses: {},
    supports: {},
    base: {},
    skins: {},
    kindChange: {},
    resolve: {},
    candidates: {},
    pools: {},
    requested: {},
    imports: {},
    labels: {},
    walkthrough: {},
    notice: {},
    ownRemix: {},
    kindGate: {},
    basicFallback: {},
    aiChoices: {},
  };

  for (const [name, keys] of Object.entries(VERIFIED)) {
    for (const kind of CARD_KIND_VALUES) {
      out.gallery[`${name}|${kind}`] = framesForKind(kind, keys).filter((c) => !isAdded(c.template)).map(
        (c) => `${c.template}|${c.era}|${c.group}|${c.availableColorKeys.join("")}`,
      );
    }
    for (const cardType of CARD_TYPE_VALUES) {
      out.aiChoices[`${name}|${cardType}`] = frameChoicesForType(cardType, keys)
        .map((c) => c.template)
        .filter((t) => !isAdded(t));
    }
  }

  for (const template of TEMPLATES) {
    for (const kind of CARD_KIND_VALUES) {
      out.refuses[`${template}|${kind}`] = templateRefusesKind(template, kind);
      out.supports[`${template}|${kind}`] = templateSupportsKind(template, kind);
      out.base[`${template}|${kind}`] = baseFrameFor(kind, template);
      // A kind change from a card on `template`.
      const plan = planKindChange(kind, { cardType: "creature", template });
      out.kindChange[`${template}|${kind}`] =
        `${plan.action}|${plan.patch.template}|${plan.patch.card_type}|${plan.patch.has_back_face ?? ""}`;
    }
    out.labels[template] = {
      era: eraForTemplate(template),
      label: FRAME_TEMPLATE_LABELS[template],
      describe: describeFrame(template),
      eraGroup: eraGroupFrameLabel(template),
      setQualified: setQualifiedFrameLabel(template),
    };
    out.walkthrough[template] = walkthroughKindFor(template);
    for (const treatment of ["borderless", "showcase", "extendedart", "fullart", "textless"] as PrintingTreatment[]) {
      out.notice[`${template}|${treatment}`] = / the bordered /.test(printingTreatmentNotice(treatment, template));
    }
  }
  for (const kind of CARD_KIND_VALUES) {
    for (const base of TEMPLATES) {
      const skins = skinVariantsFor(kind, base).filter((t) => !isAdded(t));
      if (skins.length > 0) out.skins[`${kind}|${base}`] = skins;
    }
  }

  // The published-frame resolver: every frame a kind may wear, each colour,
  // both policies, alone and with the kind's M15 standard behind it.
  for (const [name, keys] of Object.entries(VERIFIED)) {
    for (const kind of CARD_KIND_VALUES) {
      const standard = framesForKind(kind, ALL).find((c) => c.era === "m15")?.template;
      for (const wanted of TEMPLATES) {
        if (!templateSupportsKind(wanted, kind)) continue;
        for (const colorKey of FRAME_COLOR_KEYS) {
          for (const prefer of ["frame", "colour"] as const) {
            const one = resolvePublishedFrame({ kind, candidates: [wanted], colorKey, verifiedKeys: keys, prefer });
            const two = resolvePublishedFrame({
              kind,
              candidates: standard ? [wanted, standard] : [wanted],
              colorKey,
              verifiedKeys: keys,
              prefer,
            });
            const text = (r: typeof one) =>
              r.status === "unavailable" ? "unavailable" : `${r.status}|${r.template}|${r.colorKey}`;
            out.resolve[`${name}|${kind}|${wanted}|${colorKey}|${prefer}`] = `${text(one)} / ${text(two)}`;
          }
        }
      }
    }
    for (const template of MOVED) {
      for (const colorKey of FRAME_COLOR_KEYS) {
        out.basicFallback[`${name}|${template}|${colorKey}`] = basicOnlyFrameFallback(template, colorKey, keys);
      }
    }
  }

  // The import's candidates.
  for (const wanted of TEMPLATES) {
    for (const cardType of CARD_TYPE_VALUES) {
      for (const supertype of ["", "Artifact", "Enchantment"]) {
        for (const rulesText of ["", "Flying"]) {
          out.candidates[`${wanted}|${cardType}|${supertype}|${rulesText}`] = importFrameCandidates({
            wanted,
            cardType,
            supertype,
            rulesText,
          });
        }
      }
    }
  }

  // The AI's frame: the random pool (every member, in pool order) and a
  // request for each frame by name, per type × colour × the faces that gate
  // a frame.
  type Face = NonNullable<Parameters<typeof resolveGeneratedFrame>[0]["face"]>;
  const faces: Record<string, (cardType: CardType) => Face | undefined> = {
    none: () => undefined,
    plain: (cardType) => ({ cardType, title: "Test Card", rulesText: "Flying", subtypes: [] }),
    basic: (cardType) =>
      cardType === "land"
        ? { cardType, title: "Forest", supertype: "Basic", subtypes: ["Forest"], rulesText: "" }
        : undefined,
    artifactWord: (cardType) => ({ cardType, title: "Test Card", supertype: "Artifact", rulesText: "Flying", subtypes: [] }),
    enchantmentWord: (cardType) => ({ cardType, title: "Test Card", supertype: "Enchantment", rulesText: "Flying", subtypes: [] }),
    vehicle: (cardType) =>
      cardType === "artifact"
        ? { cardType, title: "Test Card", subtypes: ["Vehicle"], rulesText: "Crew 2", power: "3", toughness: "3" }
        : undefined,
    textless: (cardType) => ({ cardType, title: "Test Card", rulesText: "", flavorText: "", subtypes: [] }),
    fourRows: (cardType) =>
      cardType === "planeswalker"
        ? { cardType, title: "Test Card", rulesText: "+1: A.\n0: B.\n−2: C.\n−7: D.", subtypes: [] }
        : undefined,
  };
  for (const [name, keys] of Object.entries(VERIFIED)) {
    for (const cardType of CARD_TYPE_VALUES) {
      for (const colorKey of FRAME_COLOR_KEYS) {
        for (const [faceName, faceOf] of Object.entries(faces)) {
          const face = faceOf(cardType);
          if (faceName !== "none" && face === undefined) continue;
          const pool: string[] = [];
          for (let i = 0; i < 400; i += 1) {
            const picked = resolveGeneratedFrame({
              cardType,
              requested: "random",
              colorIdentity: IDENTITY[colorKey],
              verifiedKeys: keys,
              face,
              random: () => i / 400,
            });
            const value = picked ?? "null";
            if (pool[pool.length - 1] !== value) pool.push(value);
          }
          out.pools[`${name}|${cardType}|${colorKey}|${faceName}`] = pool;
          for (const requested of [...MOVED, "m15borderless", "nyx", "lotr", "expeditionland"] as FrameTemplate[]) {
            out.requested[`${name}|${cardType}|${colorKey}|${faceName}|${requested}`] = resolveGeneratedFrame({
              cardType,
              requested,
              colorIdentity: IDENTITY[colorKey],
              verifiedKeys: keys,
              face,
              random: () => 0,
            });
          }
        }
      }
    }
  }

  // Imports: every captured printing through the real mapper and the
  // route's verification step — the match, the landing, the chooser, the
  // remix's landing.
  for (const [name, keys] of Object.entries(VERIFIED)) {
    for (const key of Object.keys(fixtures)) {
      const parsed = scryfallCardSchema.safeParse(fixtures[key]);
      if (!parsed.success) continue;
      const patch = finalizeImportMatch(mapScryfallToFormPatch(parsed.data), keys);
      const kind = importedKindOf(patch);
      const landing = kind
        ? resolveImportFrame({
            patch,
            kind,
            current: { template: "m15", cardType: patch.card_type ?? null, colors: patch.color_identity ?? [] },
            verifiedKeys: keys,
          }).resolution
        : null;
      const plan = importFramePlan(patch, keys, "m15");
      const remix = remixFrameFor(patch, keys);
      out.imports[`${name}|${key}`] = {
        kind,
        frame_template: patch.frame_template ?? null,
        match: patch.frame_match
          ? [patch.frame_match.status, patch.frame_match.template, patch.frame_match.landOn ?? null]
          : null,
        landing:
          landing === null
            ? null
            : landing.status === "unavailable"
              ? "unavailable"
              : `${landing.status}|${landing.template}|${landing.colorKey}`,
        plan:
          plan.mode === "choose"
            ? {
                options: plan.options.map((o) => `${o.template}${o.nearest ? "*" : ""}`),
                moreOptions: plan.moreOptions.map((o) => o.template),
                keepCurrent: plan.keepCurrent.available,
                preselected: plan.preselected,
              }
            : plan.mode,
        remix: remix.ok ? `${remix.template}|${remix.card_type ?? ""}` : "unavailable",
      };
    }
  }

  // The server's kind gate and the remix of an own card, for a card stored
  // on each moved frame (and the frames that stayed).
  const stored: FrameTemplate[] = [...MOVED, LAND_DRESS, "nyx", "expeditionland", "fullart", "lotr", "m15borderless"];
  const storedFaces: Record<string, { card_type: CardType; supertype: string; subtypes: string[]; title: string; rules_text: string }> = {
    creature: { card_type: "creature", supertype: "", subtypes: ["Elf"], title: "Test Card", rules_text: "Flying" },
    enchantment: { card_type: "enchantment", supertype: "", subtypes: [], title: "Test Card", rules_text: "Flying" },
    artifact: { card_type: "artifact", supertype: "", subtypes: [], title: "Test Card", rules_text: "Flying" },
    instant: { card_type: "instant", supertype: "", subtypes: [], title: "Test Card", rules_text: "Draw a card." },
    land: { card_type: "land", supertype: "", subtypes: [], title: "Test Tower", rules_text: "{T}: Add {C}." },
    basic: { card_type: "land", supertype: "Basic", subtypes: ["Forest"], title: "Forest", rules_text: "" },
    token: { card_type: "token", supertype: "Creature", subtypes: ["Elf"], title: "Elf", rules_text: "" },
    planeswalker: { card_type: "planeswalker", supertype: "Legendary", subtypes: ["Test"], title: "Test", rules_text: "+1: A." },
  };
  for (const template of stored) {
    for (const [faceName, face] of Object.entries(storedFaces)) {
      out.kindGate[`${template}|${faceName}`] =
        frameKindGateError(template, {
          cardType: face.card_type,
          supertype: face.supertype,
          subtypes: face.subtypes,
          title: face.title,
          rulesText: face.rules_text,
        }) === null;
      for (const [name, keys] of Object.entries(VERIFIED)) {
        for (const colorKey of ["g", "c", "m"] as const) {
          out.ownRemix[`${name}|${template}|${faceName}|${colorKey}`] =
            ownCardRemixFrame(
              { ...face, frame_style: { template }, color_identity: IDENTITY[colorKey], back_face: null },
              keys,
            ).frame_template ?? null;
        }
      }
    }
  }
  return JSON.parse(JSON.stringify(out)) as Dump;
}

/** The sections that must be IDENTICAL and are large (every kind × frame ×
 *  colour × policy): the fixture holds one hash per group of cases (the
 *  first two parts of a case's key) instead of 1.4 MB of rows. A mismatch
 *  names the group; the rows come from a full recording
 *  (FRAME_GROUPS_CAPTURE_FULL=<path>) of both commits. The AI's pools are
 *  hashed SORTED: a pool is drawn from uniformly, its order is the
 *  gallery's. An import's "Show all frames" list is in gallery order too. */
const HASHED = ["resolve", "candidates", "requested", "pools", "imports", "ownRemix"] as const;
function condense(dump: Dump): Dump {
  const out: Dump = { ...dump };
  for (const section of HASHED) {
    const groups = new Map<string, string[]>();
    for (const key of Object.keys(dump[section]).sort()) {
      let value = dump[section][key];
      if (section === "pools") value = [...(value as string[])].sort();
      if (section === "imports") {
        const row = value as { plan: unknown };
        if (typeof row.plan === "object" && row.plan !== null) {
          const plan = row.plan as { moreOptions: string[] };
          value = { ...row, plan: { ...plan, moreOptions: [...plan.moreOptions].sort() } };
        }
      }
      const group = key.split("|").slice(0, 2).join("|");
      groups.set(group, [...(groups.get(group) ?? []), `${key}=${JSON.stringify(value)}`]);
    }
    out[section] = Object.fromEntries(
      [...groups].map(([group, rows]) => [
        group,
        `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16)}`,
      ]),
    );
  }
  return out;
}

const FIXTURE = path.join(__dirname, "fixtures", "frame-picker-groups-main.json");
const capturePath = process.env.FRAME_GROUPS_CAPTURE;
const fullCapturePath = process.env.FRAME_GROUPS_CAPTURE_FULL;

describe("the frame picker's groups: a classification change only", () => {
  if (capturePath || fullCapturePath) {
    it("records every decision (run on the commit before the move)", () => {
      const dump = compute();
      if (capturePath) fs.writeFileSync(capturePath, `${JSON.stringify(condense(dump), null, 1)}\n`);
      if (fullCapturePath) fs.writeFileSync(fullCapturePath, `${JSON.stringify(dump)}\n`);
    }, 300_000);
    return;
  }
  const main = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Dump;
  const raw = withoutStationDresses(asOneExtendedFrame(compute()));
  const branch = condense(raw);

  /** The keys of a section whose value differs from main's. */
  const changed = (section: string): string[] =>
    [...new Set([...Object.keys(main[section]), ...Object.keys(branch[section])])]
      .filter((key) => JSON.stringify(main[section][key]) !== JSON.stringify(branch[section][key]))
      .sort();

  it("computes the same cases as the recording", () => {
    expect(Object.keys(branch).sort()).toEqual(Object.keys(main).sort());
    for (const section of Object.keys(main)) {
      expect(Object.keys(branch[section]).sort(), section).toEqual(Object.keys(main[section]).sort());
    }
  });

  // --- what did NOT change -------------------------------------------------
  it.each([
    ["refuses", "which kinds a frame refuses (the picker's and the server's kind gate)"],
    ["supports", "which kinds a frame is offered to"],
    ["base", "the Frame-section base of every frame, per kind"],
    ["resolve", "the published-frame resolver, every kind × frame × colour × policy"],
    ["candidates", "the import's candidate frames"],
    ["walkthrough", "the kind a frame's walk-through opens as"],
    ["notice", "the 'bordered' word of an import's treatment notice"],
    ["ownRemix", "the frame a remix of an own card keeps"],
    ["kindGate", "the server's kind gate for a stored card"],
    ["basicFallback", "where a basic-only frame's card goes when it stops being a basic"],
  ])("%s — %s: identical to origin/main", (section) => {
    expect(changed(section)).toEqual([]);
  });

  // Every captured printing's import: identical but for TODO 4.48's last
  // pieces — the M20 token's crown and its two-colour split are drawn by the
  // full-art templates now, so TMKM #13 (a crowned G|W token) and TMKM #10
  // (a W|U token) are EXACT on them wherever they are verified (production's
  // ticks and every verified policy), where main left them nearest with the
  // crown / two-colour gap. Their frame, kind and landing are main's.
  // …and the arch's tall-box printings (TODO 4.55: TAKH #1, TSOI #11), exact
  // on the tall box where it is verified — "all" alone: production has not
  // ticked it; until then they land where main lands them.
  it("imports — every captured printing's match, landing, chooser and remix landing: the same, but the crowned and two-colour M20 tokens exact (4.48), the Nyx tokens (4.51) and the tall-box arch tokens (4.55) exact once verified", () => {
    // …and TODO 4.11: the Lord of the Rings scroll's border is true (its Card
    // Conjurer masters), so LTR #482 is EXACT on it once verified (only
    // "all" verifies it); production lands it where main does.
    expect(raw.imports["all|ltr-482"]).toMatchObject({ frame_template: "lotrscroll", match: ["exact", "lotrscroll", null] });
    // …and the ring's (LTR #306, TODO 4.11 too), the same way.
    expect(raw.imports["all|ltr-306"]).toMatchObject({ frame_template: "lotr", match: ["exact", "lotr", null] });
    // …and the MUL Tarkir dragon wings' (MUL #1 / #60, TODO 4.11 too).
    expect(raw.imports["all|mul-1"]).toMatchObject({ frame_template: "tarkirdragon", match: ["exact", "tarkirdragon", null] });
    expect(raw.imports["all|mul-60"]).toMatchObject({ frame_template: "tarkirdragon", match: ["exact", "tarkirdragon", null] });
    expect(changed("imports")).toEqual([
      "all|ltr-306",
      "all|ltr-482",
      "all|mul-1",
      "all|mul-60",
      "all|takh-1", "all|tdsk-10", "all|tdsk-4", "all|teoc-13",
      "all|tmkm-10", "all|tmkm-13", "all|tmom-16", "all|tsoi-11",
      "all|zne-1",
      "prodPlusMoved|tmkm-10", "prodPlusMoved|tmkm-13", "prodPlusMoved|tmom-16",
      "prod|tmkm-10", "prod|tmkm-13", "prod|tmom-16",
    ]);
    // …and TODO 4.11 wave 1: a two-colour Expedition (ZNE #1 Flooded
    // Strand, white and blue) prints a split pinline the frame doesn't draw
    // yet — on its own frame still, NEAREST through the two-colour gap even
    // with every combo verified ("all"), and there dressed in, gated in and
    // offered in the frame's PLAIN land master `c`, not the gold one (owner
    // 2026-10-22; importFrameColorKey). Where the Expedition frame isn't
    // ticked (production) it lands where main lands it — m15land in its
    // gold, the chooser offering the same frames — so only "all" differs.
    for (const policy of ["all", "prodPlusMoved", "prod"]) {
      expect(raw.imports[`${policy}|zne-1`], policy).toMatchObject({ frame_template: "expeditionland", match: ["nearest", "expeditionland", null] });
    }
    expect(raw.imports["all|zne-1"]).toMatchObject({
      landing: "exact|expeditionland|c",
      plan: { preselected: { template: "expeditionland" } },
      remix: "expeditionland|land",
    });
    for (const policy of ["prodPlusMoved", "prod"]) {
      expect(raw.imports[`${policy}|zne-1`], policy).toMatchObject({ landing: "frame-switched|m15land|m", remix: "m15land|land" });
    }
    // …and TODO 5.5 (c): MOM's transforming Incubator // Phyrexian lands on
    // the same full-art frame, NEAREST (the `dfc-token-transform` gap: the
    // plain pair has no transform icons) — the rest of it main's.
    for (const policy of ["all", "prodPlusMoved", "prod"]) {
      expect(raw.imports[`${policy}|tmom-16`], policy).toMatchObject({ kind: "token", frame_template: "m20tokenartifacttext", match: ["nearest", "m20tokenartifacttext", null] });
    }
    for (const policy of ["all", "prodPlusMoved", "prod"]) {
      expect(raw.imports[`${policy}|tmkm-10`], policy).toMatchObject({ kind: "token", frame_template: "m20token", match: ["exact", "m20token", null] });
      expect(raw.imports[`${policy}|tmkm-13`], policy).toMatchObject({ kind: "token", frame_template: "m20tokentext", match: ["exact", "m20tokentext", null] });
    }
    // …and TODO 4.51: the Nyx tokens land EXACT on the Nyx dress once it is
    // verified (only "all" verifies it); until then main's landing, the
    // plain full-art template, nearest with the starfield gap.
    expect(raw.imports["all|tdsk-4"]).toMatchObject({ kind: "token", frame_template: "m20tokennyx", match: ["exact", null] });
    expect(raw.imports["all|tdsk-10"]).toMatchObject({ kind: "token", frame_template: "m20tokennyx", match: ["exact", null] });
    expect(raw.imports["all|teoc-13"]).toMatchObject({ kind: "token", frame_template: "m20tokenartifactnyx", match: ["exact", null] });
    expect(raw.imports["all|takh-1"]).toMatchObject({ kind: "token", frame_template: "m15tokentall", match: ["exact", null] }); // (the dump drops the tall templates from its lists)
    expect(raw.imports["all|tsoi-11"]).toMatchObject({ kind: "token", frame_template: "m15tokenartifacttall", match: ["exact", null] });
  });

  // The AI's random pools: identical but for layout v58 (TODO 4.35 / 4.42),
  // which made the textless pair TEXTLESS profiles — `resolveGeneratedFrame`
  // never draws one for a card with text while another frame it fits is
  // published (TODO 1.24). Recorded in full on origin/main (da0b9d1b) and
  // here: the 350 pools that differ differ ONLY by m15textless /
  // m15textlessland leaving a face that carries text (plain, artifactWord,
  // enchantmentWord, vehicle, fourRows); the textless and basic faces are unchanged.
  it("pools — the frames in the AI's random pool: the same, but the textless pair never offered to a card with text (v58)", () => {
    // Only where the pair is verified (production verifies neither), and only
    // the kinds the pair dresses.
    const kinds = ["artifact", "creature", "enchantment", "instant", "land", "sorcery", "spell", "token"];
    expect(changed("pools")).toEqual(["all", "prodPlusMoved"].flatMap((policy) => kinds.map((kind) => `${policy}|${kind}`)));
    for (const [key, pool] of Object.entries(raw.pools) as [string, string[]][]) {
      const face = key.split("|")[3];
      if (face === "textless" || face === "none" || face === "basic") continue;
      expect(pool.filter((t) => t === "m15textless" || t === "m15textlessland"), key).toEqual([]);
    }
  });

  // An AI card asked for a frame by name: identical but for the textless
  // pair (layout v58): a request for m15textless / m15textlessland is
  // honoured only for a face with no rules or flavour text — a face with
  // some is given the pool's pick, as a random request is (TODO 1.24).
  // Recorded in full on origin/main (a6415e5e) and here: the 392 decisions
  // that differ are all a request for the pair on a face that carries text
  // (plain, artifactWord, enchantmentWord, vehicle), each now off the pair.
  it("requested — an AI card asked for a frame by name: the same, but the textless pair never given to a card with text (v58)", () => {
    const kinds = ["artifact", "creature", "enchantment", "instant", "land", "sorcery", "spell", "token"];
    expect(changed("requested")).toEqual(["all", "prodPlusMoved"].flatMap((policy) => kinds.map((kind) => `${policy}|${kind}`)));
    for (const [key, frame] of Object.entries(raw.requested) as [string, string | null][]) {
      const parts = key.split("|");
      const face = parts[3];
      const requested = parts[parts.length - 1];
      if (requested !== "m15textless" && requested !== "m15textlessland") continue;
      if (face === "textless" || face === "none" || face === "basic") continue;
      expect(frame === "m15textless" || frame === "m15textlessland", key).toBe(false);
    }
  });

  it("a kind's gallery holds the same frames in the same colours, the frames that stayed in the same order", () => {
    const parse = (row: string) => {
      const [template, era, group, colours] = row.split("|");
      return { template, era, group, colours };
    };
    for (const key of Object.keys(main.gallery)) {
      const before = (main.gallery[key] as string[]).map(parse);
      const after = (branch.gallery[key] as string[]).map(parse);
      const colours = (rows: typeof before) => rows.map((r) => `${r.template}|${r.colours}`).sort();
      expect(colours(after), key).toEqual(colours(before));
      const stayed = (rows: typeof before) =>
        rows.filter((r) => !isMoved(r.template)).map((r) => `${r.template}|${r.era}|${r.group}`);
      expect(stayed(after), key).toEqual(stayed(before));
    }
  });

  it("the AI options dialog is offered the same frames per card type", () => {
    for (const key of Object.keys(main.aiChoices)) {
      expect([...(branch.aiChoices[key] as string[])].sort(), key).toEqual([...(main.aiChoices[key] as string[])].sort());
    }
  });

  it("the frames that were NOT moved keep their group: the constellation showcase and the Expeditions stay showcases", () => {
    // Owner decisions pending (PR body): Theros Beyond Death's constellation
    // frame (THB #258–268: Scryfall `showcase`, black border) is one set's
    // showcase, not a borderless Nyx frame; the Zendikar Expeditions are one
    // block's masterpiece series.
    expect(eraForTemplate("nyx")).toBe("showcase");
    expect(eraForTemplate("expeditionland")).toBe("showcase");
    expect(eraForTemplate("m15nyx")).toBe("m15");
  });

  // --- what changed, exactly -----------------------------------------------
  it("the five frames sit in the M15 era as variations, after the kind's other M15 variations and before the showcases", () => {
    for (const key of Object.keys(branch.gallery)) {
      const rows = (branch.gallery[key] as string[]).map((row) => row.split("|"));
      const before = (main.gallery[key] as string[]).map((row) => row.split("|"));
      for (const [template, era, group] of rows) {
        if (!isMoved(template)) continue;
        expect([era, group], `${key} ${template}`).toEqual(["m15", "skin"]);
        expect(before.find((r) => r[0] === template)?.slice(1, 3), `${key} ${template}`).toEqual(["showcase", "showcase"]);
      }
      const firstShowcase = rows.findIndex((r) => r[2] === "showcase");
      const lastMoved = rows.map((r) => isMoved(r[0])).lastIndexOf(true);
      if (firstShowcase !== -1 && lastMoved !== -1) expect(lastMoved, key).toBeLessThan(firstShowcase);
      // …in the order they had among themselves.
      expect(rows.filter((r) => isMoved(r[0])).map((r) => r[0]), key).toEqual(
        before.filter((r) => isMoved(r[0])).map((r) => r[0]),
      );
    }
  });

  it("no frame is left in or added to the showcase group but by the move", () => {
    const showcase = (dump: Dump) =>
      TEMPLATES.filter((t) => (dump.labels[t] as { era: string } | undefined)?.era === "showcase");
    // (The land dress, folded away, is an M15 variation like extendedart.)
    expect(eraForTemplate(LAND_DRESS)).toBe("m15");
    expect(showcase(main).filter((t) => !showcase(branch).includes(t))).toEqual([...MOVED]);
    expect(showcase(branch).filter((t) => !showcase(main).includes(t))).toEqual([]);
    // Their frame SETS (the admin's treatment batches, the import's
    // families) are untouched.
    expect(MOVED.map((t) => FRAME_TEMPLATE_SET[t])).toEqual(["extended", "fullartset", "fullartset", "fullartset", "fullartset"]);
  });

  it("only the moved frames' labels changed", () => {
    expect(changed("labels")).toEqual([...MOVED].sort());
    expect(Object.fromEntries(MOVED.map((t) => [t, branch.labels[t]]))).toEqual({
      extendedart: {
        era: "m15",
        label: "Extended Art",
        describe: "M15 (2015) Extended Art",
        eraGroup: "Extended Art",
        setQualified: "Extended Art",
      },
      m15fullartland: {
        era: "m15",
        label: "Full-Art Basic Land",
        describe: "M15 (2015) Full-Art Basic Land",
        eraGroup: "Full-Art Basic Land",
        setQualified: "Full-Art Basic Land",
      },
      fullartland: {
        era: "m15",
        label: "Borderless Full-Art Basic Land",
        describe: "M15 (2015) Borderless Full-Art Basic Land",
        eraGroup: "Borderless Full-Art Basic Land",
        setQualified: "Borderless Full-Art Basic Land",
      },
      m15textless: {
        era: "m15",
        label: "Textless",
        describe: "M15 (2015) Textless",
        eraGroup: "Textless",
        setQualified: "Textless",
      },
      m15textlessland: {
        era: "m15",
        label: "Textless Land",
        describe: "M15 (2015) Textless Land",
        eraGroup: "Textless Land",
        setQualified: "Textless Land",
      },
    });
  });

  it("a kind change on a card wearing a moved frame keeps the M15 era without asking — the same frame as before", () => {
    const keys = changed("kindChange");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [template] = key.split("|");
      expect(isMoved(template), key).toBe(true);
      const [beforeAction, ...beforePatch] = (main.kindChange[key] as string).split("|");
      const [afterAction, ...afterPatch] = (branch.kindChange[key] as string).split("|");
      expect([beforeAction, afterAction], key).toEqual(["confirm", "apply"]);
      expect(afterPatch, key).toEqual(beforePatch);
    }
  });

  it("the variations listed under a base gained the moved frames, and nothing else moved", () => {
    for (const key of changed("skins")) {
      const before = (main.skins[key] as string[] | undefined) ?? [];
      const after = (branch.skins[key] as string[] | undefined) ?? [];
      expect(after.slice(0, before.length), key).toEqual(before);
      expect(after.slice(before.length).every(isMoved), key).toBe(true);
    }
  });
});

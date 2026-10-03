import { describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";

// ---------------------------------------------------------------------------
// The single-faced path of buildFrameComparePayload is byte for byte what it
// was before the tools learned faces (TODO 5.0b): `buildFrameComparePayload
// (id, template)` — no face — answers, in the fields the payload had before
// (`preview`, `scanUrl`, `cardName`, `patch`, `scryfallUri`), EXACTLY what
// `origin/feat/dfc-plumbing` (26e3994a, the 5.0a base) answered for these
// printings. The snapshot beside this file was GENERATED on that base code
// (this test file dropped onto it, `npx vitest run` writing the file) and
// is only read since: a difference here is a change to the front compare,
// score, walk-through seed and sign-off — none of which 5.0b touches. The
// fixtures: the three printings tests/unit/scryfall/reference-preview.test.ts
// has always used (a split card, an adventure, a transforming battle whose
// images live on its faces) and the double-faced production sources of
// fixtures/dfc-printings.ts.
//
// ONE later delta, by design: TODO 5.1a's registry rule `transform/2015`
// (lib/scryfall/frame-signatures.ts) — a 2015-frame transform printing now
// resolves `nearest` on the M15 standard WITH `onceVerified: m15dfcfront`
// (exact once the front body is verified in its colour) instead of the
// `era/2015+dfc` gap, so the three transform printings' `frameMatch` block
// (signature, exactLabel, reason, blockedBy, onceVerified) changed with it;
// the landing template, the status, the preview, the scan and the patch did
// not. The snapshot was regenerated for that one block on the 5.1a head.
// ---------------------------------------------------------------------------

const PNG = (id: string) => `https://cards.scryfall.io/png/front/${id[0]}/${id[1]}/${id}.png`;

const FIRE_ICE_ID = "2a1a9a4d-3c1b-4ae6-9a0e-7b0a2cf4d0a1";
const fireIce = {
  id: FIRE_ICE_ID,
  name: "Fire // Ice",
  layout: "split",
  set: "dmr",
  collector_number: "215",
  type_line: "Instant // Instant",
  rarity: "uncommon",
  colors: ["U", "R"],
  color_identity: ["R", "U"],
  artist: "David Martin & Franz Vohwinkel",
  scryfall_uri: "https://scryfall.com/card/dmr/215/fire-ice",
  image_status: "highres_scan",
  image_uris: { png: PNG(FIRE_ICE_ID), normal: "https://cards.scryfall.io/normal/x.jpg" },
  card_faces: [
    {
      name: "Fire",
      mana_cost: "{1}{R}",
      type_line: "Instant",
      oracle_text: "Fire deals 2 damage divided as you choose among one or two targets.",
      artist: "David Martin",
    },
    {
      name: "Ice",
      mana_cost: "{1}{U}",
      type_line: "Instant",
      oracle_text: "Tap target permanent.\nDraw a card.",
      artist: "Franz Vohwinkel",
    },
  ],
} as unknown as ScryfallCard;

const BONECRUSHER_ID = "09fd2d9c-1793-4beb-a3fb-7a869f660cd4";
const bonecrusher = {
  id: BONECRUSHER_ID,
  name: "Bonecrusher Giant // Stomp",
  layout: "adventure",
  set: "eld",
  type_line: "Creature — Giant // Instant — Adventure",
  rarity: "rare",
  colors: ["R"],
  color_identity: ["R"],
  artist: "Victor Adame Minguez",
  image_uris: { png: PNG(BONECRUSHER_ID) },
  card_faces: [
    {
      name: "Bonecrusher Giant",
      mana_cost: "{2}{R}",
      type_line: "Creature — Giant",
      oracle_text:
        "Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.",
      power: "4",
      toughness: "3",
    },
    {
      name: "Stomp",
      mana_cost: "{1}{R}",
      type_line: "Instant — Adventure",
      oracle_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
    },
  ],
} as unknown as ScryfallCard;

const INVASION_ID = "11798730-6788-4e0b-a828-b46cab1a4fa7";
const invasion = {
  id: INVASION_ID,
  name: "Invasion of Gobakhan // Lightshield Array",
  layout: "transform",
  set: "mom",
  type_line: "Battle — Siege // Enchantment",
  rarity: "rare",
  color_identity: ["W"],
  card_faces: [
    {
      name: "Invasion of Gobakhan",
      mana_cost: "{1}{W}",
      type_line: "Battle — Siege",
      oracle_text: "(As a Siege enters, choose an opponent to protect it.)",
      defense: "3",
      colors: ["W"],
      image_uris: { png: PNG(INVASION_ID), large: "https://cards.scryfall.io/large/front.jpg" },
    },
    {
      name: "Lightshield Array",
      mana_cost: "",
      type_line: "Enchantment",
      oracle_text: "At the beginning of your end step, put a +1/+1 counter on each creature that attacked this turn.",
      colors: ["W"],
      image_uris: { png: "https://cards.scryfall.io/png/back/1/1/back.png" },
    },
  ],
} as unknown as ScryfallCard;

const cards = vi.hoisted(() => ({ byId: new Map<string, unknown>() }));

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    getCardById: async (id: string) => (cards.byId.get(id) as ScryfallCard | undefined) ?? null,
  };
});

import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { DFC_PRINTINGS } from "./fixtures/dfc-printings";
import type { FrameTemplate } from "@/types/card";

for (const card of [fireIce, bonecrusher, invasion, ...Object.values(DFC_PRINTINGS)]) {
  cards.byId.set(card.id, card);
}

/** The payload's fields before 5.0b — the ones the snapshot holds. */
const BEFORE_5_0B = ["preview", "scanUrl", "cardName", "patch", "scryfallUri"] as const;

function before(payload: Record<string, unknown>) {
  return Object.fromEntries(BEFORE_5_0B.map((key) => [key, payload[key]]));
}

const CASES: Array<[string, string, FrameTemplate]> = [
  ["Fire // Ice on split", FIRE_ICE_ID, "split"],
  ["Bonecrusher Giant // Stomp on adventure", BONECRUSHER_ID, "adventure"],
  ["Invasion of Gobakhan // Lightshield Array on battle", INVASION_ID, "battle"],
  ...Object.values(DFC_PRINTINGS).map(
    (card): [string, string, FrameTemplate] => [`${card.name} on m15`, card.id, "m15"],
  ),
  ["Archangel Avacyn // Avacyn, the Purifier on m15devoid", "a1a1a1a1-0001-4001-8001-000000000001", "m15devoid"],
  ["Tergrid, God of Fright // Tergrid's Lantern on m15borderless", "b2b2b2b2-0002-4002-8002-000000000002", "m15borderless"],
];

describe("buildFrameComparePayload(id, template) — the front path, as before 5.0b", () => {
  it.each(CASES)("%s", async (_label, id, template) => {
    const payload = await buildFrameComparePayload(id, template);
    if (!payload) throw new Error("no payload");
    expect(before(payload as unknown as Record<string, unknown>)).toMatchSnapshot();
  });

  it("a printing Scryfall doesn't have is still null", async () => {
    expect(await buildFrameComparePayload("00000000-0000-4000-8000-000000000000", "m15")).toBeNull();
  });
});

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The walker rows' BAKES, pinned (TODO 4.21c, design D7). The saga's chapter
// rows took the walker rows' arithmetic (lib/cards/loyalty-rows.ts
// contentRowsAt). tests/unit/cards/loyalty-rows-pinned.test.ts holds the
// layout's numbers to what layout v41 computed; this file holds the PIXELS:
// every m15pw walker below, baked at 750 and at HD, regular and foil (whose
// mask carries the rows' stripes), hashes to what origin/main (ed1a2cd0,
// layout v41) baked — rows, stripes, badges, text and the shield inset, byte
// for byte. The hashes were written by this file on that commit
// (PIN_PW_BAKES=write) and never since.
//
// The m15pw masters live in the frames bucket (never in git), so the bakes
// get a synthetic stand-in through a stubbed bucket — a white card with a
// transparent art window and a grey loyalty plate — while the rows, badges,
// stripes and geometry are the real M15PW profile's (as pw-rows-bake.test.tsx
// does). Offline and deterministic: the hash is of the decoded RGBA pixels.
//
// Layout v49 (the symbols as printed, owner round 43) changed the two
// walkers whose rows hold a mana symbol — and only those: a pip in the rules
// text lost M15's shadow, and {S} became the prints' white flake. Their
// eight bakes are pinned again under `v49` in the fixture (written by this
// file with PIN_PW_BAKES=write-v49, on the v49 commit) and must DIFFER from
// the v41 ones; the other twenty are still v41's, byte for byte. And the
// change is proven to be the shadow alone where no redrawn symbol is
// involved: "past the floor" ({2}{B}) baked with the inline shadow switched
// back on is v41's hash again.
// ---------------------------------------------------------------------------

const FIXTURE = join(process.cwd(), "tests/unit/render/fixtures/pw-rows-v41-bakes.json");
const ORIGIN = "https://frames.test";
const P = getFrameProfile("m15pw");
const PRESETS = ["default", "hd"] as const;
const FINISHES = ["regular", "foil"] as const;

const WALKERS: Record<string, string> = {
  "three short": "+1: Draw a card.\n−2: Return target creature to its owner's hand.\n−8: You get an emblem with \"You have no maximum hand size.\"",
  "1 / 1 / 5":
    "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"",
  "reaches the shield":
    "+1: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−3: Return target creature card from your graveyard to your hand.\n−7: Search your library for up to three creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.",
  "pips + reminder":
    "+1: Add {B}{B}{B}. (Mana abilities don't use the stack.)\n−2: Target creature gets −{X}/−{X} until end of turn, where X is the number of {S} permanents you control.\n−6: Search your library for up to {7} cards and put them into your hand.",
  "a static ability, then two":
    "Éowyn can be your commander.\n+1: Ölmir and Ñandú each draw a card.\n−4: Destroy target creature. Its controller loses 2 life.",
  "six abilities":
    "+2: Untap target artifact.\n+1: Draw a card.\n0: Create a 0/0 colorless Construct artifact creature token.\n−1: Urza deals 3 damage to any target.\n−2: Exile target permanent. Its controller may search their library for a basic land card.\n−10: You get an emblem with \"Artifacts you control have hexproof.\"",
  "past the floor":
    "+1: Look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. Then each opponent loses 1 life for each creature you control.\n−3: Return up to two target creature cards from your graveyard to the battlefield. They gain haste until end of turn. At the beginning of the next end step, sacrifice them unless you pay {2}{B} for each. Then draw a card for each creature sacrificed this way.\n−9: You get an emblem with \"Whenever a creature dies, return it to the battlefield under your control at the beginning of the next end step. It gains flying, lifelink and deathtouch, and it is a Zombie in addition to its other types. Whenever you cast a spell, copy it.\"",
};

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const [fw, fh] = [1500, 2100];
  const a = P.artSlot;
  const [x0, x1] = [Math.round((a.leftPct / 100) * fw), Math.round(((a.leftPct + a.widthPct) / 100) * fw)];
  const [y0, y1] = [Math.round((a.topPct / 100) * fh), Math.round(((a.topPct + a.heightPct) / 100) * fh)];
  const px = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; // the window: transparent
      px.fill(255, (y * fw + x) * 4, (y * fw + x) * 4 + 4);
    }
  }
  const frame = await sharp(px, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
  const plate = await sharp({ create: { width: 240, height: 154, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15pw/b.png": frame, "m15pw/loyalty/b.png": plate };
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  return { manifest, byUrl };
}

/** 1200 × 800 art with a light left half and a dark right half, so the foil
 *  mask (the art's luminance, then the rows' stripes) has something to
 *  follow. */
async function splitArt(): Promise<string> {
  const [w, h] = [1200, 800];
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) px.fill(x < w / 2 ? 230 : 30, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const png = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

describe("m15pw walker bakes are what layout v41 baked (pinned before the saga's rows joined the walkers')", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let art: string;
  let restoreStorage: () => void = () => {};
  const baked: Record<string, string> = {};

  beforeAll(async () => {
    bucket = await standInBucket();
    art = await splitArt();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  async function bakeHash(rules: string, preset: (typeof PRESETS)[number], finish: (typeof FINISHES)[number]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        if (!buf) throw new Error(`unexpected fetch: ${input}`);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({ manifest: bucket.manifest, origin: ORIGIN });
    const mod = await import("@/lib/render/card-image");
    const card = {
      title: "Probe, the Pinned",
      cost: "{2}{B}{B}",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Probe"],
      rarity: "mythic",
      colorIdentity: ["black"],
      rulesText: rules,
      flavorText: null,
      power: null,
      toughness: null,
      loyalty: "4",
      defense: null,
      artistCredit: "Probe",
      artUrl: art,
      artPosition: {},
      frameStyle: { template: "m15pw", finish },
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
    } as unknown as CardPreviewData;
    const png = Buffer.from(await (await mod.renderCardImage(card, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([RENDER_PRESETS[preset].width, RENDER_PRESETS[preset].height]);
    return createHash("sha256").update(data).digest("hex");
  }

  const WRITE = process.env.PIN_PW_BAKES === "write";
  const WRITE_V49 = process.env.PIN_PW_BAKES === "write-v49";
  const fixture = existsSync(FIXTURE)
    ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as { base: string; bakes: Record<string, string>; v49?: Record<string, string> })
    : null;
  /** The walkers whose rows draw a pip: what layout v49 changed. */
  const hasPip = (rules: string) => /\{[^}]+\}/.test(rules);

  for (const [name, rules] of Object.entries(WALKERS)) {
    for (const preset of PRESETS) {
      for (const finish of FINISHES) {
        const id = `${name} | ${preset} | ${finish}`;
        it(`${id}: the same pixels`, async () => {
          const hash = await bakeHash(rules, preset, finish);
          baked[id] = hash;
          if (WRITE || WRITE_V49) return;
          expect(fixture, "tests/unit/render/fixtures/pw-rows-v41-bakes.json is missing").not.toBeNull();
          if (hasPip(rules)) {
            // v49: its rows' pips are flat (and {S} the white flake).
            expect(hash, `${id}: v49 changed this walker's pips`).not.toBe(fixture!.bakes[id]);
            expect(hash, `${id}: a walker bake changed since layout v49`).toBe(fixture!.v49?.[id]);
            return;
          }
          expect(hash, `${id}: a walker bake changed — the rows' generalisation (or anything else) moved a pixel on m15pw`).toBe(fixture!.bakes[id]);
        }, 60_000);
      }
    }
  }

  it("v49 moved nothing but the inline shadow where no symbol was redrawn: with it switched back on, \"past the floor\" is v41's pixels", async () => {
    if (WRITE || WRITE_V49) return;
    const { SYMBOL_STYLES } = await import("@/lib/cards/symbol-style");
    const modern = SYMBOL_STYLES.modern as { inlineShadow: boolean };
    expect(modern.inlineShadow).toBe(false);
    modern.inlineShadow = true;
    try {
      for (const preset of PRESETS) {
        for (const finish of FINISHES) {
          const id = `past the floor | ${preset} | ${finish}`;
          expect(await bakeHash(WALKERS["past the floor"], preset, finish), id).toBe(fixture!.bakes[id]);
        }
      }
    } finally {
      modern.inlineShadow = false;
    }
  }, 120_000);

  it("covers every walker, both targets and both finishes — and the foil bakes differ from the regular ones", () => {
    const ids = Object.keys(WALKERS).flatMap((name) => PRESETS.flatMap((preset) => FINISHES.map((finish) => `${name} | ${preset} | ${finish}`)));
    const pipIds = ids.filter((id) => hasPip(WALKERS[id.split(" | ")[0]]));
    if (WRITE_V49) {
      writeFileSync(
        FIXTURE,
        `${JSON.stringify({ ...fixture, v49Comment: "the walkers whose rows draw a mana symbol, as layout v49 bakes them (flat rules-text pips, the white snow flake); written with PIN_PW_BAKES=write-v49 on the v49 commit, never since", v49: Object.fromEntries(pipIds.map((id) => [id, baked[id]])) }, null, 1)}\n`,
      );
      return;
    }
    if (WRITE) {
      writeFileSync(
        FIXTURE,
        `${JSON.stringify({ comment: "sha256 of each bake's decoded RGBA pixels; written by tests/unit/render/pw-rows-pinned-bake.test.tsx with PIN_PW_BAKES=write on the base named here, never since", base: process.env.PIN_PW_BASE ?? "unknown", bakes: Object.fromEntries(ids.map((id) => [id, baked[id]])) }, null, 1)}\n`,
      );
      return;
    }
    expect(Object.keys(fixture!.bakes).sort()).toEqual([...ids].sort());
    // v49's re-pinned set is exactly the two walkers with pips in their rows.
    expect(Object.keys(fixture!.v49 ?? {}).sort()).toEqual([...pipIds].sort());
    expect(pipIds.map((id) => id.split(" | ")[0]).filter((name, i, all) => all.indexOf(name) === i)).toEqual(["pips + reminder", "past the floor"]);
    // The foil's sheen reached the bake (a foil bake identical to its regular
    // one would pin nothing about the stripes).
    for (const name of Object.keys(WALKERS)) {
      for (const preset of PRESETS) {
        expect(fixture!.bakes[`${name} | ${preset} | foil`], `${name} ${preset}`).not.toBe(fixture!.bakes[`${name} | ${preset} | regular`]);
      }
    }
    // Different walkers are different pictures.
    expect(new Set(Object.values(fixture!.bakes)).size).toBe(ids.length);
  });
});

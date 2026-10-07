import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoyaltyAbility } from "@/lib/cards/card-display";
import { loyaltyStripeRects } from "@/lib/cards/foil-finish";
import { layoutProfileLoyaltyRows, loyaltyRowLines, loyaltyRowsDrawing } from "@/lib/cards/loyalty-rows";
import { RULES_TARGETS } from "@/lib/cards/rules-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The walker rows, PINNED (TODO 4.21c, design D7). The saga's chapter rows
// took the walker rows' arithmetic (lib/cards/loyalty-rows.ts contentRowsAt:
// a row's natural height, the shares, the whole-px rows) with a row minimum
// of their own — a stack of chapter badges. Nothing about a walker may move
// with that: every size, row fraction, shield inset, line, padding, edge and
// foil stripe below is what origin/main (layout v41, ed1a2cd0) computed for
// the same abilities, on the three walker bodies — 7 public production
// walkers sit on m15pw. The fixture was written by this file on that commit
// (PIN_LOYALTY_ROWS=write) and never since; real bakes of the same walkers
// are pinned in tests/unit/render/pw-rows-pinned-bake.test.tsx.
// ---------------------------------------------------------------------------

const FIXTURE = join(process.cwd(), "tests/unit/cards/fixtures/loyalty-rows-v41.json");
const TEMPLATES = ["m15pw", "m15borderlesspw", "m15borderlesspwtall"] as const;

const CASES: Record<string, LoyaltyAbility[]> = {
  "three short": [
    { cost: "+1", text: "Draw a card." },
    { cost: "-2", text: "Return target creature to its owner's hand." },
    { cost: "-8", text: "You get an emblem with \"You have no maximum hand size.\"" },
  ],
  "1 / 1 / 5": [
    { cost: "+1", text: "Scry 1." },
    { cost: "-2", text: "Draw a card." },
    {
      cost: "-8",
      text: "You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"",
    },
  ],
  "reaches the shield": [
    {
      cost: "+1",
      text: "Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
    },
    { cost: "-3", text: "Return target creature card from your graveyard to your hand." },
    {
      cost: "-7",
      text: "Search your library for up to three creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.",
    },
  ],
  "pips + reminder": [
    { cost: "+1", text: "Add {B}{B}{B}. (Mana abilities don't use the stack.)" },
    { cost: "-2", text: "Target creature gets −{X}/−{X} until end of turn, where X is the number of {S} permanents you control." },
    { cost: "-6", text: "Search your library for up to {7} cards and put them into your hand." },
  ],
  "a static ability's two paragraphs, accents": [
    { cost: null, text: "Éowyn can be your commander.\nÉowyn can't be countered." },
    { cost: "+1", text: "Ölmir and Ñandú each draw a card." },
    { cost: "-4", text: "Destroy target creature. Its controller loses 2 life." },
  ],
  "one ability": [{ cost: "0", text: "Create a 2/2 black Zombie creature token." }],
  "six abilities": [
    { cost: "+2", text: "Untap target artifact." },
    { cost: "+1", text: "Draw a card." },
    { cost: "0", text: "Create a 0/0 colorless Construct artifact creature token." },
    { cost: "-1", text: "Urza deals 3 damage to any target." },
    { cost: "-2", text: "Exile target permanent. Its controller may search their library for a basic land card." },
    { cost: "-10", text: "You get an emblem with \"Artifacts you control have hexproof.\"" },
  ],
  "past the floor": [
    {
      cost: "+1",
      text: "Look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. Then each opponent loses 1 life for each creature you control.",
    },
    {
      cost: "-3",
      text: "Return up to two target creature cards from your graveyard to the battlefield. They gain haste until end of turn. At the beginning of the next end step, sacrifice them unless you pay {2}{B} for each. Then draw a card for each creature sacrificed this way.",
    },
    {
      cost: "-9",
      text: "You get an emblem with \"Whenever a creature dies, return it to the battlefield under your control at the beginning of the next end step. It gains flying, lifelink and deathtouch, and it is a Zombie in addition to its other types. Whenever you cast a spell, copy it.\"",
    },
  ],
  "no abilities": [],
};

/** A JSON round trip: what the fixture stores (functions dropped, numbers
 *  at their shortest exact form). */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

/** Everything the rows decide for one walker: what a reader can compare by
 *  eye (the size, the shares, the inset, each row's lines as text, the foil
 *  stripes) and a digest of ALL of it — every line's runs and widths at both
 *  targets, each row's checks, side insets and input, the px both renderers
 *  draw (loyaltyRowsDrawing) and where each line lands (loyaltyRowLines). */
function snapshot(template: (typeof TEMPLATES)[number], abilities: LoyaltyAbility[]) {
  const profile = getFrameProfile(template);
  const rows = layoutProfileLoyaltyRows(profile, abilities, 7 / 5);
  const everything = plain({
    sizePx: rows.sizePx,
    sizePct: rows.sizePct,
    rowFractions: rows.rowFractions,
    lastRowInsetPct: rows.lastRowInsetPct,
    clipped: rows.clipped,
    text: rows.text.map((l) => ({
      sizePx: l.sizePx,
      lineHeight: l.lineHeight,
      clipped: l.clipped,
      checks: l.checks,
      sideInsets: l.sideInsets,
      input: l.input,
      blocks: l.blocks,
    })),
    drawing: Object.fromEntries(RULES_TARGETS.map((t) => [t, loyaltyRowsDrawing(rows, t)])),
    lines: Object.fromEntries(RULES_TARGETS.map((t) => [t, rows.text.map((_, i) => loyaltyRowLines(rows, i, t).lines)])),
    stripes: loyaltyStripeRects(profile.rules.rect, rows.rowFractions),
  });
  return plain({
    sizePx: rows.sizePx,
    rowFractions: rows.rowFractions,
    lastRowInsetPct: rows.lastRowInsetPct,
    clipped: rows.clipped,
    rows: rows.text.map((l) =>
      l.blocks.map((b) =>
        b.lines.map((line) => line.runs.map((run) => run.map((it) => (it.t === "m" ? `{${it.suffix}}` : it.v)).join("")).join(" ")),
      ),
    ),
    edges: Object.fromEntries(RULES_TARGETS.map((t) => [t, loyaltyRowsDrawing(rows, t).edges])),
    stripes: loyaltyStripeRects(profile.rules.rect, rows.rowFractions),
    digest: createHash("sha256").update(JSON.stringify(everything)).digest("hex"),
  });
}

const all = () =>
  Object.fromEntries(
    TEMPLATES.map((template) => [template, Object.fromEntries(Object.entries(CASES).map(([name, abilities]) => [name, snapshot(template, abilities)]))]),
  );

describe("the walker rows are what layout v41 computed (pinned before the saga's rows joined them)", () => {
  if (process.env.PIN_LOYALTY_ROWS === "write") {
    it("writes the fixture (run on the commit being pinned)", () => {
      writeFileSync(FIXTURE, `${JSON.stringify({ pinned: "origin/main ed1a2cd0, layout v41", cases: CASES, rows: all() }, null, 1)}\n`);
      expect(existsSync(FIXTURE)).toBe(true);
    });
    return;
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: unknown; rows: Record<string, Record<string, unknown>> };

  it("pins the same abilities the fixture was written for", () => {
    expect(plain(CASES)).toEqual(fixture.cases);
    expect(Object.keys(fixture.rows).sort()).toEqual([...TEMPLATES].sort());
  });

  for (const template of TEMPLATES) {
    for (const [name, abilities] of Object.entries(CASES)) {
      it(`${template}: ${name} — size, fractions, inset, lines, row px and foil stripes unchanged`, () => {
        expect(snapshot(template, abilities)).toEqual(fixture.rows[template][name]);
      });
    }
  }
});

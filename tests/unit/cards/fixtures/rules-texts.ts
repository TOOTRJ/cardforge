// Rules / flavor texts the v33 rules tests share (layout v33, TODO 3.29): two
// print references and the no-clip text matrix. Plain data.

import { printTypography } from "@/lib/validation/print-typography";

/** What a maker types on a plain keyboard, as the save stores it (TODO 6.11,
 *  lib/validation/print-typography.ts): curly quotes round a quoted ability
 *  with pips, apostrophes after a pip and before a year, the ability word's
 *  and the modal list's em dashes, bullets, a hyphenated -1/-1 beside them —
 *  and a quoted flavor line with its attribution. */
export const TYPED_RULES = printTypography(
  `Landfall - This creature can't be blocked this turn. It's a '90s trick: "{T}: Add {G}."\nChoose one -\n- Target creature gets -1/-1.\n* Its controller's creatures gain "{1}: Deal X-1 damage."\nRaid--Draw a card.`,
  "rules",
);
export const TYPED_FLAVOR = printTypography(`"It's the 'landing' that kills--not the fall."\n-Kesh, '99`, "flavor");

/** EOE #30 — a full M15 box on print (59.85 px). */
export const EOE_30 =
  "When this creature enters, put a +1/+1 counter on target creature you control.\nWhenever a nontoken creature you control with a +1/+1 counter on it dies, create a 1/1 white Human Soldier creature token.\nWarp {1}{W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)";

/** TLA #112 — a full M15 box on print (60.6 px). */
export const TLA_112 =
  "When this enchantment enters and at the beginning of your upkeep, you lose 1 life and create a Clue token. (It’s an artifact with “{2}, Sacrifice this token: Draw a card.”)\nWhenever you attack, put X +1/+1 counters on target attacking creature, where X is the number of permanents you’ve sacrificed this turn. If X is three or greater, that creature gains lifelink until end of turn.";

/** VOW #63 (Hullbreaker Horror, a 7/8) — its modal dash: the print sets
 *  "choose up to" / "one —", never the dash alone on a line. */
export const VOW_63 =
  "Flash\nThis spell can’t be countered.\nWhenever you cast a spell, choose up to one —\n• Return target spell you don’t control to its owner’s hand.\n• Return target nonland permanent to its owner’s hand.";

const SENTENCE = "Whenever this creature attacks, draw a card and gain 1 life. ";

/** A text of about `chars` characters of plain rules sentences. */
export function plainText(chars: number): string {
  return SENTENCE.repeat(Math.ceil(chars / SENTENCE.length)).slice(0, chars).trim();
}

export type RulesCase = { name: string; rules: string | null; flavor: string | null };

/** The no-clip matrix's texts: every kind of line the layout draws. */
export const RULES_MATRIX: readonly RulesCase[] = [
  { name: "one line", rules: "Flying", flavor: null },
  { name: "short + flavor", rules: "Flying, vigilance", flavor: "Born with wings of light and a sword of faith, she is the embodiment of divine justice." },
  { name: "200 chars", rules: plainText(200), flavor: null },
  { name: "400 chars", rules: plainText(400), flavor: null },
  { name: "1200 chars", rules: plainText(1200), flavor: null },
  {
    name: "pips + reminder",
    rules:
      "{T}: Add {G}{G}. ({T}: Add {C}.)\nWard {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)\n{2}{W/U}{W/U}, {Q}: Scry 2.",
    flavor: null,
  },
  {
    // Layout v49's drawings: Phyrexian pips on their larger disc — in a row,
    // on consecutive lines, at a line's start and end —, the two-colour
    // one, the untap, snow and (disc-less) energy symbols.
    name: "symbols as printed",
    rules:
      "{W/P}{U/P}{B/P}: Draw a card. ({W/P} can be paid with either {W} or 2 life.)\n{R/P}{G/U/P}, {Q}: Add {S}{E}{E} and {G/W/P}.\n{R/P}{R/P}{R/P}{R/P}: Untap it. {G/P}",
    flavor: null,
  },
  { name: "flavor + attribution", rules: "Lifelink", flavor: "\"The light does not ask whether you are ready.\"\n—Serra, founder of the realm" },
  { name: "blank lines", rules: "Flying\n\nWhen this creature enters, draw a card.\n\nScry 2.", flavor: null },
  { name: "modal bullets", rules: "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Target player draws two cards.", flavor: null },
  {
    name: "accented first line",
    rules: "ÉÅÂ Ÿsolde — Éowyn and Ångström attack. Ÿ Ñ Ō Š Ž Ć Ř.\nWhenever Éowyn attacks, create a 1/1 token.",
    flavor: "\"Ånd so it ends.\"\n—Théoden",
  },
  { name: "non-Latin + emoji", rules: "Ωmega — Δ Λ Ж Щ 火 ok🙂 survives.\nWhen this enters, λ-draw a card.", flavor: null },
  {
    name: "level up",
    rules: "Level up {1}{W} ({1}{W}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 1-3\n2/3\nFlying\nLEVEL 4+\n4/5\nFlying, lifelink",
    flavor: null,
  },
  { name: "minus sign", rules: "−1: Target creature gets −2/−2 until end of turn.\n−7: You get an emblem.", flavor: null },
  { name: "typed, as printed", rules: TYPED_RULES, flavor: TYPED_FLAVOR },
  { name: "flavor only", rules: null, flavor: plainText(260) },
  { name: "EOE #30", rules: EOE_30, flavor: null },
  { name: "TLA #112", rules: TLA_112, flavor: null },
];

// ---------------------------------------------------------------------------
// The rules editor's keyword inserts (TODO 6.2, owner 2026-10-21): the
// keywords a maker reaches for most, each with its Comprehensive Rules rule
// and the reminder text print sets after it — for the toolbar's OPT-IN
// "with reminder text" insert (components/creator/rules-symbol-toolbar.tsx).
//
// DATA, sourced and dated — never edited by feel:
//   * the rule numbers: Magic: The Gathering Comprehensive Rules, effective
//     2026-09-25 (magic.wizards.com/en/rules → "MagicCompRules 20260925.txt",
//     read 2026-10-21), section 701 (keyword actions) and 702 (keyword
//     abilities);
//   * the reminder texts: as Wizards prints them since Foundations (FDN,
//     2024-11) — the "this creature" wording that replaced the card's name.
//     A parameter is written as print writes it with its usual number
//     ("Ward {2}", "Scry 1"); the maker edits the number.
// A new Comprehensive Rules release is read again before a number here
// changes: CR_SOURCE and the rules move together
// (tests/unit/cards/keyword-reminders.test.ts holds the shape).
// ---------------------------------------------------------------------------

export const CR_SOURCE = {
  title: "Magic: The Gathering Comprehensive Rules",
  effective: "2026-09-25",
  url: "https://magic.wizards.com/en/rules",
  read: "2026-10-21",
} as const;

export type KeywordReminder = {
  /** The keyword as the menu names it ("First strike"). */
  name: string;
  /** Its Comprehensive Rules rule ("702.7"). */
  rule: string;
  /** What the insert writes ("First strike", "Ward {2}", "Scry 1."). */
  text: string;
  /** The reminder text, without its brackets. */
  reminder: string;
};

/** Keyword abilities (CR 702), evergreen first, then the common returning
 *  ones; keyword actions (CR 701) after them. */
export const KEYWORD_REMINDERS: readonly KeywordReminder[] = [
  { name: "Deathtouch", rule: "702.2", text: "Deathtouch", reminder: "Any amount of damage this deals to a creature is enough to destroy it." },
  { name: "Defender", rule: "702.3", text: "Defender", reminder: "This creature can’t attack." },
  { name: "Double strike", rule: "702.4", text: "Double strike", reminder: "This creature deals both first-strike and regular combat damage." },
  { name: "Equip", rule: "702.6", text: "Equip {2}", reminder: "{2}: Attach to target creature you control. Equip only as a sorcery." },
  { name: "First strike", rule: "702.7", text: "First strike", reminder: "This creature deals combat damage before creatures without first strike." },
  { name: "Flash", rule: "702.8", text: "Flash", reminder: "You may cast this spell any time you could cast an instant." },
  { name: "Flying", rule: "702.9", text: "Flying", reminder: "This creature can’t be blocked except by creatures with flying or reach." },
  { name: "Haste", rule: "702.10", text: "Haste", reminder: "This creature can attack and {T} as soon as it comes under your control." },
  { name: "Hexproof", rule: "702.11", text: "Hexproof", reminder: "This creature can’t be the target of spells or abilities your opponents control." },
  { name: "Indestructible", rule: "702.12", text: "Indestructible", reminder: "Damage and effects that say “destroy” don’t destroy this creature." },
  { name: "Lifelink", rule: "702.15", text: "Lifelink", reminder: "Damage dealt by this creature also causes you to gain that much life." },
  { name: "Menace", rule: "702.111", text: "Menace", reminder: "This creature can’t be blocked except by two or more creatures." },
  { name: "Reach", rule: "702.17", text: "Reach", reminder: "This creature can block creatures with flying." },
  { name: "Trample", rule: "702.19", text: "Trample", reminder: "This creature can deal excess combat damage to the player or planeswalker it’s attacking." },
  { name: "Vigilance", rule: "702.20", text: "Vigilance", reminder: "Attacking doesn’t cause this creature to tap." },
  { name: "Ward", rule: "702.21", text: "Ward {2}", reminder: "Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}." },
  { name: "Cycling", rule: "702.29", text: "Cycling {2}", reminder: "{2}, Discard this card: Draw a card." },
  { name: "Kicker", rule: "702.33", text: "Kicker {2}", reminder: "You may pay an additional {2} as you cast this spell." },
  { name: "Flashback", rule: "702.34", text: "Flashback {2}", reminder: "You may cast this card from your graveyard for its flashback cost. Then exile it." },
  { name: "Convoke", rule: "702.51", text: "Convoke", reminder: "Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature’s color." },
  { name: "Prowess", rule: "702.108", text: "Prowess", reminder: "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn." },
  { name: "Crew", rule: "702.122", text: "Crew 1", reminder: "Tap any number of untapped creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn." },
  { name: "Toxic", rule: "702.164", text: "Toxic 1", reminder: "Players dealt combat damage by this creature also get a poison counter." },
  { name: "Mill", rule: "701.17", text: "Mill two cards.", reminder: "Put the top two cards of your library into your graveyard." },
  { name: "Scry", rule: "701.22", text: "Scry 1.", reminder: "Look at the top card of your library. You may put that card on the bottom." },
  { name: "Surveil", rule: "701.25", text: "Surveil 1.", reminder: "Look at the top card of your library. You may put that card into your graveyard." },
];

/** What the insert writes: the keyword, and its reminder in brackets when
 *  the maker asked for it (off by default — print leaves the evergreen
 *  ones' out on most cards). */
export function keywordInsert(keyword: KeywordReminder, withReminder: boolean): string {
  return withReminder ? `${keyword.text} (${keyword.reminder})` : keyword.text;
}

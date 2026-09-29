// Card rows for the layout-version scope rules (lib/cards/layout-version.ts).

/**
 * The `cards` columns of a card no bump from v23 to v30 changed: a
 * single-word sorcery on the Lord of the Rings frame. It is outside the v24 /
 * v25 / v27 / v30 template lists, a regular (v26, v28) uncommon (v23) with no
 * custom set icon, and v29 finds no space in its name or type line and no
 * stat to fit (and lotr is not a display-footer template). So up to v30 the
 * only look pending on an older bake of it is the v22 OPT-IN — the card the
 * badge / servable / notify tests need. v31 (the one corner radius) is
 * unscoped and changes it too, so those tests pin the policy at v30
 * (tests/stubs/layout-version-at.ts). Spread it into a row and override what
 * a case varies.
 */
export const UNTOUCHED_SINCE_V22 = {
  frame_style: { template: "lotr" },
  rarity: "uncommon",
  set_icon_url: null,
  set_icon_code: null,
  title: "Worm",
  supertype: null,
  card_type: "sorcery",
  subtypes: [] as string[],
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  back_face: null,
  // v33 (the rules layout) reads what a card prints: this one prints no text.
  rules_text: null,
  flavor_text: null,
  face_content: null,
};

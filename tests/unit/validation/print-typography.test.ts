import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRINT_TYPOGRAPHY_CHARACTERS,
  printTypography,
  printTypographyPatch,
  typographyFieldOf,
  withPrintTypography,
  withPrintTypographyUpdate,
  type TypographyField,
} from "@/lib/validation/print-typography";
import { unrenderableCharacters, type GlyphFace } from "@/lib/validation/card-glyphs";
import { isAbilityWord, tokenizeRulesText } from "@/lib/cards/rules-text";
import { serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";
import { BAKE_FONT_FILES, loadFont } from "@/scripts/lib/glyph-coverage.mjs";

// ---------------------------------------------------------------------------
// TODO 6.11 — print typography on input: what a plain keyboard types becomes
// what a card prints, the same in the creator and on the server, without
// touching what is already right, a `{…}` token or a URL; and it converts to
// nothing a face can't draw.
// ---------------------------------------------------------------------------

const FIELDS: readonly TypographyField[] = ["name", "type", "rules", "flavor"];

describe("printTypography — the item's acceptance cases", () => {
  it("'90s is an apostrophe, never an opening quote", () => {
    expect(printTypography("A relic of the '90s.", "flavor")).toBe("A relic of the ’90s.");
    expect(printTypography("'90s Kid", "name")).toBe("’90s Kid");
    expect(printTypography("'Tis the season, 'til dawn — get 'em.", "flavor")).toBe("’Tis the season, ’til dawn — get ’em.");
  });

  it("a possessive after a pip", () => {
    expect(printTypography("{T}'s ability can't be activated.", "rules")).toBe("{T}’s ability can’t be activated.");
    expect(printTypography("Spend {G}{G}'s worth: it's yours.", "rules")).toBe("Spend {G}{G}’s worth: it’s yours.");
  });

  it("a quote and its attribution", () => {
    expect(printTypography('"The light does not ask whether you are ready."\n-Serra, founder of the realm', "flavor")).toBe(
      "“The light does not ask whether you are ready.”\n—Serra, founder of the realm",
    );
    expect(printTypography('"Run."\n-- Hans', "flavor")).toBe("“Run.”\n—Hans");
    expect(printTypography('"Run."\n—Hans', "flavor")).toBe("“Run.”\n—Hans");
  });

  it("X-1 stays a hyphen — in every field", () => {
    for (const field of FIELDS) {
      expect(printTypography("X-1", field)).toBe("X-1");
      expect(printTypography("gets -1/-1 and X-1 counters", field)).toBe("gets -1/-1 and X-1 counters");
      expect(printTypography("where X is 5 - 2", field)).toBe("where X is 5 - 2");
    }
  });
});

describe("printTypography — quotes", () => {
  it("opens and closes double and single quotes by what stands before them", () => {
    expect(printTypography('He said "go" and left.', "flavor")).toBe("He said “go” and left.");
    expect(printTypography("the 'old' way", "flavor")).toBe("the ‘old’ way");
    expect(printTypography(`"'Nested,' she said."`, "flavor")).toBe("“‘Nested,’ she said.”");
    expect(printTypography('("quoted")', "rules")).toBe("(“quoted”)");
    expect(printTypography("the wizards' tower", "flavor")).toBe("the wizards’ tower");
  });

  it("a quoted ability keeps its pips and closes after the full stop", () => {
    expect(printTypography('It has "{T}: Add {G}."', "rules")).toBe("It has “{T}: Add {G}.”");
    expect(printTypography('(It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")', "rules")).toBe(
      "(It’s an artifact with “{2}, Sacrifice this token: Draw a card.”)",
    );
  });

  it("names and type-line parts", () => {
    expect(printTypography("Urza's Saga", "name")).toBe("Urza’s Saga");
    expect(printTypography('"Ach! Hans, Run!"', "name")).toBe("“Ach! Hans, Run!”");
    expect(printTypography("Urza's, Power-Plant", "type")).toBe("Urza’s, Power-Plant");
  });
});

describe("printTypography — dashes and bullets", () => {
  it("a spaced hyphen or two hyphens is an em dash, and the ability word goes italic", () => {
    for (const typed of ["Landfall - Whenever a land enters, draw.", "Landfall -- Whenever a land enters, draw.", "Landfall--Whenever a land enters, draw."]) {
      const printed = printTypography(typed, "rules");
      expect(printed).toBe("Landfall — Whenever a land enters, draw.");
      expect(tokenizeRulesText(printed)[0][0]).toEqual({ t: "w", v: "Landfall", em: "ability" });
    }
    // As typed, the ability word was never read (the bug the item names).
    expect(tokenizeRulesText("Landfall - Whenever a land enters, draw.")[0][0]).toEqual({ t: "w", v: "Landfall" });
    expect(isAbilityWord(printTypography("Council's dilemma", "rules"))).toBe(true);
  });

  it("a modal list: the closing dash and the bullets", () => {
    expect(printTypography("Choose one -\n- Destroy target artifact.\n* Draw a card.\n  - Gain 3 life.", "rules")).toBe(
      "Choose one —\n• Destroy target artifact.\n• Draw a card.\n  • Gain 3 life.",
    );
  });

  it("a bullet only in rules text, only at the start of a line, only before a space", () => {
    expect(printTypography("- Not a list", "name")).toBe("- Not a list");
    expect(printTypography("-1/-1 counters matter.", "rules")).toBe("-1/-1 counters matter.");
    expect(printTypography("*Draw* a card.", "rules")).toBe("*Draw* a card.");
    expect(printTypography("- 3: Deal 3 damage.\n- X: Draw X cards.", "rules")).toBe("- 3: Deal 3 damage.\n- X: Draw X cards.");
    expect(printTypography("-3: Deal 3 damage.\n+1: Draw a card.", "rules")).toBe("-3: Deal 3 damage.\n+1: Draw a card.");
  });

  it("outside rules text two hyphens keep the spacing they were typed with", () => {
    expect(printTypography("Wait--what?", "flavor")).toBe("Wait—what?");
    expect(printTypography("Wait -- what?", "flavor")).toBe("Wait — what?");
    expect(printTypography("Creature - Goblin", "type")).toBe("Creature — Goblin");
  });

  it("leaves a rule of hyphens, a hyphenated word and a number's sign alone", () => {
    for (const field of FIELDS) {
      expect(printTypography("-----", field)).toBe("-----");
      expect(printTypography("a---b", field)).toBe("a---b");
      expect(printTypography("Power-Plant, non-Wall, +1/+1 and -2/-2", field)).toBe("Power-Plant, non-Wall, +1/+1 and -2/-2");
    }
  });
});

describe("printTypography — what it never touches", () => {
  it("anything inside a {…} token", () => {
    expect(printTypography(`{W/U}{2/W}{T}: "x"`, "rules")).toBe("{W/U}{2/W}{T}: “x”");
    for (const field of FIELDS) {
      expect(printTypography(`{a - b}{it's}{"q"}{--}`, field)).toBe(`{a - b}{it's}{"q"}{--}`);
    }
  });

  it("a URL", () => {
    expect(printTypography(`See https://example.com/a--b?q='x'&r="y" - it's there.`, "flavor")).toBe(
      `See https://example.com/a--b?q='x'&r="y" — it’s there.`,
    );
    expect(printTypography("www.example.com/it's--here", "rules")).toBe("www.example.com/it's--here");
  });

  it("text that is already printed, line breaks and outer whitespace", () => {
    const printed = "Flash\nThis spell can’t be countered.\nWhenever you cast a spell, choose up to one —\n• Return target spell you don’t control to its owner’s hand.\n\n“Quoted.”";
    for (const field of FIELDS) expect(printTypography(printed, field)).toBe(printed);
    expect(printTypography("  can't  \n\n  won't ", "rules")).toBe("  can’t  \n\n  won’t ");
    expect(printTypography("", "rules")).toBe("");
  });

  it("never an ellipsis, never a minus sign", () => {
    for (const field of FIELDS) {
      const out = printTypography(`Wait... -1/-1, X-1, "it's" - done -- now\n- item\n-Name`, field);
      expect(out).toContain("...");
      expect(out).not.toMatch(/[…−–]/);
    }
  });
});

describe("printTypography — idempotent, and bounded", () => {
  const SAMPLES = [
    `"It's the '90s," she said - 'til dawn--or later.`,
    "Choose one -\n- A\n* B\n-- C",
    "Landfall--Whenever",
    "--lead and trail--",
    " - ",
    `'''"""---`,
    `{T}'s "{G}" - {a--b}`,
    "-Serra\n- Serra\n--Serra\n-- Serra",
    "a - b - c - 1 - d",
    `"`,
    `'`,
    "It's https://x.y/'--' www.a.b/\"q\"",
  ];

  it("a second pass changes nothing, in every field", () => {
    for (const field of FIELDS) {
      for (const sample of SAMPLES) {
        const once = printTypography(sample, field);
        expect(printTypography(once, field), `${field}: ${JSON.stringify(sample)}`).toBe(once);
      }
    }
  });

  it("introduces only the characters its table lists", () => {
    for (const field of FIELDS) {
      const allowed = new Set(PRINT_TYPOGRAPHY_CHARACTERS[field]);
      for (const sample of SAMPLES) {
        const typed = new Set(sample);
        for (const ch of printTypography(sample, field)) {
          // (A space is no glyph: the spaced rules dash may add one.)
          if (!typed.has(ch) && ch !== " ") expect(allowed.has(ch), `${field} introduced ${JSON.stringify(ch)} in ${JSON.stringify(sample)}`).toBe(true);
        }
      }
    }
    // …and every listed character is one some input really produces.
    const produced: Record<TypographyField, Set<string>> = { name: new Set(), type: new Set(), rules: new Set(), flavor: new Set() };
    for (const field of FIELDS) for (const sample of SAMPLES) for (const ch of printTypography(sample, field)) produced[field].add(ch);
    for (const field of FIELDS) for (const ch of PRINT_TYPOGRAPHY_CHARACTERS[field]) expect(produced[field].has(ch), `${field} ${ch}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ink: a character the conversion introduces is drawn, with ink, by EVERY
// face that can set its field — read off the committed font files, not the
// fallback chain (a face that lacked one would hand it to another font).
//   name / type — Beleren Bold, or MPlantin where an era frame sets the slot
//                 in the body face (the 1997 type line, lib/cards/type-faces.ts);
//   rules       — MPlantin, and MPlantin italic for reminder text and ability
//                 words;
//   flavor      — MPlantin italic.
// The collector face (Montserrat) draws none of these fields.
// ---------------------------------------------------------------------------

describe("the conversion table against the faces' ink", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const font = (file: string) => loadFont(path.join(ROOT, file));
  const beleren = font(BAKE_FONT_FILES.cardDisplay);
  const mplantin = font(BAKE_FONT_FILES.mplantin);
  const italic = font(BAKE_FONT_FILES.mplantinItalic);
  const collector = font("public/fonts/Montserrat-Medium.ttf");

  const FACES: Record<TypographyField, [string, ReturnType<typeof loadFont>][]> = {
    name: [["Beleren", beleren], ["MPlantin", mplantin]],
    type: [["Beleren", beleren], ["MPlantin", mplantin]],
    rules: [["MPlantin", mplantin], ["MPlantin italic", italic]],
    flavor: [["MPlantin italic", italic]],
  };

  it("every introduced character has ink in every face that draws its field", () => {
    for (const field of FIELDS) {
      for (const ch of PRINT_TYPOGRAPHY_CHARACTERS[field]) {
        for (const [name, face] of FACES[field]) {
          expect(face.draws(ch.codePointAt(0) as number), `${field}: ${ch} in ${name}`).toBe(true);
        }
      }
    }
  });

  it("the creator's glyph warning agrees: none of them 'may not show'", () => {
    const WARNED: Record<TypographyField, GlyphFace[]> = {
      name: ["display", "body"],
      type: ["display", "body"],
      rules: ["rules", "italic"],
      flavor: ["italic"],
    };
    for (const field of FIELDS) {
      for (const face of WARNED[field]) {
        expect(unrenderableCharacters(PRINT_TYPOGRAPHY_CHARACTERS[field].join(" "), face), `${field} / ${face}`).toEqual([]);
        expect(unrenderableCharacters(PRINT_TYPOGRAPHY_CHARACTERS[field].join(" "), face, { uppercase: true })).toEqual([]);
      }
    }
  });

  it("why there is no minus sign: MPlantin maps U+2212 to an empty glyph", () => {
    expect(mplantin.maps(0x2212)).toBe(true);
    expect(mplantin.draws(0x2212)).toBe(false);
    for (const field of FIELDS) expect(PRINT_TYPOGRAPHY_CHARACTERS[field]).not.toContain("−");
  });

  it("the collector face has no curly quotes — and no field it draws is converted", () => {
    for (const ch of ["‘", "’", "“", "”", "—"]) expect(collector.maps(ch.codePointAt(0) as number), ch).toBe(false);
    for (const name of ["set_code", "collector_number", "lang", "artist_credit", "footer_text", "cost", "power", "toughness", "loyalty", "defense", "tags_text", "loyalty_abilities.0.cost", "back_face.cost", "back_face.artist_credit"]) {
      expect(typographyFieldOf(name), name).toBeNull();
    }
  });
});

describe("the creator's fields", () => {
  it("names each text field's kind, the second face's and the rows' included", () => {
    expect(typographyFieldOf("title")).toBe("name");
    expect(typographyFieldOf("back_face.title")).toBe("name");
    expect(typographyFieldOf("supertype")).toBe("type");
    expect(typographyFieldOf("back_face.subtypes_text")).toBe("type");
    expect(typographyFieldOf("rules_text")).toBe("rules");
    expect(typographyFieldOf("back_face.rules_text")).toBe("rules");
    expect(typographyFieldOf("loyalty_abilities.3.text")).toBe("rules");
    expect(typographyFieldOf("saga_chapters.0.text")).toBe("rules");
    expect(typographyFieldOf("saga_intro")).toBe("rules");
    expect(typographyFieldOf("flavor_text")).toBe("flavor");
    expect(typographyFieldOf("back_face.flavor_text")).toBe("flavor");
  });

  it("a patch poured into the form: present keys converted, absent keys absent", () => {
    const out = printTypographyPatch({
      title: "Urza's Saga",
      rules_text: "Landfall - It's here.",
      cost: "{1}{W}",
      back_face: { title: "Night's Whisper", flavor_text: '"Shh."\n-Liliana' },
      loyalty_abilities: [{ cost: "-3", text: "It can't block." }],
      saga_chapters: [{ numerals: [1], text: "- not a row list" }],
      saga_intro: "(As this Saga enters, it's yours.)",
    });
    expect(out).toEqual({
      title: "Urza’s Saga",
      rules_text: "Landfall — It’s here.",
      cost: "{1}{W}",
      back_face: { title: "Night’s Whisper", flavor_text: "“Shh.”\n—Liliana" },
      loyalty_abilities: [{ cost: "-3", text: "It can’t block." }],
      saga_chapters: [{ numerals: [1], text: "• not a row list" }],
      saga_intro: "(As this Saga enters, it’s yours.)",
    });
    const bare: { cost: string; title?: string } = { cost: "{W}" };
    expect(printTypographyPatch(bare)).toEqual({ cost: "{W}" });
  });
});

describe("the server's payload", () => {
  it("a new card is converted whole — both faces, subtypes and rows", () => {
    const out = withPrintTypography({
      title: "Urza's Saga",
      supertype: "Legendary",
      subtypes: ["Urza's", "Saga"],
      rules_text: "It can't attack.",
      flavor_text: '"No."\n-Urza',
      cost: "{1}",
      back_face: { title: "Night's Edge", subtypes: ["Bolas's"], rules_text: "Raid--Draw.", flavor_text: "'90s" },
    });
    expect(out).toEqual({
      title: "Urza’s Saga",
      supertype: "Legendary",
      subtypes: ["Urza’s", "Saga"],
      rules_text: "It can’t attack.",
      flavor_text: "“No.”\n—Urza",
      cost: "{1}",
      back_face: { title: "Night’s Edge", subtypes: ["Bolas’s"], rules_text: "Raid — Draw.", flavor_text: "’90s" },
    });
  });

  it("a walker's rows, and the serialized copy that follows them", () => {
    const abilities = [
      { cost: "+1", text: "It can't block." },
      { cost: "-3", text: "- Destroy it." },
      { cost: null, text: 'Creatures have "{T}: Draw."' },
    ];
    const out = withPrintTypography({ rules_text: serializeLoyalty(abilities), face_content: { v: 1, loyalty: { abilities } } });
    expect(out.face_content?.loyalty?.abilities.map((r) => r.text)).toEqual(["It can’t block.", "• Destroy it.", "Creatures have “{T}: Draw.”"]);
    // The copy is the ROWS', never a second reading of the joined text
    // (which would have read "-3: - Destroy" as a spaced dash).
    expect(out.rules_text).toBe(serializeLoyalty(out.face_content!.loyalty!.abilities));
    expect(out.rules_text).toBe("+1: It can’t block.\n-3: • Destroy it.\nCreatures have “{T}: Draw.”");
  });

  it("a saga's intro and chapters, and their copy", () => {
    const saga = { intro: "(It's a Saga.)", chapters: [{ numerals: [1, 2], text: "You can't lose." }, { numerals: [3], text: 'Say "done".' }] };
    const out = withPrintTypography({ rules_text: serializeSaga(saga.intro, saga.chapters), face_content: { v: 1, saga } });
    expect(out.face_content?.saga).toEqual({ intro: "(It’s a Saga.)", chapters: [{ numerals: [1, 2], text: "You can’t lose." }, { numerals: [3], text: "Say “done”." }] });
    expect(out.rules_text).toBe("(It’s a Saga.)\nI, II — You can’t lose.\nIII — Say “done”.");
  });

  it("an edit converts only the fields whose text the save changes", () => {
    const stored = {
      title: "Urza's Saga",
      supertype: null,
      subtypes: ["Urza's"],
      rules_text: "It can't attack.",
      flavor_text: '"No."',
      back_face: { title: "Night's Edge", rules_text: "It can't block.", flavor_text: null, subtypes: ["Bolas's"] },
      face_content: null,
    };
    // Everything resent as stored: nothing changes.
    const same = {
      title: "Urza's Saga",
      subtypes: ["Urza's"],
      rules_text: "It can't attack.",
      flavor_text: '"No."',
      back_face: { title: "Night's Edge", rules_text: "It can't block.", subtypes: ["Bolas's"] },
    };
    expect(withPrintTypographyUpdate(same, stored)).toEqual(same);
    // One field edited: that field whole, and nothing else.
    expect(withPrintTypographyUpdate({ ...same, rules_text: "It can't attack. It can't block either." }, stored)).toEqual({
      ...same,
      rules_text: "It can’t attack. It can’t block either.",
    });
    expect(withPrintTypographyUpdate({ ...same, back_face: { ...same.back_face, title: "Night's End", subtypes: ["Bolas's", "Urza's"] } }, stored)).toEqual({
      ...same,
      back_face: { title: "Night’s End", rules_text: "It can't block.", subtypes: ["Bolas's", "Urza’s"] },
    });
    // A field the patch does not name stays absent.
    expect(withPrintTypographyUpdate({ flavor_text: "It's new." }, stored)).toEqual({ flavor_text: "It’s new." });
  });

  it("an edit of a walker keeps the rows it did not change — in the copy too", () => {
    const storedRows = [{ cost: "+1", text: "It can't block." }, { cost: "-2", text: "Draw a card." }];
    const stored = { rules_text: serializeLoyalty(storedRows), face_content: { v: 1, loyalty: { abilities: storedRows } } };
    const abilities = [storedRows[0], { cost: "-2", text: "Draw a card. It's free." }];
    const out = withPrintTypographyUpdate({ rules_text: serializeLoyalty(abilities), face_content: { v: 1, loyalty: { abilities } } }, stored);
    expect(out.face_content?.loyalty?.abilities.map((r) => r.text)).toEqual(["It can't block.", "Draw a card. It’s free."]);
    expect(out.rules_text).toBe("+1: It can't block.\n-2: Draw a card. It’s free.");
    // Resent unchanged: untouched.
    const unchanged = { rules_text: stored.rules_text, face_content: { v: 1, loyalty: { abilities: storedRows } } };
    expect(withPrintTypographyUpdate(unchanged, stored)).toEqual(unchanged);
  });

  it("never grows a text past its limit", () => {
    const full = `${"a".repeat(3996)}b--c`;
    expect(full).toHaveLength(4000);
    expect(withPrintTypography({ rules_text: full }).rules_text).toBe(full);
    const room = `${"a".repeat(3990)}b--c`;
    expect(withPrintTypography({ rules_text: room }).rules_text).toBe(`${"a".repeat(3990)}b — c`);
  });
});

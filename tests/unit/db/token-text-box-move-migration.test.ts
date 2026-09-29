import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasRulesBoxText } from "@/lib/cards/card-display";
import { textBoxFrameFor } from "@/lib/creator/card-kinds";
import { basicLandManaKey } from "@/lib/cards/watermark";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.49 (b) — migration *_token_text_box_move.sql (found by name so a
// renumber at rebase doesn't break this). Stored cards with rules or flavour
// text move from the textless token frames to their text-box variations
// (m15token → m15tokentext, m15tokenartifact → m15tokenartifacttext), the
// frame the creator, the import and the AI jobs now pick for a token with
// text (owner decision 5), with a null render stamp so the automatic
// re-bake draws them on the box. "Has text" is the renderers' test
// (hasRulesBoxText, String.prototype.trim) — the SQL's bracket expression is
// held to the JS engine's own trim over every code point below.
//
// The UPDATE was also run on 2026-09-29 against a TEMP copy of the columns
// inside a rolled-back transaction (the local stack's Postgres 17.6, UTF8,
// en_US.UTF-8, standard_conforming_strings on): 89 rows — the six token /
// other templates × rules / flavour / both / none / empty, every card type,
// frame_style shapes, every code point trim removes alone and all together,
// 17 look-alikes it keeps (U+200B, U+180E, U+0085, U+001C–U+001F …) —
// UPDATE 32, exactly the rows ROWS' rule selects, every other frame_style key
// kept and every other stamp untouched; a second run UPDATE 0. The 33 public
// production rows (anonymous read, 2026-09-29): UPDATE 33, all to
// m15tokentext, then UPDATE 0.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_token_text_box_move\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const statements = body
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);
const stmt = statements[0] ?? "";
const where = stmt.slice(stmt.toLowerCase().indexOf(" where "));

/** The migration's own bracket expression, run by the JS regex engine (the
 *  \uXXXX escapes and ranges mean the same code points in both). */
function textPattern(): RegExp {
  const match = /~ '(\[\^[^']*\])'/.exec(where);
  if (!match) throw new Error("no text pattern in the WHERE clause");
  return new RegExp(match[1], "u");
}

/** The CASE's template pairs. */
function casePairs(): Array<[string, string]> {
  return [...stmt.matchAll(/when '([a-z0-9]+)' then '([a-z0-9]+)'/g)].map((m) => [m[1], m[2]]);
}

/** migration 0129's rule as the app reads it. */
type Row = {
  template: string | null;
  card_type: string | null;
  rules_text: string | null;
  flavor_text: string | null;
  /** cards.frame_preview (0121, NOT NULL default false). */
  frame_preview?: boolean;
};
function migrated(row: Row): string | null {
  const pairs = new Map(casePairs());
  const target = row.template ? pairs.get(row.template) : undefined;
  if (!target || row.card_type === "land" || row.frame_preview) return null;
  const text = (row.rules_text ?? "") + (row.flavor_text ?? "");
  return textPattern().test(text) ? target : null;
}

describe("0129 — stored cards with text move to the text-box token frames", () => {
  it("has its migration, numbered 0129", () => {
    expect(file).toBe("0129_token_text_box_move.sql");
  });

  it("is one UPDATE of public.cards — no DDL, no grants; it nulls the moved rows' render stamp", () => {
    expect(statements).toHaveLength(1);
    expect(stmt).toMatch(/^update public\.cards set frame_style = jsonb_set\( frame_style, '\{template\}', /i);
    expect(stmt).not.toMatch(/\b(create|alter|drop|grant|revoke|delete|insert|truncate)\b/i);
    const set = stmt.slice(0, stmt.toLowerCase().indexOf(" where "));
    expect(set).toMatch(/,\s*layout_version = null$/i);
    expect(stmt).not.toMatch(/rendered_image_url|rendered_thumb_url|rendered_at/i);
    expect(sql).toMatch(/Grants: none/);
    expect(sql).toMatch(/Ships through a PR; never applied ad-hoc\./);
  });

  it("maps each textless token frame to the variation the app's text rule picks", () => {
    const pairs = casePairs();
    expect(pairs).toEqual([
      ["m15token", "m15tokentext"],
      ["m15tokenartifact", "m15tokenartifacttext"],
    ]);
    for (const [from, to] of pairs) {
      expect(FRAME_TEMPLATE_VALUES).toContain(from);
      expect(FRAME_TEMPLATE_VALUES).toContain(to);
      expect(textBoxFrameFor("token", from as FrameTemplate, true)).toBe(to);
      expect(textBoxFrameFor("token", to as FrameTemplate, false)).toBe(from);
    }
    // …and every textless frame the rule dresses is in the move.
    for (const template of FRAME_TEMPLATE_VALUES) {
      const boxed = textBoxFrameFor("token", template, true);
      if (boxed !== template && textBoxFrameFor("token", template, false) === template) {
        expect(pairs.map(([from]) => from)).toContain(template);
      }
    }
    expect(where).toContain("frame_style ->> 'template' in ('m15token', 'm15tokenartifact')");
  });

  it("leaves an admin's frame preview on the combo it previews (TODO 2.3)", () => {
    // A preview is the evidence for its (template, colour), listed under that
    // template in /admin/frame-compare; the creator pins it the same way.
    expect(where).toContain("and not frame_preview");
  });

  it("leaves a land alone (the renderers print none of a basic land's text) — and only a land", () => {
    expect(where).toContain("and card_type is distinct from 'land'");
    // A token is never a basic land to the renderers, so for every other
    // card type "has text" is exactly hasRulesBoxText.
    for (const cardType of ["token", "creature", "artifact", "enchantment", "spell", null]) {
      expect(
        basicLandManaKey({ cardType, supertype: "Basic", subtypes: ["Wastes"], title: "Wastes", rulesText: "" }),
      ).toBeNull();
    }
  });

  it("\"has text\" is String.prototype.trim's: the bracket expression over every code point", () => {
    const pattern = textPattern();
    const mismatches: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates aren't text
      const char = String.fromCodePoint(cp);
      if (pattern.test(char) !== hasRulesBoxText({ rulesText: char })) {
        mismatches.push(cp.toString(16));
      }
    }
    expect(mismatches).toEqual([]);
  });

  const TRIM_ALL = "\t\n\u000b\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const ROWS: Array<Row & { after: string | null }> = [
    // Production's three shapes (2026-09-29): rules + flavour, rules only
    // (Ave c1182113, 264 characters), flavour only (Stalbokoblin 73dc31b0).
    { template: "m15token", card_type: "token", rules_text: "Flying", flavor_text: "Beware.", after: "m15tokentext" },
    { template: "m15token", card_type: "token", rules_text: "Flying", flavor_text: null, after: "m15tokentext" },
    { template: "m15token", card_type: "token", rules_text: null, flavor_text: "Enemies of the heir, beware.", after: "m15tokentext" },
    // The artifact dress keeps its dress.
    { template: "m15tokenartifact", card_type: "token", rules_text: "{T}, Sacrifice this token: Add one mana of any color.", flavor_text: null, after: "m15tokenartifacttext" },
    // No text: stays textless.
    { template: "m15token", card_type: "token", rules_text: null, flavor_text: null, after: null },
    { template: "m15token", card_type: "token", rules_text: "", flavor_text: "", after: null },
    { template: "m15token", card_type: "token", rules_text: TRIM_ALL, flavor_text: " \u3000 ", after: null },
    { template: "m15tokenartifact", card_type: "token", rules_text: "\n", flavor_text: null, after: null },
    // Characters trim keeps are text.
    { template: "m15token", card_type: "token", rules_text: "\u200b", flavor_text: null, after: "m15tokentext" },
    { template: "m15token", card_type: "token", rules_text: " \u180e ", flavor_text: null, after: "m15tokentext" },
    // Already on a text box, or another frame: untouched.
    { template: "m15tokentext", card_type: "token", rules_text: "Flying", flavor_text: null, after: null },
    { template: "alphatoken", card_type: "token", rules_text: "Flying", flavor_text: null, after: null },
    { template: "m15", card_type: "token", rules_text: "Flying", flavor_text: null, after: null },
    { template: null, card_type: "token", rules_text: "Flying", flavor_text: null, after: null },
    // Other card types on the token frame move; a land never does.
    { template: "m15token", card_type: "creature", rules_text: "Flying", flavor_text: null, after: "m15tokentext" },
    { template: "m15token", card_type: null, rules_text: "Flying", flavor_text: null, after: "m15tokentext" },
    { template: "m15token", card_type: "land", rules_text: "{T}: Add {C}.", flavor_text: null, after: null },
    // An admin's frame preview stays on the combo it previews.
    { template: "m15token", card_type: "token", rules_text: "Flying", flavor_text: null, frame_preview: true, after: null },
    { template: "m15tokenartifact", card_type: "token", rules_text: null, flavor_text: "Shiny.", frame_preview: true, after: null },
    { template: "m15token", card_type: "token", rules_text: "Flying", flavor_text: null, frame_preview: false, after: "m15tokentext" },
  ];
  for (const [index, row] of ROWS.entries()) {
    it(`row ${index + 1}: ${row.template ?? "{}"} ${row.card_type ?? "null"} ${JSON.stringify(row.rules_text)} / ${JSON.stringify(row.flavor_text)}${row.frame_preview ? " (frame preview)" : ""}`, () => {
      expect(migrated(row)).toBe(row.after);
      // The app agrees: a moved row is exactly a non-land on a textless
      // token frame with text the renderers would draw.
      const onTextless = row.template === "m15token" || row.template === "m15tokenartifact";
      const draws = hasRulesBoxText({ rulesText: row.rules_text, flavorText: row.flavor_text });
      expect(migrated(row) !== null).toBe(onTextless && row.card_type !== "land" && !row.frame_preview && draws);
      if (row.after) expect(row.after).toBe(textBoxFrameFor("token", row.template as FrameTemplate, true));
    });
  }

  it("names the public counts it was written against", () => {
    expect(sql).toMatch(/33 public cards\s+-- on the token frames, all on m15token/);
    expect(sql).toMatch(/all 33\s+-- move to m15tokentext; 0 on m15tokenartifact/);
  });

  it("lands every moved card on a combo seed.sql (production's verified list) holds in every colour", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(seed)?.[1].replace(/--.*$/gm, "") ?? "";
    const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
    for (const [, to] of casePairs()) expect(everyColour).toContain(`'${to}'`);
  });
});

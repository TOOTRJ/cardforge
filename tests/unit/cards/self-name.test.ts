import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { applyFrameAnatomyPatch } from "@/lib/cards/anatomy";
import { CR_SOURCE, KEYWORD_REMINDERS, keywordInsert } from "@/lib/cards/keyword-reminders";
import {
  backRulesTextWithSelfName,
  hasSelfNameToken,
  rulesTextWithSelfName,
  selfNameOf,
  selfReferenceFor,
  storedRulesTextWithSelfName,
  withSelfName,
  withSelfNames,
} from "@/lib/cards/self-name";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { frameAnatomyPatchSchema, frameStyleSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 6.2 — CARDNAME / `~` drawn as the card's printed name, at render time
// (lib/cards/self-name.ts), the gate for cards stored before it (migration
// 0142), the editor's "this …" words and the keyword data.
// ---------------------------------------------------------------------------

const M15 = getFrameProfile("m15");
const RETRO = getFrameProfile("retro");

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return { title: "Grizzly Bears", rulesText: "~ deals 3 damage to any target.", frameStyle: { template: "m15" }, ...over };
}

describe("the tokens", () => {
  it("are ~ and the word CARDNAME (capitals, whole word)", () => {
    expect(withSelfName("~ deals 3 damage. When CARDNAME dies, ~ returns.", "Kesh")).toBe("Kesh deals 3 damage. When Kesh dies, Kesh returns.");
    expect(withSelfName("cardname and CARDNAMES and Cardname", "Kesh")).toBe("cardname and CARDNAMES and Cardname");
    expect(hasSelfNameToken("no token here")).toBe(false);
    expect(hasSelfNameToken("~")).toBe(true);
    // The same string back when there is nothing to replace.
    const text = "Flying";
    expect(withSelfName(text, "Kesh")).toBe(text);
    expect(withSelfName(null, "Kesh")).toBeNull();
  });

  it("CARDNAME is a word by Unicode letters (as Postgres's \\m…\\M in 0142 reads it)", () => {
    expect(hasSelfNameToken("éCARDNAME")).toBe(false);
    expect(hasSelfNameToken("CARDNAMEé")).toBe(false);
    expect(hasSelfNameToken("CARDNAME_2")).toBe(false);
    expect(withSelfName("CARDNAME’s power", "Kesh")).toBe("Kesh’s power");
    expect(withSelfName("—CARDNAME—", "Kesh")).toBe("—Kesh—");
  });

  it("a face with no name keeps its ~ as typed (never “Untitled”)", () => {
    const out = withSelfNames(
      card({ rulesText: "Flying", backFace: { title: "  ", rules_text: "~ attacks." } as CardPreviewData["backFace"] }),
      M15,
    );
    expect(out.backFace?.rules_text).toBe("~ attacks.");
    expect(withSelfNames(card({ title: "" }), M15).rulesText).toBe("~ deals 3 damage to any target.");
  });

  it("a back's rules as its page describes it: its own name, as typed when flagged or unnamed", () => {
    const back = { title: "Bloodbat Summoner", rules_text: "~ attacks." };
    expect(backRulesTextWithSelfName(back, { template: "m15dfcfront" } as { selfName?: string })).toBe("Bloodbat Summoner attacks.");
    expect(backRulesTextWithSelfName(back, { selfName: "literal" })).toBe("~ attacks.");
    expect(backRulesTextWithSelfName({ ...back, title: "" }, null)).toBe("~ attacks.");
  });

  it("a name with a $ pattern in it is inserted as written", () => {
    expect(withSelfName("~ attacks.", "Mr. $& $1")).toBe("Mr. $& $1 attacks.");
  });
});

describe("the name ~ stands for", () => {
  it("is the nickname where the frame prints it, else the card's own name", () => {
    expect(selfNameOf({ title: "Fleecemane Lion", nickname: "Wakandan War Panther" }, M15)).toBe("Wakandan War Panther");
    expect(selfNameOf({ title: "Fleecemane Lion", nickname: "Wakandan War Panther" }, RETRO)).toBe("Fleecemane Lion");
    expect(selfNameOf({ title: "Fleecemane Lion", nickname: "  " }, M15)).toBe("Fleecemane Lion");
    expect(selfNameOf({ title: "  " }, M15)).toBeNull();
  });
});

describe("withSelfNames — what both renderers draw", () => {
  it("substitutes the rules text", () => {
    expect(withSelfNames(card(), M15).rulesText).toBe("Grizzly Bears deals 3 damage to any target.");
    expect(withSelfNames(card({ nickname: "Ursa Major" }), M15).rulesText).toBe("Ursa Major deals 3 damage to any target.");
  });

  it("returns the very card when there is nothing to substitute (every card without a token)", () => {
    const plain = card({ rulesText: "Flying" });
    expect(withSelfNames(plain, M15)).toBe(plain);
    const none = card({ rulesText: null });
    expect(withSelfNames(none, M15)).toBe(none);
  });

  it("leaves a card migration 0142 flagged exactly as typed", () => {
    const flagged = card({ frameStyle: { template: "m15", selfName: "literal" } });
    expect(withSelfNames(flagged, M15)).toBe(flagged);
  });

  it("substitutes a walker's and a saga's structured rows", () => {
    const walker = withSelfNames(
      card({
        rulesText: null,
        faceContent: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "~ deals 1 damage." }, { cost: null, text: "Flying" }] } },
      }),
      M15,
    );
    expect(walker.faceContent?.loyalty?.abilities.map((row) => row.text)).toEqual(["Grizzly Bears deals 1 damage.", "Flying"]);
    const saga = withSelfNames(
      card({ rulesText: null, faceContent: { v: 1, saga: { intro: "CARDNAME stirs.", chapters: [{ numerals: [1], text: "Exile ~." }] } } }),
      M15,
    );
    expect(saga.faceContent?.saga?.intro).toBe("Grizzly Bears stirs.");
    expect(saga.faceContent?.saga?.chapters[0]?.text).toBe("Exile Grizzly Bears.");
  });

  it("a second face / back draws ITS own name, never the front's nickname", () => {
    const out = withSelfNames(
      card({ nickname: "Ursa Major", rulesText: "Flying", backFace: { title: "Bloodbat Summoner", rules_text: "~ attacks." } as CardPreviewData["backFace"] }),
      M15,
    );
    expect(out.backFace?.rules_text).toBe("Bloodbat Summoner attacks.");
    expect(out.rulesText).toBe("Flying");
  });

  it("the card page reads the same text off the row", () => {
    const row = { title: "Fleecemane Lion", nickname: "Wakandan War Panther", rules_text: "~ has hexproof.", frame_style: { template: "m15" } };
    expect(storedRulesTextWithSelfName(row)).toBe("Wakandan War Panther has hexproof.");
    expect(storedRulesTextWithSelfName({ ...row, frame_style: { template: "retro" } })).toBe("Fleecemane Lion has hexproof.");
    expect(storedRulesTextWithSelfName({ ...row, frame_style: { template: "m15", selfName: "literal" } })).toBe("~ has hexproof.");
    expect(rulesTextWithSelfName({ ...row, nickname: null }, M15)).toBe("Fleecemane Lion has hexproof.");
  });
});

describe("the flag on a stored card", () => {
  it("is stored only as \"literal\"; an edit takes it off with \"name\" and nothing puts it back", () => {
    expect(frameStyleSchema.safeParse({ selfName: "literal" }).success).toBe(true);
    expect(frameStyleSchema.safeParse({ selfName: "name" }).success).toBe(false);
    expect(frameAnatomyPatchSchema.safeParse({ selfName: "name" }).success).toBe(true);
    expect(frameAnatomyPatchSchema.safeParse({ selfName: "literal" }).success).toBe(false);
    const applied = applyFrameAnatomyPatch(
      { frameStyle: { template: "m15", selfName: "literal" }, colorIdentity: ["red"], cardType: "creature" },
      { selfName: "name" },
    );
    expect(applied.ok && applied.frameStyle).toEqual({ template: "m15" });
    // An unrelated switch keeps the flag.
    const kept = applyFrameAnatomyPatch(
      { frameStyle: { template: "m15", selfName: "literal" }, colorIdentity: ["red"], cardType: "creature" },
      { crown: true },
    );
    expect(kept.ok && kept.frameStyle.selfName).toBe("literal");
  });

  it("the editor sends the switch only when the owner took the flag off", () => {
    const stored = { frame_style: { template: "m15", selfName: "literal" }, color_identity: ["red" as const] };
    expect(frameAnatomyPatchFor(stored, { frame_style: { template: "m15", selfName: "literal" }, color_identity: ["red"] })).toBeUndefined();
    expect(frameAnatomyPatchFor(stored, { frame_style: { template: "m15" }, color_identity: ["red"] })).toEqual({ selfName: "name" });
    expect(frameAnatomyPatchFor({ frame_style: { template: "m15" }, color_identity: ["red"] }, { frame_style: { template: "m15" }, color_identity: ["red"] })).toBeUndefined();
  });
});

describe("migration 0142 — the cards stored with a literal token", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => /^\d{4}_self_name_literal\.sql$/.test(f));
  const body = (file ? readFileSync(join(dir, file), "utf8") : "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("flags only frame_style, only rows holding a token, only once", () => {
    expect(file).toBeDefined();
    expect(body.match(/^\s*update public\.cards\b/gim)).toHaveLength(1);
    expect(body).toMatch(/set frame_style = coalesce\(frame_style, '\{\}'::jsonb\) \|\| '\{"selfName": "literal"\}'::jsonb/);
    expect(body).toMatch(/not \(coalesce\(frame_style, '\{\}'::jsonb\) \? 'selfName'\)/);
    for (const column of ["rules_text", "back_face->>'rules_text'", "face_content::text"]) expect(body).toContain(column);
    expect(body).not.toMatch(/flavor_text/);
    expect(body.match(/^\s*(create|grant|revoke|alter|insert|delete)\b/gim)).toBeNull();
  });

  it("reads the same tokens the renderers substitute", () => {
    expect(body).toContain("'~|\\mCARDNAME\\M'");
  });
});

describe("the editor's words", () => {
  it("\"this …\" follows the card's type and its self-naming subtypes", () => {
    expect(selfReferenceFor("creature")).toBe("this creature");
    expect(selfReferenceFor("artifact", ["Equipment"])).toBe("this Equipment");
    expect(selfReferenceFor("enchantment", ["aura"])).toBe("this Aura");
    expect(selfReferenceFor("artifact", ["Vehicle"])).toBe("this Vehicle");
    expect(selfReferenceFor("enchantment", ["Saga"])).toBe("this Saga");
    expect(selfReferenceFor("instant")).toBe("this spell");
    expect(selfReferenceFor("sorcery")).toBe("this spell");
    expect(selfReferenceFor("land")).toBe("this land");
    expect(selfReferenceFor(null)).toBe("this creature");
  });

  it("the keyword list is data: sourced, dated, one entry per keyword, CR-numbered", () => {
    expect(CR_SOURCE.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CR_SOURCE.url).toBe("https://magic.wizards.com/en/rules");
    const names = KEYWORD_REMINDERS.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
    for (const keyword of KEYWORD_REMINDERS) {
      expect(keyword.rule, keyword.name).toMatch(/^70[12]\.\d+$/);
      expect(keyword.reminder, keyword.name).not.toMatch(/[()]/);
      expect(keyword.reminder.endsWith("."), keyword.name).toBe(true);
      // Print's own characters (TODO 6.11): no straight quote or apostrophe.
      expect(keyword.reminder, keyword.name).not.toMatch(/['"]/);
    }
    for (const evergreen of ["Deathtouch", "Defender", "Double strike", "First strike", "Flash", "Flying", "Haste", "Hexproof", "Indestructible", "Lifelink", "Menace", "Reach", "Trample", "Vigilance", "Ward"]) {
      expect(names).toContain(evergreen);
    }
  });

  it("inserts the keyword, its reminder text only when asked for", () => {
    const flying = KEYWORD_REMINDERS.find((k) => k.name === "Flying")!;
    expect(keywordInsert(flying, false)).toBe("Flying");
    expect(keywordInsert(flying, true)).toBe("Flying (This creature can’t be blocked except by creatures with flying or reach.)");
  });
});

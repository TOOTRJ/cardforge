import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_FIELD_KEYS,
  AI_FIELD_PATHS,
  AI_TEXT_FIELD_KEYS,
  aiFieldClaims,
  aiFieldValue,
  aiProvenanceLabels,
  aiProvenanceOf,
  aiProvenanceSentence,
  fillWrittenParts,
  isAiArtUrl,
  recordAiOrigins,
  type AiFieldOrigins,
} from "@/lib/cards/ai-provenance";

// ---------------------------------------------------------------------------
// AI provenance's vocabulary (TODO CP1, lib/cards/ai-provenance.ts): the page's
// labels from the stored parts, the canonical value a claim is checked with,
// the creator's claims — and the one table the app and migration 0161 share.
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0161_card_ai_provenance.sql"), "utf8");
const USER = "11111111-1111-4111-8111-111111111111";
const AI_ART = `https://abc.supabase.co/storage/v1/object/public/card-art/${USER}/ai-0f3c.png`;

const card = {
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rules_text: "Flying, haste",
  flavor_text: "Its allies learned to fly behind it.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  back_face: null,
};
const ALL_FRONT = ["title", "cost", "type_line", "rules_text", "flavor_text", "stats"];

describe("the migration and the app name the same parts", () => {
  it("the CHECK lists every part, and nothing else", () => {
    const check = /ai_fields <@ array\[([\s\S]*?)\]::text\[\]/.exec(MIGRATION)?.[1] ?? "";
    const listed = [...check.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...AI_FIELD_KEYS].sort());
  });

  it("card_ai_field_paths is AI_FIELD_PATHS for every text part", () => {
    const body = /function public\.card_ai_field_paths\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(MIGRATION)?.[1] ?? "";
    const rows = [...body.matchAll(/\('([^']+)', array\[([^\]]+)\]\)/g)].map((m) => ({
      part: m[1]!,
      path: [...m[2]!.matchAll(/'([^']+)'/g)].map((p) => p[1]).join("."),
    }));
    const sql: Record<string, string[]> = {};
    for (const row of rows) (sql[row.part] ??= []).push(row.path);
    const app = Object.fromEntries(AI_TEXT_FIELD_KEYS.map((key) => [key, [...AI_FIELD_PATHS[key]]]));
    expect(sql).toEqual(app);
  });

  it("the art pattern is the database's", () => {
    expect(MIGRATION).toContain("'/storage/v1/object/public/card-art/[0-9a-fA-F-]{36}/ai-[^/]*$'");
    expect(isAiArtUrl(AI_ART)).toBe(true);
    // An upload, an import, a remix copy of an upload, a watermark: not AI.
    expect(isAiArtUrl(`https://abc.supabase.co/storage/v1/object/public/card-art/${USER}/0f3c.png`)).toBe(false);
    expect(isAiArtUrl(`https://abc.supabase.co/storage/v1/object/public/card-art/${USER}/remix-0f3c.png`)).toBe(false);
    expect(isAiArtUrl(`https://abc.supabase.co/storage/v1/object/public/card-art/${USER}/wm-0f3c.png`)).toBe(false);
    // A name merely CONTAINING "ai-" is not the AI art store's prefix.
    expect(isAiArtUrl(`https://abc.supabase.co/storage/v1/object/public/card-art/${USER}/rain-ai-0f3c.png`)).toBe(false);
    // Another bucket, a built-in picture, none.
    expect(isAiArtUrl(`https://abc.supabase.co/storage/v1/object/public/set-covers/${USER}/ai-0f3c.png`)).toBe(false);
    expect(isAiArtUrl("/defaults/avatars/avatar-01.webp")).toBe(false);
    expect(isAiArtUrl(null)).toBe(false);
  });

  it("the AI art store is the one writer of that prefix", () => {
    const art = readFileSync(join(process.cwd(), "lib/ai/random-art.ts"), "utf8");
    expect(art).toContain("const name = `ai-${randomId()}.${extension}`;");
    for (const file of ["lib/cards/upload-art-server.ts", "app/api/scryfall/import-art/route.ts", "lib/cards/upload-watermark-server.ts"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8"), file).not.toMatch(/`ai-/);
    }
  });
});

describe("what the card page says", () => {
  it("a card made by hand says nothing", () => {
    const provenance = aiProvenanceOf({ ...card, ai_fields: [] });
    expect(provenance).toEqual({ text: null, art: false });
    expect(aiProvenanceLabels(provenance)).toEqual([]);
    expect(aiProvenanceSentence(provenance)).toBeNull();
    // …and a row from a database 0161 hasn't reached.
    expect(aiProvenanceOf(card)).toEqual({ text: null, art: false });
  });

  it("every text part AI's = Card generated with AI; the art is its own label", () => {
    expect(aiProvenanceLabels(aiProvenanceOf({ ...card, ai_fields: ALL_FRONT }))).toEqual(["Card generated with AI"]);
    expect(aiProvenanceLabels(aiProvenanceOf({ ...card, ai_fields: [...ALL_FRONT, "art"] }))).toEqual([
      "Card generated with AI",
      "Art generated with AI",
    ]);
    expect(aiProvenanceSentence(aiProvenanceOf({ ...card, ai_fields: [...ALL_FRONT, "art"] }))).toBe("Card and art generated with AI.");
  });

  it("one part rewritten (dropped by the database) = AI helped with parts", () => {
    const rewritten = ALL_FRONT.filter((part) => part !== "rules_text");
    expect(aiProvenanceLabels(aiProvenanceOf({ ...card, ai_fields: rewritten }))).toEqual(["AI helped with parts of this card"]);
  });

  it("a part the maker ADDED to an AI card is not the AI's", () => {
    const noFlavour = { ...card, flavor_text: null };
    expect(aiProvenanceOf({ ...noFlavour, ai_fields: ALL_FRONT.filter((p) => p !== "flavor_text") }).text).toBe("card");
    expect(aiProvenanceOf({ ...card, ai_fields: ALL_FRONT.filter((p) => p !== "flavor_text") }).text).toBe("parts");
  });

  it("a stored part whose text is now empty counts for nothing", () => {
    expect(aiProvenanceOf({ ...card, flavor_text: null, ai_fields: ["flavor_text"] }).text).toBeNull();
  });

  it("the art alone, front or back", () => {
    expect(aiProvenanceLabels(aiProvenanceOf({ ...card, ai_fields: ["art"] }))).toEqual(["Art generated with AI"]);
    expect(aiProvenanceOf({ ...card, ai_fields: ["back.art"] }).art).toBe(true);
    expect(aiProvenanceSentence(aiProvenanceOf({ ...card, ai_fields: ["art", "title"] }))).toBe(
      "Art generated with AI; AI helped with parts of the text.",
    );
  });

  it("a second face's parts count with the front's", () => {
    const twoFaced = { ...card, back_face: { title: "Ashen Tyrant", rules_text: "Menace" } };
    expect(aiProvenanceOf({ ...twoFaced, ai_fields: ALL_FRONT }).text).toBe("parts");
    expect(aiProvenanceOf({ ...twoFaced, ai_fields: [...ALL_FRONT, "back.title", "back.rules_text"] }).text).toBe("card");
  });
});

describe("the canonical value of a part", () => {
  it("reads text as print sets it, a cost in pip order, an empty part as null", () => {
    expect(aiFieldValue("title", { title: "  Urza's Spark " })).toBe(aiFieldValue("title", { title: "Urza’s Spark" }));
    expect(aiFieldValue("rules_text", { rules_text: 'It says "hi" - twice.' })).toBe(aiFieldValue("rules_text", { rules_text: "It says “hi” — twice." }));
    expect(aiFieldValue("cost", { cost: "{R}{2}" })).toBe(aiFieldValue("cost", { cost: "{2}{R}" }));
    expect(aiFieldValue("flavor_text", { flavor_text: "   " })).toBeNull();
    expect(aiFieldValue("stats", { power: "", toughness: null })).toBeNull();
    expect(aiFieldValue("stats", { power: "2", toughness: "3" })).not.toBe(aiFieldValue("stats", { power: "2", toughness: "4" }));
    expect(aiFieldValue("type_line", { card_type: "creature", subtypes: ["Elf", "Druid"] })).not.toBe(
      aiFieldValue("type_line", { card_type: "creature", subtypes: ["Elf"] }),
    );
    expect(aiFieldValue("back.title", { back_face: { title: "Back" } })).toBe(JSON.stringify("Back"));
    expect(aiFieldValue("back.title", { back_face: null })).toBeNull();
  });
});

describe("the creator's claims", () => {
  const fill = { title: "Urza's Spark", rules_text: "Haste", power: "2", toughness: "1", loyalty: null, defense: null };

  it("a fill's parts are claimed while the payload still holds them", () => {
    const origins: AiFieldOrigins = new Map();
    recordAiOrigins(origins, fillWrittenParts(fill, { revise: false }), fill);
    const payload = { title: "Urza’s Spark", rules_text: "Haste", power: "2", toughness: "1" };
    expect(aiFieldClaims(origins, payload)).toEqual(["rules_text", "stats", "title"]);
  });

  it("a part the maker rewrote is no longer claimed — and claimed again when put back", () => {
    const origins: AiFieldOrigins = new Map();
    recordAiOrigins(origins, fillWrittenParts(fill, { revise: false }), fill);
    expect(aiFieldClaims(origins, { title: "Urza’s Spark", rules_text: "Haste, trample", power: "2", toughness: "1" })).toEqual(["stats", "title"]);
    expect(aiFieldClaims(origins, { title: "Urza’s Spark", rules_text: "Haste", power: "2", toughness: "1" })).toContain("rules_text");
  });

  it("a later fill of the same part replaces its origin", () => {
    const origins: AiFieldOrigins = new Map();
    recordAiOrigins(origins, ["title"], { title: "First" });
    recordAiOrigins(origins, ["title"], { title: "Second" });
    expect(aiFieldClaims(origins, { title: "First" })).toEqual([]);
    expect(aiFieldClaims(origins, { title: "Second" })).toEqual(["title"]);
  });

  it("a revise never takes the type; a second part's fields are its own parts", () => {
    expect(fillWrittenParts({ card_type: "creature", title: "X" }, { revise: true })).toEqual(["title"]);
    expect(fillWrittenParts({ card_type: "creature" }, { revise: false })).toEqual(["type_line"]);
    expect(fillWrittenParts({ back_face: { title: "B", rules_text: "R", power: "1" } }, { revise: false })).toEqual([
      "back.title",
      "back.rules_text",
      "back.stats",
    ]);
  });
});

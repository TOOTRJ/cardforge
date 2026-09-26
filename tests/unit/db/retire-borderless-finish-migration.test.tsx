import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { renderCardImage } from "@/lib/render/card-image";
import { frameStyleSchema } from "@/lib/validation/card";
import { CARD_FINISH_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Migration 0119 retires the dead "borderless" finish (TODO 0.25): every
// frame_style.finish "borderless" becomes "regular" — silently (owner
// decision 2026-09-26), because the cards already look the same. These tests
// pin:
//   * the migration's shape: one atomic DO block that disables ONLY
//     cards_set_updated_at around one guarded, idempotent UPDATE of
//     frame_style.finish, and re-enables it — so updated_at, the render
//     columns and layout_version never move;
//   * that no pixel changes: a "borderless" and a "regular" card bake
//     byte-identical PNGs and render identical preview markup (so the stored
//     bakes stay valid: no re-bake, no badge);
//   * that the app reads a legacy "borderless" as "regular".
// The SQL was also run on the local Supabase stack inside a rolled-back
// transaction (real 0032 / 0086 / 0104 / 0108 triggers: 4 fixture rows —
// public, unlisted, private remix, an extra frame_style key — reset with
// updated_at / rendered_at / layout_version / search_vector unchanged, 0
// notifications, every trigger enabled afterwards, a second run updates 0
// rows) and in autocommit mode on a throwaway database.
// ---------------------------------------------------------------------------

const FILE = "supabase/migrations/0119_retire_borderless_finish.sql";

/** The migration without comments, whitespace collapsed. */
function body(): string {
  return readFileSync(join(process.cwd(), FILE), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

const UPDATE =
  `update public.cards set frame_style = jsonb_set(frame_style, '{finish}', '"regular"'::jsonb) ` +
  `where frame_style ->> 'finish' = 'borderless';`;

describe("0119 — the borderless finish becomes regular", () => {
  it("is exactly one DO block: disable the updated_at trigger, the UPDATE, re-enable it", () => {
    // The whole file, exactly. An `or` in the WHERE clause would rewrite other
    // finishes; a SET on updated_at / rendered_* / layout_version would move a
    // column this must keep; losing the ENABLE would leave every later edit
    // without an updated_at bump.
    expect(body()).toBe(
      "do $$ declare reset_rows integer; begin " +
        "alter table public.cards disable trigger cards_set_updated_at; " +
        `${UPDATE} ` +
        "get diagnostics reset_rows = row_count; " +
        "alter table public.cards enable trigger cards_set_updated_at; " +
        "raise notice '0119: % card(s) moved from the borderless finish to regular', reset_rows; " +
        "end; $$;",
    );
  });

  it("disables only cards_set_updated_at, never every trigger", () => {
    const sql = body().toLowerCase();
    expect(sql).not.toMatch(/disable trigger (all|user)\b/);
    expect(sql).not.toMatch(/session_replication_role/);
    expect(sql.match(/disable trigger/g)).toHaveLength(1);
    expect(sql.match(/\benable trigger/g)).toHaveLength(1);
    expect(sql.indexOf("disable trigger")).toBeLessThan(sql.indexOf("update public.cards"));
    expect(sql.lastIndexOf("enable trigger cards_set_updated_at")).toBeGreaterThan(
      sql.indexOf("update public.cards"),
    );
  });

  it("the UPDATE writes frame_style.finish only, and matches only 'borderless' (idempotent)", () => {
    const sql = body();
    const update = sql.slice(sql.indexOf("update public.cards"), sql.indexOf(";", sql.indexOf("update public.cards")));
    const set = update.slice(0, update.indexOf(" where "));
    expect(set).toBe(
      `update public.cards set frame_style = jsonb_set(frame_style, '{finish}', '"regular"'::jsonb)`,
    );
    expect(set).not.toMatch(/updated_at|rendered_|layout_version|template/);
    // Every matched row is rewritten out of its own WHERE clause.
    expect(update.slice(update.indexOf(" where "))).toBe(` where frame_style ->> 'finish' = 'borderless'`);
    expect(sql).not.toMatch(/\b(create|drop|grant|revoke|delete|insert|truncate)\b/i);
  });

  it("targets a value the app no longer accepts as a finish, and reads it as the new one", () => {
    expect(CARD_FINISH_VALUES).not.toContain("borderless");
    expect(CARD_FINISH_VALUES).toContain("regular");
    expect(frameStyleSchema.parse({ finish: "borderless", template: "m15" })).toEqual({
      finish: "regular",
      template: "m15",
    });
  });
});

// ---------------------------------------------------------------------------
// No pixel moves: the renderers branch only on foil / etched / showcase, so a
// "borderless" card draws exactly like a "regular" one. Git frames (read from
// disk, deterministic): tarkirdragon carries one of production's 12 rows;
// modern stands in for m15, whose masters live in the frames bucket (the
// m15 bake comparison is in the PR evidence). Foil is the control that the
// comparison can see a finish at all.
// ---------------------------------------------------------------------------

function card(template: FrameTemplate, finish: string): CardPreviewData {
  return {
    title: "Smothering Tithe",
    cost: "{3}{W}",
    cardType: "enchantment",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

async function bakeHash(data: CardPreviewData): Promise<string> {
  // The stored bake's options (lib/cards/bake-render.ts): the "hd" preset,
  // and the display copy carries the brand mark and no footer text.
  const res = await renderCardImage(data, "hd", { brandMark: true, watermarkText: null });
  return createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
}

describe("0119 changes no pixels", () => {
  for (const template of ["tarkirdragon", "modern"] as const) {
    it(`${template}: a borderless-finish bake is byte-identical to a regular one`, async () => {
      const [borderless, regular, foil] = [
        await bakeHash(card(template, "borderless")),
        await bakeHash(card(template, "regular")),
        await bakeHash(card(template, "foil")),
      ];
      expect(borderless).toBe(regular);
      expect(foil).not.toBe(regular);
    }, 60_000);
  }

  it("the live preview draws the same markup for borderless and regular", () => {
    const markup = (finish: string) =>
      renderToStaticMarkup(<CardPreview {...card("m15", finish)} />);
    expect(markup("borderless")).toBe(markup("regular"));
    expect(markup("foil")).not.toBe(markup("regular"));
  });
});

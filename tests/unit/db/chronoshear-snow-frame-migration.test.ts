import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyForSweep,
  hasNewerLook,
  hasPendingCorrection,
} from "@/lib/cards/layout-version";
import { staleCountsByOwner } from "@/lib/cards/render-update-notify";
import { frameGateError } from "@/lib/cards/frame-availability";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { kindFromCard } from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// Migration 0117 moves ONE production card, Chronoshear Archivist (a blue
// artifact costing {2}{U}), from m15snowland to m15snow. Land frames hide the
// mana cost. Owner decision, 2026-09-25.
// These tests pin three things:
//   * the migration's shape: one id-targeted, guarded, idempotent UPDATE
//     that sets the null stamp in the same statement;
//   * what the null stamp does in the app: a platform re-bake, never an
//     owner badge or a render_update notification;
//   * that the owner can still save the card: m15snow/u is verified in
//     production (supabase/seed.sql mirrors it).
// The SQL itself was also run against a throwaway Postgres with the real
// cards triggers (0032 / 0086 / 0108): UPDATE 1, then UPDATE 0 on a re-run,
// UPDATE 0 when the owner had already re-framed the card, UPDATE 0 when the
// id doesn't exist, and no notification row.
// ---------------------------------------------------------------------------

const CARD_ID = "1b73a2d3-9361-48b4-91d8-f8e07f39cecb";
const FILE = "supabase/migrations/0117_chronoshear_archivist_snow_frame.sql";

function statements(): string[] {
  const sql = readFileSync(join(process.cwd(), FILE), "utf8");
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("0117 — Chronoshear Archivist moves to the Snow frame", () => {
  it("is a single UPDATE and contains no DDL or grants", () => {
    const stmts = statements();
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^update public\.cards set /i);
    expect(stmts[0]).not.toMatch(/\b(create|alter|drop|grant|revoke|delete|insert|truncate)\b/i);
  });

  it("targets that one id, and only while it is still on m15snowland", () => {
    const [stmt] = statements();
    // The whole statement, exactly: an `or` in the guard would re-frame every
    // m15snowland card, and dropping the template guard would overwrite a card
    // its owner has already re-framed.
    expect(stmt).toBe(
      `update public.cards set frame_style = jsonb_set(frame_style, '{template}', '"m15snow"'::jsonb), layout_version = null where id = '${CARD_ID}' and frame_style ->> 'template' = 'm15snowland'`,
    );
    // Rewriting the template drops the row out of its own WHERE clause, so a
    // second run is a no-op.
  });

  it("changes only frame_style.template (finish kept) and nulls the stamp in the same statement", () => {
    const [stmt] = statements();
    const set = stmt.slice(0, stmt.toLowerCase().indexOf(" where "));
    expect(set).toContain(`frame_style = jsonb_set(frame_style, '{template}', '"m15snow"'::jsonb)`);
    expect(set).toMatch(/layout_version = null/);
    // The stored render stays, so the row also stays in the compare page's
    // "marked" scope (null stamp + a render).
    expect(set).not.toMatch(/rendered_image_url|rendered_thumb_url|rendered_at/);
  });

  // The row as production will hold it after the migration.
  const after = {
    owner_id: "03ef9303-6035-4e0a-9a3d-6d1c59242c24",
    visibility: "public",
    layout_version: null,
    rendered_image_url: `https://auth.pipglyph.com/storage/v1/object/public/card-renders/x/${CARD_ID}.png?v=1`,
    frame_style: { finish: "regular", template: "m15snow" },
    rarity: "rare",
    set_icon_url: null,
    set_icon_code: null,
  };

  it("the null stamp means a platform re-bake: the sweep re-bakes it and downloads render live", () => {
    expect(classifyForSweep(after)).toBe("rebake");
    expect(hasPendingCorrection(after)).toBe(true);
  });

  it("never means an owner badge or a render_update notification", () => {
    expect(hasNewerLook(after)).toBe(false);
    expect(staleCountsByOwner([after]).size).toBe(0);
  });

  it("m15snow prints the mana cost; m15snowland hides it (the reason for the move)", () => {
    expect(getFrameProfile("m15snowland").hideCost).toBe(true);
    expect(getFrameProfile("m15snow").hideCost).toBeFalsy();
  });

  it("the owner can still save the card: m15snow/u is a verified combo in production", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(seed)?.[1] ?? "";
    const allColours = /unnest\(array\[([\s\S]*?)\]\) as t \(template\)/.exec(block)?.[1] ?? "";
    const colours = /unnest\(array\[([^\]]*)\]\) as c \(color_key\)/.exec(block)?.[1] ?? "";
    const lits = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const verified = new Set(
      lits(allColours).flatMap((t) => lits(colours).map((k) => frameComboKey(t, k))),
    );
    expect(verified.has("m15snow/u")).toBe(true);
    expect(frameGateError("m15snow", ["blue"], verified)).toBeNull();
    // Still an artifact in the creator. The template doesn't change the kind.
    expect(kindFromCard("artifact", "m15snow")).toBe("artifact");
  });
});

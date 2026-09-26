import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyForSweep,
  hasNewerLook,
  hasPendingCorrection,
} from "@/lib/cards/layout-version";
import { staleCountsByOwner } from "@/lib/cards/render-update-notify";
import { hasServableStoredRender } from "@/lib/render/stored-render";

// ---------------------------------------------------------------------------
// Migration 0118 marks the TWO production cards whose art is a sideways phone
// photo (EXIF orientation 6, TODO 3.14) for a platform re-bake. Found by a
// read-only scan of every public + unlisted card on 2026-09-25.
// These tests pin:
//   * the migration's shape: one UPDATE that only nulls the stamp, targeted
//     at exactly those ids AND the art file the scan read, idempotent;
//   * what the null stamp does in the app: a platform re-bake (downloads
//     render live meanwhile), never an owner badge or a notification.
// The SQL was also rehearsed on the local stack inside a rolled-back
// transaction with the real cards triggers (0032 / 0086 / 0104 / 0108):
// UPDATE 2, then UPDATE 0 on a re-run, UPDATE 1 when one owner had replaced
// the art, updated_at unchanged, no notification row, no other row touched.
// ---------------------------------------------------------------------------

const FILE = "supabase/migrations/0118_exif_orientation_rebake.sql";
const AFFECTED = [
  {
    id: "311ef220-1ced-4f03-a1bf-1fe881163e27",
    art: "https://auth.pipglyph.com/storage/v1/object/public/card-art/066276e3-5221-4a77-90a2-a8d804f36dce/b45adea7-daf1-4517-8155-5f623e3cf31e.jpg",
  },
  {
    id: "a20cb8ea-4b38-420a-b9fa-05c126f818e8",
    art: "https://auth.pipglyph.com/storage/v1/object/public/card-art/d67c5dab-9671-4111-b178-f4688840b7e9/a2608ff0-19e9-49a1-ac3b-15c592c32a2a.jpg",
  },
];

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

describe("0118 — the two sideways phone-photo cards are marked for a re-bake", () => {
  it("is a single UPDATE and contains no DDL or grants", () => {
    const stmts = statements();
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^update public\.cards as c set /i);
    expect(stmts[0]).not.toMatch(/\b(create|alter|drop|grant|revoke|delete|insert|truncate)\b/i);
  });

  it("is exactly the id + art-file targeted, idempotent statement", () => {
    const [stmt] = statements();
    // The whole statement, exactly: an `or`, a dropped art_url guard or a
    // missing id join would mark far more than two cards.
    const values = AFFECTED.map((a) => `('${a.id}'::uuid, '${a.art}')`).join(", ");
    expect(stmt).toBe(
      `update public.cards as c set layout_version = null from ( values ${values} ) as sideways (id, art_url) where c.id = sideways.id and c.art_url = sideways.art_url and c.layout_version is not null`,
    );
  });

  it("only nulls the stamp: the stored render stays (the row lands in the 'marked' scope)", () => {
    const [stmt] = statements();
    const set = stmt.slice(stmt.toLowerCase().indexOf(" set ") + 5, stmt.toLowerCase().indexOf(" from "));
    expect(set).toBe("layout_version = null");
  });

  // The row as production will hold it after the migration.
  const after = {
    owner_id: "066276e3-5221-4a77-90a2-a8d804f36dce",
    visibility: "public",
    layout_version: null,
    rendered_image_url: `https://auth.pipglyph.com/storage/v1/object/public/card-renders/066276e3-5221-4a77-90a2-a8d804f36dce/${AFFECTED[0].id}.png?v=1790366016718`,
    frame_style: { finish: "regular", template: "m15" },
    rarity: "common",
    set_icon_url: null,
    set_icon_code: null,
  };

  it("the null stamp means a platform re-bake, and downloads stop serving the sideways bake", () => {
    expect(classifyForSweep(after)).toBe("rebake");
    expect(hasPendingCorrection(after)).toBe(true);
    // A watermarked download renders live (upright, fixed code) until the
    // re-bake lands, instead of serving the stored sideways PNG.
    expect(hasServableStoredRender(after)).toBe(false);
  });

  it("never means an owner badge or a render_update notification", () => {
    expect(hasNewerLook(after)).toBe(false);
    expect(staleCountsByOwner([after]).size).toBe(0);
  });
});

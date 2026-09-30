import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_ART_INCOMING_BUCKET,
  CARD_ART_MAX_BYTES,
  CARD_ART_MAX_LABEL,
  CARD_ART_MIME_TYPES,
  cardArtFileProblem,
} from "@/lib/cards/art-upload-limits";

// ---------------------------------------------------------------------------
// TODO 6.10 (third item): card art up to 20 MiB, so a 2000×2800 lossless PNG
// — print-quality art for the 800 ppi export, 8–15 MiB — uploads. The ONE
// cap (lib/cards/art-upload-limits.ts) is what the creator checks, what the
// server actions check and, held here, what migration 0131 gives both the
// stored-art bucket and the private staging bucket the browser uploads into.
// ---------------------------------------------------------------------------

const MIB = 1024 * 1024;
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** The last migration's `storage.buckets` row for `id`: public, size, MIME. */
function lastBucketRow(id: string): { file: string; isPublic: string; size: number; mimes: string[] } {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  let found: { file: string; isPublic: string; size: number; mimes: string[] } | null = null;
  const row = new RegExp(
    `insert into storage\\.buckets[^;]*?values\\s*\\(\\s*'${id}',\\s*'${id}',\\s*(\\w+),\\s*(\\d+)[^,]*,\\s*array\\[([^\\]]*)\\]`,
    "i",
  );
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    const m = row.exec(sql);
    if (m) found = { file, isPublic: m[1], size: Number(m[2]), mimes: [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
  }
  if (!found) throw new Error(`no migration creates the ${id} bucket`);
  return found;
}

describe("the card-art cap", () => {
  it("is 20 MiB, said as 20 MB", () => {
    expect(CARD_ART_MAX_BYTES).toBe(20 * MIB);
    expect(CARD_ART_MAX_LABEL).toBe("20 MB");
  });

  it("covers a print-size lossless PNG: 2000×2800 incompressible 8-bit RGB is ~16 MiB", () => {
    // 3 bytes a pixel + a filter byte a row — the most an 8-bit RGB PNG of
    // the 800 ppi full-art slot can need before zlib saves anything.
    const worst = 2000 * 2800 * 3 + 2800;
    expect(worst).toBeLessThan(CARD_ART_MAX_BYTES);
    // …and the 2200×3000 bleed size too (6.1a).
    expect(2200 * 3000 * 3 + 3000).toBeLessThan(CARD_ART_MAX_BYTES);
  });

  it("migration 0131 gives card-art and the private staging bucket that cap and the same types", () => {
    const art = lastBucketRow("card-art");
    expect(art).toEqual({ file: "0131_card_art_upload_limit.sql", isPublic: "true", size: CARD_ART_MAX_BYTES, mimes: [...CARD_ART_MIME_TYPES] });
    const incoming = lastBucketRow(CARD_ART_INCOMING_BUCKET);
    expect(incoming).toEqual({ file: "0131_card_art_upload_limit.sql", isPublic: "false", size: CARD_ART_MAX_BYTES, mimes: [...CARD_ART_MIME_TYPES] });
  });

  it("0131 is idempotent and changes no grant or policy", () => {
    const sql = readFileSync(path.join(MIGRATIONS, "0131_card_art_upload_limit.sql"), "utf8");
    const body = sql.replace(/--[^\n]*/g, "");
    expect(body.match(/on conflict \(id\) do update/gi)).toHaveLength(2);
    expect(body).not.toMatch(/\b(grant|revoke|create policy|drop policy|alter policy|create table|create function)\b/i);
    expect(sql).toMatch(/Grants: none changed/);
  });
});

describe("cardArtFileProblem (the creator's early check)", () => {
  const file = (size: number, type = "image/png") => ({ size, type });

  it("takes a 12 MiB lossless PNG — which the old 8 MB cap refused", () => {
    expect(cardArtFileProblem(file(12 * MIB))).toBeNull();
    expect(cardArtFileProblem(file(8 * MIB + 1))).toBeNull();
    expect(cardArtFileProblem(file(CARD_ART_MAX_BYTES))).toBeNull();
  });

  it("refuses a file over 20 MB", () => {
    expect(cardArtFileProblem(file(CARD_ART_MAX_BYTES + 1))).toBe("That image is over 20 MB. Pick a smaller file.");
  });

  it("refuses what isn't an image, an image type the buckets don't take, and an empty file", () => {
    expect(cardArtFileProblem(file(1000, "text/plain"))).toBe("That doesn't look like an image.");
    expect(cardArtFileProblem(file(1000, ""))).toBe("That doesn't look like an image.");
    expect(cardArtFileProblem(file(1000, "image/heic"))).toBe("Only PNG, JPEG, WebP, and GIF images are allowed.");
    expect(cardArtFileProblem(file(1000, "image/svg+xml"))).toBe("Only PNG, JPEG, WebP, and GIF images are allowed.");
    expect(cardArtFileProblem(file(0))).toBe("Empty file.");
  });

  it("takes each of the four types", () => {
    for (const type of CARD_ART_MIME_TYPES) expect(cardArtFileProblem(file(1000, type)), type).toBeNull();
  });
});

describe("the creator's copy", () => {
  it("names the cap from the constant, never a literal", () => {
    const src = readFileSync(path.join(ROOT, "components/creator/art-uploader.tsx"), "utf8");
    expect(src).toContain("up to {CARD_ART_MAX_LABEL}");
    expect(src).not.toMatch(/\b8 MB\b|8 \* 1024 \* 1024/);
  });
});

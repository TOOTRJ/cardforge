import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedMediaUrl,
  MEDIA_KIND_BUCKETS,
  profileMediaSrc,
  type MediaKind,
} from "@/lib/media/media-urls";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import { defaultMediaFor, isDefaultProfileMedia } from "@/lib/profile/default-media";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// isAllowedMediaUrl — the display-side twin of migration 0127's media URL
// guards: a surface draws a user-media URL only when it is an object in OUR
// storage (the deployment's host or the legacy project host), in a bucket of
// that kind, directly in a user's folder (THAT user's, when the owner is
// known) — or a built-in image / a Google avatar / a Scryfall deck image
// where the product stores one. A row written before 0127 could hold any
// https URL; those are not drawn.
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const HOST = "https://auth.pipglyph.com";
const LEGACY = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const obj = (bucket: string, owner = ME, name = "x.png", host = HOST) =>
  `${host}/storage/v1/object/public/${bucket}/${owner}/${name}`;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));
afterEach(() => vi.unstubAllEnvs());

describe("isAllowedMediaUrl — storage kinds", () => {
  const kinds = Object.entries(MEDIA_KIND_BUCKETS) as [Exclude<MediaKind, "deck-card-image">, readonly string[]][];

  it.each(kinds)("%s: our host, its bucket(s), the owner's folder", (kind, buckets) => {
    for (const bucket of buckets) {
      expect(isAllowedMediaUrl(kind, obj(bucket), ME), bucket).toBe(true);
      expect(isAllowedMediaUrl(kind, obj(bucket, ME, "x.png", LEGACY), ME), `${bucket} legacy`).toBe(true);
      expect(isAllowedMediaUrl(kind, `${obj(bucket)}?v=17`, ME), `${bucket} ?v`).toBe(true);
    }
  });

  it.each(kinds)("%s: another user's folder only when no owner is asked for", (kind, buckets) => {
    expect(isAllowedMediaUrl(kind, obj(buckets[0], OTHER), ME)).toBe(false);
    expect(isAllowedMediaUrl(kind, obj(buckets[0], OTHER))).toBe(true);
  });

  it.each(kinds)("%s: refuses outside hosts, other buckets and odd keys", (kind, buckets) => {
    const wrongBucket = ["card-renders", "profile-media", "custom-pips", "card-art"].find((b) => !buckets.includes(b))!;
    for (const url of [
      "https://tracker.example/pixel.gif",
      `https://tracker.example/storage/v1/object/public/${buckets[0]}/${ME}/x.png`,
      `https://evil.supabase.co/storage/v1/object/public/${buckets[0]}/${ME}/x.png`,
      `https://auth.pipglyph.com@evil.example/storage/v1/object/public/${buckets[0]}/${ME}/x.png`,
      obj(wrongBucket),
      obj(buckets[0], ME, "sub/x.png"),
      obj(buckets[0], "not-a-uuid"),
      `${HOST}/storage/v1/object/public/${buckets[0]}/${ME}`,
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "",
      null,
      undefined,
    ]) {
      expect(isAllowedMediaUrl(kind, url, ME), String(url)).toBe(false);
    }
  });

  it("follows the configured storage host (a preview branch, the local stack)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(isAllowedMediaUrl("card-art", obj("card-art", ME, "x.png", "http://127.0.0.1:54321"), ME)).toBe(true);
    expect(isAllowedMediaUrl("card-art", obj("card-art"), ME)).toBe(false); // prod host isn't this deployment's
    expect(isAllowedMediaUrl("card-art", obj("card-art", ME, "x.png", LEGACY), ME)).toBe(true);
  });
});

describe("isAllowedMediaUrl — the non-storage exceptions", () => {
  it("built-in profile images for their own kind", () => {
    expect(isAllowedMediaUrl("avatar", "/defaults/avatars/avatar-25.webp", ME)).toBe(true);
    expect(isAllowedMediaUrl("banner", "/defaults/banners/banner-01.webp", ME)).toBe(true);
    expect(isAllowedMediaUrl("avatar", "/defaults/banners/banner-01.webp", ME)).toBe(false);
    expect(isAllowedMediaUrl("avatar", "/defaults/avatars/avatar-26.webp", ME)).toBe(false);
    expect(isAllowedMediaUrl("deck-cover", "/defaults/avatars/avatar-01.webp", ME)).toBe(false);
  });

  it("a Google profile picture for an avatar only (Google sign-ups)", () => {
    const google = "https://lh3.googleusercontent.com/a/ACg8ocK-abc_DEF=s96-c";
    expect(isAllowedMediaUrl("avatar", google, ME)).toBe(true);
    expect(isAllowedMediaUrl("banner", google, ME)).toBe(false);
    expect(isAllowedMediaUrl("card-art", google)).toBe(false);
    expect(isAllowedMediaUrl("avatar", "https://lh3.googleusercontent.com.evil.example/a.png", ME)).toBe(false);
  });

  it("PipGlyph's own built-in images as card art (the seed cards)", () => {
    expect(isAllowedMediaUrl("card-art", "https://pipglyph.com/defaults/avatars/avatar-07.webp")).toBe(true);
    expect(isAllowedMediaUrl("card-art", "/defaults/banners/banner-03.webp")).toBe(true);
    expect(isAllowedMediaUrl("card-art", "https://pipglyph.com.evil.example/defaults/avatars/avatar-07.webp")).toBe(false);
    expect(isAllowedMediaUrl("card-art", "https://pipglyph.com/defaults/avatars/avatar-07.webp?x")).toBe(false);
    expect(isAllowedMediaUrl("set-icon", "https://pipglyph.com/defaults/avatars/avatar-07.webp")).toBe(false);
  });

  it("a Scryfall printing image for a deck entry only", () => {
    const scry = "https://cards.scryfall.io/normal/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg?1562404626";
    expect(isAllowedMediaUrl("deck-card-image", scry)).toBe(true);
    expect(isAllowedMediaUrl("card-art", scry)).toBe(false);
    expect(isAllowedMediaUrl("deck-card-image", "https://c1.scryfall.com/file/x.jpg")).toBe(false);
    expect(isAllowedMediaUrl("deck-card-image", "https://cards.scryfall.io/../x.jpg")).toBe(false);
    expect(isAllowedMediaUrl("deck-card-image", obj("card-art"))).toBe(false);
  });
});

describe("profileMediaSrc — what a profile surface draws", () => {
  it("the profile's own picture when drawable, else a built-in picked from its id", () => {
    expect(profileMediaSrc("avatar", obj("profile-media"), ME)).toBe(obj("profile-media"));
    const fallback = profileMediaSrc("avatar", "https://tracker.example/me.png", ME)!;
    expect(isDefaultProfileMedia(fallback, "avatar")).toBe(true);
    expect(fallback).toBe(defaultMediaFor("avatar", ME)); // stable, not random
    expect(profileMediaSrc("banner", obj("profile-media", OTHER), ME)).toBe(defaultMediaFor("banner", ME));
    expect(profileMediaSrc("avatar", null, ME)).toBe(defaultMediaFor("avatar", ME));
    expect(profileMediaSrc("avatar", "https://tracker.example/me.png", null)).toBeNull();
  });

  it("spreads profiles across the built-in set", () => {
    const picks = new Set(
      Array.from({ length: 200 }, (_, i) => defaultMediaFor("avatar", `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`)),
    );
    expect(picks.size).toBeGreaterThan(15);
    for (const p of picks) expect(isDefaultProfileMedia(p, "avatar")).toBe(true);
  });
});

describe("drawableCardMedia — what both card renderers may draw", () => {
  const base: CardPreviewData = {
    title: "T",
    cost: null,
    cardType: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["white"],
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    frameStyle: { template: "m15" },
  };

  it("drops outside pictures and keeps ours (any folder: a pre-0127 remix shares its parent's art)", () => {
    const out = drawableCardMedia({
      ...base,
      artUrl: "https://tracker.example/art.png",
      setIconUrl: "https://tracker.example/icon.png",
      watermark: { kind: "custom", url: "https://tracker.example/wm.png" },
      backFace: { title: "B", art_url: "https://tracker.example/b.png" },
      pipOverrides: { W: "https://tracker.example/w.png", U: `${obj("custom-pips", OTHER, "U.png")}?v=2` },
      backCard: { ...base, artUrl: "https://tracker.example/back.png" },
    });
    expect(out.artUrl).toBeNull();
    expect(out.setIconUrl).toBeNull();
    expect(out.watermark).toBeNull();
    expect(out.backFace?.art_url).toBeUndefined();
    expect(out.backFace?.title).toBe("B");
    expect(out.pipOverrides).toEqual({ U: `${obj("custom-pips", OTHER, "U.png")}?v=2` });
    expect(out.backCard?.artUrl).toBeNull();

    const ours = drawableCardMedia({
      ...base,
      artUrl: obj("card-art", OTHER),
      setIconUrl: obj("set-covers"),
      watermark: { kind: "custom", url: obj("card-art", ME, "wm-1.png"), opacity: 0.4 },
      backFace: { title: "B", art_url: obj("card-art", ME, "b.png") },
    });
    expect(ours.artUrl).toBe(obj("card-art", OTHER));
    expect(ours.setIconUrl).toBe(obj("set-covers"));
    expect(ours.watermark).toEqual({ kind: "custom", url: obj("card-art", ME, "wm-1.png"), opacity: 0.4 });
    expect(ours.backFace?.art_url).toBe(obj("card-art", ME, "b.png"));
  });

  it("leaves presets and every other field alone", () => {
    const card = { ...base, watermark: { kind: "preset" as const, key: "rose" }, setIconCode: "dom", title: "Keep" };
    const out = drawableCardMedia(card);
    expect(out.watermark).toEqual({ kind: "preset", key: "rose" });
    expect(out.setIconCode).toBe("dom");
    expect(out.title).toBe("Keep");
  });
});

// The TS table and migration 0127's media_url_allowed() must agree, or the
// app would draw what the database refuses (or the other way round).
describe("the same rules as migration 0127", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0127_media_url_guards.sql"), "utf8");
  const fn = /create or replace function public\.media_url_allowed[\s\S]*?\$\$;/.exec(sql)![0];

  it("the kind → bucket table", () => {
    const table = /v_buckets := case p_kind([\s\S]*?)end;/.exec(fn)![1];
    const rows = Object.fromEntries(
      [...table.matchAll(/when '([a-z-]+)' then array\[([^\]]+)\]/g)].map(([, kind, list]) => [
        kind,
        [...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
      ]),
    );
    expect(rows).toEqual(MEDIA_KIND_BUCKETS);
  });

  it("the Scryfall, Google and built-in patterns", () => {
    expect(fn).toContain(String.raw`'^https://cards\.scryfall\.io/[A-Za-z0-9_./-]+(\?[0-9]{1,20})?$'`);
    expect(fn).toContain(String.raw`'^/defaults/avatars/avatar-(0[1-9]|1[0-9]|2[0-5])\.webp$'`);
    expect(fn).toContain(String.raw`'^/defaults/banners/banner-(0[1-9]|1[0-9]|2[0-5])\.webp$'`);
    for (let n = 1; n <= 26; n += 1) {
      const path = `/defaults/avatars/avatar-${String(n).padStart(2, "0")}.webp`;
      expect(new RegExp(String.raw`^/defaults/avatars/avatar-(0[1-9]|1[0-9]|2[0-5])\.webp$`).test(path)).toBe(
        isDefaultProfileMedia(path, "avatar"),
      );
    }
    expect(sql).toContain(String.raw`'^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_./=-]+$'`);
    // Built-in images as card art (the seed cards): the same pattern both sides.
    expect(fn).toContain(
      String.raw`p_url ~ '^(https://(www\.)?pipglyph\.com)?/defaults/(avatars/avatar|banners/banner)-(0[1-9]|1[0-9]|2[0-5])\.webp$'`,
    );
    expect(isAllowedMediaUrl("card-art", "https://www.pipglyph.com/defaults/banners/banner-25.webp")).toBe(true);
    expect(isAllowedMediaUrl("card-art", "https://pipglyph.com/defaults/banners/banner-26.webp")).toBe(false);
  });
});

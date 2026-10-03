import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allRenderObjectNames, CLEARED_RENDER_POINTERS, renderObjectNames } from "@/lib/cards/bake-core";
import { RENDER_NAME_SUFFIXES, bakeObjectCardId, isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { CARD_PICTURE_COLUMNS } from "@/lib/moderation/flagged-file";
// The sweep scripts can't import the TypeScript modules; they carry their own
// copy of the names, held to the code's here.
import {
  RENDER_NAME_SUFFIXES as SWEEP_SUFFIXES,
  URL_SOURCES,
  isServerMintedName,
  renderCardId,
} from "@/scripts/lib/storage-orphans.mjs";
import { RENDER_POINTER_COLUMNS, rendersByCard } from "@/scripts/lib/private-renders.mjs";
import { ROW_ACTIONS } from "@/scripts/lib/review-rescan.mjs";

// ---------------------------------------------------------------------------
// TODO 5.0a — a card's render names (design 2026-10-02 §3.3): FOUR, from the
// ONE list `renderObjectNames` (lib/cards/bake-core.ts) — the front's PNG +
// thumb and the back face's `.back.png` + `.back.thumb.webp` — recognised
// by every reader of a render name: the display check, the /render-cdn
// proxy's allow-list, the moderation hide / go-private / delete (through
// removeRenderObjects), and the orphan sweep (a `.back.png` of a live card is
// NEVER an orphan — before this it would have been swept, 5.0a's first
// job). And the pointer columns every "out of public view" path clears are
// the same everywhere.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUCKET = "https://auth.pipglyph.com/storage/v1/object/public/card-renders";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com"));
afterEach(() => vi.unstubAllEnvs());

describe("the one list", () => {
  it("renderObjectNames: the front pair, then the back pair, as bare names", () => {
    expect(renderObjectNames(CARD)).toEqual({
      png: `${CARD}.png`,
      thumb: `${CARD}.thumb.webp`,
      backPng: `${CARD}.back.png`,
      backThumb: `${CARD}.back.thumb.webp`,
    });
    expect(allRenderObjectNames(CARD)).toEqual([`${CARD}.png`, `${CARD}.thumb.webp`, `${CARD}.back.png`, `${CARD}.back.thumb.webp`]);
  });

  it("every name is `{cardId}` + one of RENDER_NAME_SUFFIXES, in the code and in the sweep", () => {
    const suffixes = allRenderObjectNames(CARD).map((name) => name.slice(CARD.length));
    expect(suffixes).toEqual([...RENDER_NAME_SUFFIXES]);
    expect([...SWEEP_SUFFIXES]).toEqual([...RENDER_NAME_SUFFIXES]);
  });
});

describe("the display check and the proxy's allow-list (lib/cards/render-cdn.ts)", () => {
  it("isStoredRenderUrl with a card accepts exactly that card's four names", () => {
    const card = { ownerId: OWNER, cardId: CARD };
    for (const name of allRenderObjectNames(CARD)) {
      expect(isStoredRenderUrl(`${BUCKET}/${OWNER}/${name}?v=1`, card), name).toBe(true);
    }
    for (const bad of [`${CARD}.front.png`, `${CARD}.back.jpg`, `${CARD}.back.back.png`, `${CARD}.thumb.back.webp`, `${CARD}.back`]) {
      expect(isStoredRenderUrl(`${BUCKET}/${OWNER}/${bad}`, card), bad).toBe(false);
    }
    // Another card's back is not this card's.
    expect(isStoredRenderUrl(`${BUCKET}/${OWNER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.back.png`, card)).toBe(false);
  });

  it("bakeObjectCardId answers the card for all four names (lower-cased), null for anything else", () => {
    for (const name of allRenderObjectNames(CARD)) {
      expect(bakeObjectCardId(`${OWNER}/${name}`), name).toBe(CARD);
      expect(bakeObjectCardId(`${OWNER.toUpperCase()}/${name.toUpperCase()}`), name).toBe(CARD);
    }
    for (const bad of [`${OWNER}/${CARD}.front.png`, `${OWNER}/${CARD}.back.jpg`, `${OWNER}/${CARD}.back.back.png`, `${OWNER}/${CARD}.back.thumb.png`, `${OWNER}/${CARD}.back`]) {
      expect(bakeObjectCardId(bad), bad).toBeNull();
    }
  });
});

describe("the orphan sweep (scripts/lib/storage-orphans.mjs, private-renders.mjs)", () => {
  it("renderCardId knows all four names — a live card's back bake is its card's, never an orphan", () => {
    for (const name of allRenderObjectNames(CARD)) {
      expect(renderCardId(`${OWNER}/${name}`), name).toBe(CARD);
    }
    expect(renderCardId(`${OWNER}/${CARD}.front.png`)).toBeNull();
  });

  it("the server-minted review list accepts all four names (a `.back.*` is never a hand-made upload)", () => {
    for (const name of allRenderObjectNames(CARD)) {
      expect(isServerMintedName("card-renders", `${OWNER}/${name}`), name).toBe(true);
    }
  });

  it("the private-renders mode groups all four names under their card", () => {
    const objects = allRenderObjectNames(CARD).map((name) => ({ bucket: "card-renders", path: `${OWNER}/${name}`, size: 1, etag: '"e"' }));
    const groups = rendersByCard(objects);
    expect(groups.get(CARD)!.map((o: { path: string }) => o.path)).toEqual(allRenderObjectNames(CARD).map((n) => `${OWNER}/${n}`));
  });
});

describe("the pointer columns every out-of-view path clears", () => {
  it("CLEARED_RENDER_POINTERS = the front pair, the back pair, rendered_at — and the private-renders script clears the same", () => {
    expect(Object.keys(CLEARED_RENDER_POINTERS)).toEqual([
      "rendered_image_url",
      "rendered_thumb_url",
      "rendered_back_image_url",
      "rendered_back_thumb_url",
      "rendered_at",
    ]);
    expect([...RENDER_POINTER_COLUMNS]).toEqual(Object.keys(CLEARED_RENDER_POINTERS));
  });

  it("the card columns a picture is drawn from name both faces' pointers, in the app and in both sweep modules", () => {
    const expected = ["art_url", "back_face", "set_icon_url", "watermark", "rendered_image_url", "rendered_thumb_url", "rendered_back_image_url", "rendered_back_thumb_url"];
    expect([...CARD_PICTURE_COLUMNS]).toEqual(expected);
    expect(URL_SOURCES.find((s: { table: string }) => s.table === "cards")?.columns).toEqual(expected);
    expect(ROW_ACTIONS.cards.columns).toEqual(expected);
  });
});

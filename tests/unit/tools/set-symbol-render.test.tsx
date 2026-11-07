import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import { SetSymbol } from "@/components/cards/set-symbol";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// A Set Symbol Studio icon stored as its `-auto` file follows the card's
// rarity in BOTH renderers: drawableCardMedia is the one step the live
// preview and the bake run on the card, and SetSymbol (the creator's own
// small previews) applies the same rule. Every other icon draws as stored.
// ---------------------------------------------------------------------------

const HOST = "https://auth.pipglyph.com";
const ME = "11111111-1111-4111-8111-111111111111";
const V = "a1b2c3d4-0000-4000-8000-00000000abcd";
const file = (variant: string) => `${HOST}/storage/v1/object/public/set-covers/${ME}/sym-${V}-${variant}.png`;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));
afterEach(() => vi.unstubAllEnvs());

const card = (setIconUrl: string, rarity: CardPreviewData["rarity"]) =>
  ({ setIconUrl, rarity }) as unknown as CardPreviewData;

describe("a rarity-following set icon", () => {
  it.each(["common", "uncommon", "rare", "mythic"] as const)("draws the %s file on a %s card", (rarity) => {
    expect(drawableCardMedia(card(file("auto"), rarity)).setIconUrl).toBe(file(rarity));
    const html = renderToStaticMarkup(<SetSymbol rarity={rarity} iconUrl={file("auto")} />);
    expect(html).toContain(`sym-${V}-${rarity}.png`);
  });

  it("a card with no rarity draws the common", () => {
    expect(drawableCardMedia(card(file("auto"), null)).setIconUrl).toBe(file("common"));
  });

  it("a plain studio file and an ordinary upload draw as stored", () => {
    expect(drawableCardMedia(card(file("plain"), "mythic")).setIconUrl).toBe(file("plain"));
    const upload = `${HOST}/storage/v1/object/public/set-covers/${ME}/icon-${V}.png`;
    expect(drawableCardMedia(card(upload, "mythic")).setIconUrl).toBe(upload);
  });

  it("an -auto file outside our storage is still refused", () => {
    const outside = `https://evil.example/storage/v1/object/public/set-covers/${ME}/sym-${V}-auto.png`;
    expect(drawableCardMedia(card(outside, "rare")).setIconUrl).toBeNull();
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO DK6.5: the deck hero's fan is a picture, not a control — no link, no
// button (the cards are listed with links below it); a PipGlyph card is its
// 600 px bake thumb, never the HD PNG; a printing is a 5:7 tile with the one
// card corner; the first card (a commander) is on top.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img data-next-image src={src} alt={alt} />,
}));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));

import { DeckCardFan } from "@/components/decks/deck-card-fan";
import type { FeaturedCard } from "@/lib/decks/featured";
import type { Card } from "@/types/card";

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const render_ = (suffix: string) => `${HOST}/storage/v1/object/public/card-renders/${OWNER}/${ID}${suffix}?v=1`;

const custom: FeaturedCard<Card> = {
  kind: "custom",
  key: `card:${ID}`,
  title: "Vipara",
  card: {
    id: ID,
    owner_id: OWNER,
    title: "Vipara",
    visibility: "public",
    rendered_image_url: render_(".png"),
    rendered_thumb_url: render_(".thumb.webp"),
    frame_style: { template: "m15" },
    art_position: {},
    color_identity: ["black"],
    subtypes: [],
  } as unknown as Card,
};
const printing = (name: string): FeaturedCard<Card> => ({
  kind: "printing",
  key: `print:${name}`,
  title: name,
  imageUrl: `https://cards.scryfall.io/normal/front/a/b/${name}.jpg`,
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DeckCardFan", () => {
  it("draws nothing for an empty fan", () => {
    const { container } = render(<DeckCardFan cards={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("is a labelled list of pictures with no link or button, the first card on top", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    render(<DeckCardFan cards={[custom, printing("Sol Ring"), printing("Opt"), printing("Ponder")]} />);
    const list = screen.getByRole("list", { name: "Featured cards" });
    expect(within(list).queryAllByRole("link")).toEqual([]);
    expect(within(list).queryAllByRole("button")).toEqual([]);
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    const layers = items.map((li) => Number(li.style.zIndex));
    expect(layers[0]).toBe(Math.max(...layers));
    expect(new Set(layers).size).toBe(layers.length);
  });

  it("a PipGlyph card is its bake THUMB (never the HD PNG); a printing sits on a 5:7 tile with the card corner", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    render(<DeckCardFan cards={[custom, printing("Sol Ring")]} />);
    const thumb = screen.getByRole("img", { name: "Vipara" }) as HTMLImageElement;
    expect(thumb.src).toContain(".thumb.webp");
    expect(document.querySelector("[data-next-image]")).toBeNull();
    const print = screen.getByRole("img", { name: "Sol Ring" });
    expect(print.parentElement?.className).toContain("aspect-[5/7]");
    expect(print.parentElement?.className).toContain("card-corners");
  });
});

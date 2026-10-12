// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 5.15 (owner 2026-10-12, decisions 3 + 4): where a card's picture is
// too small to turn — My Cards' list view, the deck list's rows — a card
// with a back PICTURE carries a small "2 faces" text mark, and the deck's
// card pop-up gets a Front / Back switch. An older two-faced card with no
// back picture shows nothing anywhere. ONE predicate decides
// (lib/cards/tile-faces.ts) — the one the grid tile's button reads.
// ---------------------------------------------------------------------------

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/cards/baked-card-thumbnail", () => ({
  BakedCardThumbnail: (props: { title: string }) => <div data-testid="thumb">{props.title}</div>,
}));
vi.mock("@/components/cards/quick-like-button", () => ({ QuickLikeButton: () => null }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
}));

import { hasBackPicture, tileBackThumbOf } from "@/lib/cards/tile-faces";
import { LikedCardListRow, MyCardListRow } from "@/components/creator/my-cards-list-row";
import type { DashboardCard } from "@/components/creator/dashboard-card-tile";
import { DeckCardList } from "@/components/decks/deck-card-list";
import type { DeckItem } from "@/lib/decks/queries";
import type { CardWithStats } from "@/lib/cards/queries";

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;
const ID = "11111111-1111-4111-8111-111111111111";

const POINTERS = {
  rendered_image_url: `${RENDERS}/${ID}.png?v=1`,
  rendered_thumb_url: `${RENDERS}/${ID}.thumb.webp?v=1`,
  rendered_back_image_url: `${RENDERS}/${ID}.back.png?v=1`,
  rendered_back_thumb_url: `${RENDERS}/${ID}.back.thumb.webp?v=1`,
};
/** An older two-faced card: a back face in its data, a front bake, no back picture. */
const LEGACY = { ...POINTERS, rendered_back_image_url: null, rendered_back_thumb_url: null };
/** A card whose pointers an edit has just cleared (the bake is on its way). */
const MID_SAVE = {
  rendered_image_url: null,
  rendered_thumb_url: null,
  rendered_back_image_url: null,
  rendered_back_thumb_url: null,
};

const card = (overrides: Record<string, unknown> = {}) =>
  ({
    id: ID,
    slug: "village-elder",
    title: "Village Elder",
    visibility: "unlisted",
    supertype: null,
    card_type: "creature",
    subtypes: ["Human"],
    cost: "{1}{G}",
    frame_style: { template: "m15dfcfront" },
    back_face: { title: "Elder Wolf", card_type: "creature", frame_style: { template: "m15dfcback" } },
    likes_count: 0,
    updated_at: "2026-10-12T10:00:00Z",
    owner: { username: "kesh" },
    ...POINTERS,
    ...overrides,
  }) as unknown as DashboardCard & CardWithStats;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("which cards are two-faced with a back picture (lib/cards/tile-faces.ts)", () => {
  it("a stored back thumb beside a stored front bake and thumb, on a portrait frame", () => {
    expect(tileBackThumbOf(card())).toBe(POINTERS.rendered_back_thumb_url);
    expect(hasBackPicture(card())).toBe(true);
  });

  it("not an older two-faced card, a card mid-save, a front without its thumb, a URL that isn't our bake, or a landscape frame", () => {
    expect(hasBackPicture(card(LEGACY))).toBe(false);
    expect(hasBackPicture(card(MID_SAVE))).toBe(false);
    expect(hasBackPicture(card({ rendered_thumb_url: null }))).toBe(false);
    expect(hasBackPicture(card({ rendered_back_thumb_url: "https://evil.example/back.webp" }))).toBe(false);
    expect(
      hasBackPicture(card({ rendered_back_thumb_url: `${HOST}/storage/v1/object/public/card-art/owner-1/raw.png` })),
    ).toBe(false);
    expect(hasBackPicture(card({ frame_style: { template: "battle" } }))).toBe(false);
  });
});

describe("My Cards' list view — the \"2 faces\" text mark", () => {
  const own = (c: DashboardCard) =>
    render(
      <ul>
        <MyCardListRow card={c} isSelected={false} selectMode={false} onToggle={() => {}} />
      </ul>,
    );

  it("a card with a back picture carries the mark; it is text, not a control", () => {
    own(card());
    const mark = screen.getByTestId("two-faces-mark");
    expect(mark.textContent).toBe("2 faces");
    expect(mark.tagName).toBe("SPAN");
    expect(mark.closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /face of/ })).toBeNull();
  });

  it.each([
    ["an older two-faced card", LEGACY],
    ["a card mid-save", MID_SAVE],
    ["a one-faced card", { ...LEGACY, back_face: null, frame_style: { template: "m15" } }],
  ])("%s carries none", (_name, overrides) => {
    own(card(overrides));
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
  });

  it("the Liked list row marks the same cards", () => {
    render(
      <ul>
        <LikedCardListRow card={card()} />
      </ul>,
    );
    expect(screen.getByTestId("two-faces-mark").textContent).toBe("2 faces");
    cleanup();
    render(
      <ul>
        <LikedCardListRow card={card(LEGACY)} />
      </ul>,
    );
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
  });
});

describe("the deck page — the list's mark and the pop-up's Front / Back switch", () => {
  const item = (overrides: Record<string, unknown> = {}, entry: Record<string, unknown> = {}): DeckItem =>
    ({
      entry: {
        id: "22222222-2222-4222-8222-222222222222",
        deck_id: "33333333-3333-4333-8333-333333333333",
        card_id: ID,
        scryfall_id: null,
        name: "Village Elder",
        quantity: 2,
        board: "main",
        type_line: "Creature — Human",
        mana_cost: "{1}{G}",
        image_url: null,
        set_code: null,
        collector_number: null,
        ...entry,
      },
      card: card(overrides),
    }) as unknown as DeckItem;

  const list = (items: DeckItem[]) => render(<DeckCardList items={items} ownerUsername="kesh" canManage={false} />);
  const imgs = () => Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));

  it("a row whose proxy has a back picture carries the mark, and draws the 600 px thumb — never the HD PNG", () => {
    list([item()]);
    const row = screen.getByRole("button", { name: "Open Village Elder" });
    expect(row.querySelector("[data-testid=two-faces-mark]")?.textContent).toBe("2 faces");
    expect(imgs()).toEqual([`/render-cdn/owner-1/${ID}.thumb.webp?v=1`]);
  });

  it("an older two-faced proxy carries no mark, and its pop-up no switch", async () => {
    list([item(LEGACY)]);
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByTestId("deck-card-face-switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("the pop-up shows the front with a Front / Back switch; the back's file is asked for only once Back is chosen", async () => {
    list([item()]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    const dialog = screen.getByRole("dialog");
    const group = screen.getByRole("group", { name: "Card face" });
    const front = screen.getByRole("button", { name: "Front" });
    const back = screen.getByRole("button", { name: "Back" });
    expect(group.contains(front) && group.contains(back)).toBe(true);
    expect(front.getAttribute("aria-pressed")).toBe("true");
    expect(back.getAttribute("aria-pressed")).toBe("false");
    // Thumb-sized targets.
    expect(back.className.split(/\s+/)).toContain("min-h-11");
    const shown = () => Array.from(dialog.querySelectorAll("img")).map((img) => [img.getAttribute("src"), img.getAttribute("alt")]);
    expect(shown()).toEqual([[POINTERS.rendered_image_url, "Village Elder"]]);

    await act(async () => {
      fireEvent.click(back);
    });
    expect(back.getAttribute("aria-pressed")).toBe("true");
    expect(front.getAttribute("aria-pressed")).toBe("false");
    expect(shown()).toEqual([[POINTERS.rendered_back_image_url, "Village Elder (back face)"]]);
    // The switch never moved focus off itself or closed the pop-up.
    expect(screen.getByRole("dialog")).toBe(dialog);

    await act(async () => {
      fireEvent.click(front);
    });
    expect(shown()).toEqual([[POINTERS.rendered_image_url, "Village Elder"]]);
  });

  it("the switch belongs to the proxy: showing the ORIGINAL printing hides it (and the row's mark)", async () => {
    const original = "https://cards.scryfall.io/normal/front/a/b/abc.jpg";
    list([item({}, { scryfall_id: "44444444-4444-4444-8444-444444444444", image_url: original })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Showing my proxies" }));
    });
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    expect(screen.queryByTestId("deck-card-face-switch")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "My proxy" }));
    });
    expect(screen.getByTestId("deck-card-face-switch")).toBeTruthy();
  });
});

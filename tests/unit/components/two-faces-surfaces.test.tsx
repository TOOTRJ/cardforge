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

  it("not an older two-faced card, a card mid-save, a front without its thumb, a URL that isn't our bake, or a landscape frame — but the BATTLE (TODO 5.5: its back is portrait)", () => {
    expect(hasBackPicture(card(LEGACY))).toBe(false);
    expect(hasBackPicture(card(MID_SAVE))).toBe(false);
    expect(hasBackPicture(card({ rendered_thumb_url: null }))).toBe(false);
    expect(hasBackPicture(card({ rendered_back_thumb_url: "https://evil.example/back.webp" }))).toBe(false);
    expect(
      hasBackPicture(card({ rendered_back_thumb_url: `${HOST}/storage/v1/object/public/card-art/owner-1/raw.png` })),
    ).toBe(false);
    expect(hasBackPicture(card({ frame_style: { template: "split" } }))).toBe(false);
    expect(hasBackPicture(card({ frame_style: { template: "battle" } }))).toBe(true);
    expect(hasBackPicture(card({ frame_style: { template: "battle" }, rendered_back_thumb_url: null }))).toBe(false);
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

  it("a row whose bake has NO thumb (baked before thumbnails) still shows its picture — the HD PNG, as before — and no mark", () => {
    list([item({ rendered_thumb_url: null })]);
    expect(imgs()).toEqual([`${RENDERS}/${ID}.png?v=1`]);
    // No front thumb: not a card a tile could turn, so no mark either.
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
    cleanup();
    // …and a thumb that is not our bake is skipped for the PNG, never drawn.
    list([item({ rendered_thumb_url: "https://evil.example/x.webp" })]);
    expect(imgs()).toEqual([`${RENDERS}/${ID}.png?v=1`]);
    cleanup();
    // A card mid-save (no pointers at all): the placeholder, nothing broken.
    list([item(MID_SAVE)]);
    expect(imgs()).toEqual([]);
    expect(screen.getByRole("button", { name: "Open Village Elder" })).toBeTruthy();
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
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

  it("the pop-up's PICTURE link opens the face it shows: the card page on its back with Back chosen (TODO 5.17)", async () => {
    list([item()]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    const dialog = screen.getByRole("dialog");
    const pictureLink = () => dialog.querySelector("img")!.closest("a")!;
    expect(pictureLink().getAttribute("href")).toBe("/card/kesh/village-elder");
    expect(pictureLink().getAttribute("aria-label")).toBe("Open this card's page");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(pictureLink().getAttribute("href")).toBe("/card/kesh/village-elder?face=back");
    expect(pictureLink().getAttribute("aria-label")).toBe("Open this card's page on its back face");
    // The title and the text link name the card, not a face.
    const others = Array.from(dialog.querySelectorAll("a[href^='/card/']")).filter((a) => a !== pictureLink());
    expect(others.length).toBeGreaterThan(0);
    for (const a of others) expect(a.getAttribute("href")).toBe("/card/kesh/village-elder");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Front" }));
    });
    expect(pictureLink().getAttribute("href")).toBe("/card/kesh/village-elder");
  });

  it("an older two-faced proxy's picture link never names a face", async () => {
    list([item(LEGACY)]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    const link = screen.getByRole("dialog").querySelector("img")!.closest("a")!;
    expect(link.getAttribute("href")).toBe("/card/kesh/village-elder");
  });

  it("closing the pop-up returns the focus to the row that opened it (TODO 5.17) — Escape, and the close button", async () => {
    const second = "55555555-5555-4555-8555-555555555555";
    list([item(), item({ title: "Other Card", slug: "other-card" }, { id: second, name: "Other Card" })]);
    const row = screen.getByRole("button", { name: "Open Other Card" });
    expect(row.getAttribute("data-deck-entry")).toBe(second);
    row.focus();
    await act(async () => {
      fireEvent.click(row);
    });
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Other Card" }));

    // Opened by a click with the focus elsewhere: still the row that opened it.
    (document.activeElement as HTMLElement).blur();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Village Elder" }));
  });

  describe("the focus after the pop-up when the plain hand-back is not enough (the check of #536)", () => {
    const ids = ["a", "b", "c"].map((_, i) => `6666666${i}-6666-4666-8666-666666666666`);
    const three = () =>
      ids.map((id, i) => item({ title: `Card ${i + 1}`, slug: `card-${i + 1}` }, { id, name: `Card ${i + 1}` }));
    const rowOf = (n: number) => screen.getByRole("button", { name: `Open Card ${n}` });
    const openRow = async (n: number) => {
      rowOf(n).focus();
      await act(async () => {
        fireEvent.click(rowOf(n));
      });
      expect(screen.getByRole("dialog")).toBeTruthy();
    };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("a click on the backdrop: the click's own mousedown blurs the row after the close — the focus is handed back again once the click is over", async () => {
      list(three());
      await openRow(2);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      });
      expect(document.activeElement).toBe(rowOf(2));
      // What a browser does next on a backdrop click (the dialog closed on
      // pointerdown; mousedown on a non-focusable backdrop focuses <body>).
      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(document.activeElement).toBe(rowOf(2));
    });

    it("the entry is removed while its pop-up is open (the refresh lands first): the focus goes to the row that took its place, not to <body>", async () => {
      const { rerender } = list(three());
      await openRow(2);
      const [first, , third] = three();
      await act(async () => {
        rerender(<DeckCardList items={[first, third]} ownerUsername="kesh" canManage={false} />);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(rowOf(3));
    });

    it("the entry is removed just AFTER the close (the removal answers once the pop-up has shut): the focus moves on from the row that goes", async () => {
      const { rerender } = list(three());
      await openRow(3);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        vi.advanceTimersByTime(0);
      });
      expect(document.activeElement).toBe(rowOf(3));
      const [first, second] = three();
      await act(async () => {
        rerender(<DeckCardList items={[first, second]} ownerUsername="kesh" canManage={false} />);
      });
      // The last row went: the one before it.
      expect(document.activeElement).toBe(rowOf(2));
    });

    it("the last entry of the deck is removed: the list's first control, never <body>; and a focus the reader moved elsewhere is left alone", async () => {
      const { rerender } = list(three().slice(0, 1));
      await openRow(1);
      await act(async () => {
        rerender(<DeckCardList items={[]} ownerUsername="kesh" canManage={false} />);
      });
      expect(document.activeElement).not.toBe(document.body);
      cleanup();

      const again = list(three());
      await openRow(1);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        vi.advanceTimersByTime(0);
      });
      // The reader tabs on to another row; the first one is then removed.
      await act(async () => {
        fireEvent.blur(rowOf(1), { relatedTarget: rowOf(3) });
        rowOf(3).focus();
      });
      const [, second, third] = three();
      await act(async () => {
        again.rerender(<DeckCardList items={[second, third]} ownerUsername="kesh" canManage={false} />);
      });
      expect(document.activeElement).toBe(rowOf(3));
    });
  });

  it("the switch belongs to the custom card: showing the REAL card's printing hides it (and the row's mark)", async () => {
    const original = "https://cards.scryfall.io/normal/front/a/b/abc.jpg";
    list([item({}, { scryfall_id: "44444444-4444-4444-8444-444444444444", image_url: original })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Showing custom cards" }));
    });
    expect(screen.queryByTestId("two-faces-mark")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Village Elder" }));
    });
    expect(screen.queryByTestId("deck-card-face-switch")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Custom card" }));
    });
    expect(screen.getByTestId("deck-card-face-switch")).toBeTruthy();
  });
});

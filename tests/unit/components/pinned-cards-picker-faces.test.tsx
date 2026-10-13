// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 5.15: the pinned-cards picker (Settings). Its tile IS the pin toggle —
// one <button> around the picture and the title — so it can never hold the
// grid's "2 faces" button (a button inside a button). A card with a back
// picture carries the TEXT mark instead; an older two-faced card and a card
// mid-save carry nothing. The real BakedCardThumbnail is rendered here: the
// picker must not hand it the back thumb.
// ---------------------------------------------------------------------------

vi.mock("@/app/(app)/settings/actions", () => ({ updatePinnedCardsAction: vi.fn() }));
vi.mock("@/lib/cards/preview-data", () => ({
  cardToPreviewData: (row: { title: string; frame_style: unknown }) => ({ title: row.title, frameStyle: row.frame_style }),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="live-preview" />,
}));

import { PinnedCardsPicker } from "@/components/auth/pinned-cards-picker";
import type { CardWithStats } from "@/lib/cards/queries";

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;
const id = (n: number) => `1111111${n}-1111-4111-8111-111111111111`;

const card = (n: number, title: string, overrides: Record<string, unknown> = {}) =>
  ({
    id: id(n),
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    frame_style: { template: "m15dfcfront" },
    rendered_image_url: `${RENDERS}/${id(n)}.png?v=1`,
    rendered_thumb_url: `${RENDERS}/${id(n)}.thumb.webp?v=1`,
    rendered_back_image_url: `${RENDERS}/${id(n)}.back.png?v=1`,
    rendered_back_thumb_url: `${RENDERS}/${id(n)}.back.thumb.webp?v=1`,
    ...overrides,
  }) as unknown as CardWithStats;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("PinnedCardsPicker — two-faced cards (TODO 5.15)", () => {
  const cards = [
    card(1, "Village Elder"),
    card(2, "Old Pair", { rendered_back_image_url: null, rendered_back_thumb_url: null }),
    card(3, "Mid Save", {
      rendered_image_url: null,
      rendered_thumb_url: null,
      rendered_back_image_url: null,
      rendered_back_thumb_url: null,
    }),
    card(4, "Plain", { frame_style: { template: "m15" }, rendered_back_image_url: null, rendered_back_thumb_url: null }),
  ];

  it("a card with a back picture carries the text mark; an older two-faced card, a card mid-save and a one-faced card carry nothing", () => {
    render(<PinnedCardsPicker cards={cards} initialPinned={[]} />);
    const marks = screen.getAllByTestId("two-faces-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("2 faces");
    expect(screen.getByRole("button", { name: "Pin Village Elder" }).contains(marks[0])).toBe(true);
    // Text, not a control.
    expect(marks[0].tagName).toBe("SPAN");
    expect(marks[0].getAttribute("role")).toBeNull();
    expect(marks[0].getAttribute("tabindex")).toBeNull();
  });

  it("no interactive element is nested in a pin toggle: no \"2 faces\" button, no turning tile, no back picture", () => {
    const { container } = render(<PinnedCardsPicker cards={cards} initialPinned={[]} />);
    expect(container.querySelector("[data-testid=two-faces-button]")).toBeNull();
    expect(container.querySelector("[data-testid=baked-card-flip]")).toBeNull();
    expect(container.querySelectorAll("button button, button a, button [role=button], button [tabindex]")).toHaveLength(0);
    const srcs = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src") ?? "");
    expect(srcs.some((src) => src.includes(".back."))).toBe(false);
    // The two-faced card's tile is the plain front thumb, like any other.
    expect(srcs).toContain(`/render-cdn/owner-1/${id(1)}.thumb.webp?v=1`);
  });

  it("the whole tile — the mark included — is the pin toggle", async () => {
    render(<PinnedCardsPicker cards={cards} initialPinned={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("two-faces-mark"));
    });
    const pinned = screen.getByRole("button", { name: "Unpin Village Elder" });
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
    // Still marked once pinned.
    expect(pinned.querySelector("[data-testid=two-faces-mark]")).not.toBeNull();
  });
});

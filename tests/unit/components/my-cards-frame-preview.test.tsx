// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// My Cards and an admin's frame previews (TODO 2.3; owner, 2026-09-28):
//   * every view that shows your own card — the grid tile, the compact tile
//     and the list row — badges a preview "Frame preview" so it can be
//     spotted and deleted; an ordinary card shows no badge;
//   * a bulk "make public" that skipped previews says so in its toast, and
//     a batch of only previews shows the server's reason as an error.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
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
vi.mock("@/components/cards/render-update", () => ({ RenderUpdateBadge: () => null }));
vi.mock("@/components/cards/quick-like-button", () => ({ QuickLikeButton: () => null }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));
const actions = vi.hoisted(() => ({
  updateCardsVisibilityAction: vi.fn(),
  deleteCardsAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => actions);

import { DashboardCardTile, type DashboardCard } from "@/components/creator/dashboard-card-tile";
import { MyCardListRow } from "@/components/creator/my-cards-list-row";
import { DashboardBulkBar } from "@/components/creator/dashboard-bulk-bar";

const card = (overrides: Partial<DashboardCard> & Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    slug: "walked-battle",
    title: "Walked Battle",
    visibility: "private",
    rendered_image_url: null,
    rendered_thumb_url: null,
    supertype: null,
    card_type: "battle",
    subtypes: ["Siege"],
    likes_count: 0,
    updated_at: "2026-09-28T10:00:00Z",
    ...overrides,
  }) as unknown as DashboardCard;

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
});

describe("the Frame preview badge in My Cards", () => {
  const tile = (c: DashboardCard, density: "regular" | "compact") =>
    render(
      <DashboardCardTile
        card={c}
        isSelected={false}
        selectMode={false}
        density={density}
        onToggle={() => {}}
      />,
    );

  it.each(["regular", "compact"] as const)("the %s grid tile badges a preview", (density) => {
    tile(card({ frame_preview: true }), density);
    expect(screen.getByTestId("frame-preview-card-badge").textContent).toBe("Frame preview");
    // …next to its visibility, which stays Private.
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it.each(["regular", "compact"] as const)("the %s grid tile shows no badge on an ordinary card", (density) => {
    tile(card({ frame_preview: false }), density);
    expect(screen.queryByTestId("frame-preview-card-badge")).toBeNull();
    cleanup();
    // A row read before migration 0121 has no such key at all.
    tile(card(), density);
    expect(screen.queryByTestId("frame-preview-card-badge")).toBeNull();
  });

  it("the list row badges a preview, and not an ordinary card", () => {
    const row = (c: DashboardCard) =>
      render(
        <ul>
          <MyCardListRow card={c} isSelected={false} selectMode={false} onToggle={() => {}} />
        </ul>,
      );
    row(card({ frame_preview: true }));
    expect(screen.getByTestId("frame-preview-card-badge").textContent).toBe("Frame preview");
    cleanup();
    row(card({ frame_preview: false, visibility: "public" }));
    expect(screen.queryByTestId("frame-preview-card-badge")).toBeNull();
  });
});

describe("DashboardBulkBar — a publish that skipped frame previews", () => {
  const bar = () => {
    const onSuccess = vi.fn();
    render(<DashboardBulkBar selectedIds={["a", "b", "c"]} onClear={() => {}} onSuccess={onSuccess} />);
    return onSuccess;
  };

  it("says how many were published and how many previews were skipped", async () => {
    actions.updateCardsVisibilityAction.mockResolvedValue({ ok: true, count: 5, skippedPreviews: 2 });
    const onSuccess = bar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /make public/i }));
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Published 5 cards. Skipped 2 frame previews — they stay private.",
      ),
    );
    expect(actions.updateCardsVisibilityAction).toHaveBeenCalledWith(["a", "b", "c"], "public");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("a batch without previews keeps the old toast", async () => {
    actions.updateCardsVisibilityAction.mockResolvedValue({ ok: true, count: 3, skippedPreviews: 0 });
    bar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /make public/i }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 cards → public."));
  });

  it("only previews selected: the server's reason shows as an error and nothing is cleared", async () => {
    const reason =
      "Nothing was published: all 3 selected cards are frame previews, and frame previews stay private.";
    actions.updateCardsVisibilityAction.mockResolvedValue({ ok: false, error: reason });
    const onSuccess = bar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /make public/i }));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

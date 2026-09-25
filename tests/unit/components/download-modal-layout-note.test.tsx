// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's layout note (TODO 0.21): a clean (paid) download is a
// live render and cannot come from the watermarked bake, so when the card's
// gallery image predates the current layout the paid viewer is told the
// download can look slightly different. Free viewers download the stored
// bake itself, so they never see the note.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(cleanup);

async function open(props: { isPaid: boolean; galleryImageIsOlder: boolean }) {
  render(<DownloadModal cardId="c" cardSlug="s" {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
  });
}

describe("DownloadModal layout note", () => {
  it("tells a paid viewer when the gallery image is older than the clean download", async () => {
    await open({ isPaid: true, galleryImageIsOlder: true });
    expect(screen.getByTestId("download-layout-note").textContent).toMatch(/current card layout/);
  });

  it("stays quiet when the gallery image is current, and for free viewers", async () => {
    await open({ isPaid: true, galleryImageIsOlder: false });
    expect(screen.queryByTestId("download-layout-note")).toBeNull();
    cleanup();
    await open({ isPaid: false, galleryImageIsOlder: true });
    expect(screen.queryByTestId("download-layout-note")).toBeNull();
  });
});

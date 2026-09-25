// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's layout note (TODO 0.21): the server decides per
// viewer whether THIS download will differ from the gallery image
// (downloadDiffersFromGallery — a paid clean download of an older-look card,
// or a free download of a card still owed a correction); the modal shows the
// note exactly when told to, for free and paid viewers alike.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(cleanup);

async function open(props: { isPaid: boolean; downloadDiffersFromGallery: boolean }) {
  render(<DownloadModal cardId="c" cardSlug="s" {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
  });
}

describe("DownloadModal layout note", () => {
  it("shows the note when the server says this download differs — paid or free", async () => {
    await open({ isPaid: true, downloadDiffersFromGallery: true });
    expect(screen.getByTestId("download-layout-note").textContent).toMatch(/current card layout/);
    cleanup();
    await open({ isPaid: false, downloadDiffersFromGallery: true });
    expect(screen.getByTestId("download-layout-note")).toBeTruthy();
  });

  it("stays quiet when the download is the gallery image", async () => {
    await open({ isPaid: true, downloadDiffersFromGallery: false });
    expect(screen.queryByTestId("download-layout-note")).toBeNull();
    cleanup();
    await open({ isPaid: false, downloadDiffersFromGallery: false });
    expect(screen.queryByTestId("download-layout-note")).toBeNull();
  });
});

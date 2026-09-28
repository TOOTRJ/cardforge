// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The per-template sign-off view (TODO 2.4) and the walked-preview list
// (2.3): the publish button waits for the server's "ready" AND the owner's
// tick; "Score N colours" scores exactly the unscored/stale ones, one at a
// time; a preview is deleted only on the second click.
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
const actions = vi.hoisted(() => ({
  scoreFrameColorAction: vi.fn(),
  signOffFrameTemplateAction: vi.fn(),
  deleteFramePreviewCardAction: vi.fn(),
  setFrameReviewAction: vi.fn(),
}));
vi.mock("@/lib/cards/frame-signoff-actions", () => ({
  scoreFrameColorAction: actions.scoreFrameColorAction,
  signOffFrameTemplateAction: actions.signOffFrameTemplateAction,
  deleteFramePreviewCardAction: actions.deleteFramePreviewCardAction,
}));
vi.mock("@/lib/cards/frame-review-actions", () => ({
  setFrameReviewAction: actions.setFrameReviewAction,
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { title?: string }) => <div data-testid="card-preview">{props.title}</div>,
}));

import {
  FrameTemplateSignOff,
  type SignOffColourView,
} from "@/components/admin/frame-template-signoff";
import { FramePreviewList } from "@/components/admin/frame-preview-list";

const view = (
  colorKey: string,
  state: SignOffColourView["score"]["state"],
  overrides: Partial<SignOffColourView> = {},
): SignOffColourView => ({
  colorKey,
  reference: state === "no-reference" ? null : { name: `Ref ${colorKey}`, set: "tst", thumbUrl: "https://example.com/t.jpg" },
  referenceId: state === "no-reference" ? null : `ref-${colorKey}`,
  verified: false,
  stale: false,
  legacy: false,
  staleReasons: [],
  verifiedLayoutVersion: null,
  verifiedOverrideHash: null,
  score: {
    state,
    overall: state === "scored" || state === "stale" ? 5.5 : null,
    reasons: [],
    createdAt: state === "scored" ? "2026-09-28T10:00:00Z" : null,
  },
  walkHref: `/create?template=saga&color=${colorKey}`,
  compareHref: `/admin/frame-compare?template=saga&color=${colorKey}`,
  previews: [],
  ...overrides,
});

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
});

describe("FrameTemplateSignOff", () => {
  it("publishes only when the server says ready AND the owner ticked", async () => {
    actions.signOffFrameTemplateAction.mockResolvedValue({ ok: true, published: ["w", "u"], sampleOnly: ["c"] });
    render(
      <FrameTemplateSignOff
        template="saga"
        currentVersion={32}
        currentHash="none"
        colours={[view("w", "scored"), view("u", "scored"), view("c", "no-reference")]}
        ready
        publishableCount={2}
      />,
    );
    const publish = screen.getByTestId("signoff-publish") as HTMLButtonElement;
    expect(publish.textContent).toMatch(/Publish 2 colours/);
    expect(publish.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("signoff-confirm"));
    });
    expect(publish.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(publish);
    });
    await waitFor(() =>
      expect(actions.signOffFrameTemplateAction).toHaveBeenCalledWith({ template: "saga", confirmed: true }),
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/W, U published.*C \(no real printing\)/));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("stays disabled while not ready, even ticked", async () => {
    render(
      <FrameTemplateSignOff
        template="saga"
        currentVersion={32}
        currentHash="none"
        colours={[view("w", "scored"), view("u", "unscored")]}
        ready={false}
        publishableCount={1}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("signoff-confirm"));
    });
    expect((screen.getByTestId("signoff-publish") as HTMLButtonElement).disabled).toBe(true);
  });

  it("'Score N colours' scores exactly the unscored and stale colours, one at a time", async () => {
    actions.scoreFrameColorAction.mockResolvedValue({ ok: true, overall: 4.2, referenceId: "r" });
    render(
      <FrameTemplateSignOff
        template="saga"
        currentVersion={32}
        currentHash="none"
        colours={[
          view("w", "scored"),
          view("u", "unscored"),
          view("b", "stale"),
          view("c", "no-reference"),
        ]}
        ready={false}
        publishableCount={1}
      />,
    );
    const button = screen.getByRole("button", { name: /Score 2 colours/ });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(actions.scoreFrameColorAction).toHaveBeenCalledTimes(2));
    expect(actions.scoreFrameColorAction.mock.calls.map((c) => c[0])).toEqual([
      { template: "saga", colorKey: "u" },
      { template: "saga", colorKey: "b" },
    ]);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("a colour with no real printing offers no Score button and says why", () => {
    render(
      <FrameTemplateSignOff
        template="split"
        currentVersion={32}
        currentHash="none"
        colours={[view("w", "no-reference")]}
        ready={false}
        publishableCount={0}
      />,
    );
    const row = screen.getByTestId("signoff-colour-w");
    expect(row.textContent).toMatch(/No real printing/);
    expect(row.querySelectorAll("button")).toHaveLength(0);
  });

  it("a score recorded by the colour's own tick says so", () => {
    const ticked = view("w", "scored");
    render(
      <FrameTemplateSignOff
        template="saga"
        currentVersion={32}
        currentHash="none"
        colours={[{ ...ticked, score: { ...ticked.score, fromTick: true } }, view("u", "scored")]}
        ready
        publishableCount={2}
      />,
    );
    expect(screen.getByTestId("signoff-colour-w").textContent).toMatch(/current · from the tick/);
    expect(screen.getByTestId("signoff-colour-u").textContent).not.toMatch(/from the tick/);
  });
});

describe("FramePreviewList", () => {
  const item = {
    id: "card-1",
    title: "Walked Saga",
    colorKey: "w",
    createdAt: "2026-09-28T10:00:00Z",
    editHref: "/card/walked-saga/edit?previewFrames=saga",
  };

  it("offers Re-verify for your own preview and deletes on the second click", async () => {
    actions.deleteFramePreviewCardAction.mockResolvedValue({ ok: true });
    render(<FramePreviewList items={[item]} />);
    expect(screen.getByRole("link", { name: "Re-verify" }).getAttribute("href")).toBe(item.editHref);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Delete the preview/ }));
    });
    expect(actions.deleteFramePreviewCardAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Confirm deleting/ }));
    });
    await waitFor(() =>
      expect(actions.deleteFramePreviewCardAction).toHaveBeenCalledWith({ cardId: "card-1" }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("another admin's preview can be deleted but not opened", () => {
    render(<FramePreviewList items={[{ ...item, editHref: null }]} />);
    expect(screen.queryByRole("link", { name: "Re-verify" })).toBeNull();
    expect(screen.getByText(/another admin's/)).toBeTruthy();
  });

  it("renders nothing without previews", () => {
    const { container } = render(<FramePreviewList items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

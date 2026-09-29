// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The per-template sign-off view (TODO 2.4) and the walked-preview list
// (2.3): the publish button waits for the server's "ready" AND the owner's
// tick; a preview is deleted only on the second click. Verification
// throughput (TODO 4.12): "Score all colours" and "Score N colours" are ONE
// job — a single streamed request naming exactly those combos, never a loop
// of per-colour actions — whose results fill the per-slot table, and
// nothing in it ticks a colour or publishes the template.
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
import { __resetScoreBatchForTests } from "@/components/admin/score-batch-store";
import { encodeScoreBatchEvent, type ScoreBatchEvent } from "@/lib/frames/score-batch";
import type { TreatmentView } from "@/lib/frames/treatment-summary";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

const fetchMock = vi.hoisted(() => vi.fn());

/** A 200 answer whose body streams the given job events. */
function jobResponse(events: ScoreBatchEvent[]) {
  const bytes = new TextEncoder().encode(events.map(encodeScoreBatchEvent).join(""));
  return {
    ok: true,
    status: 200,
    body: new NodeReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    json: async () => null,
  } as unknown as Response;
}

/** The job's answer for the combos the request named: each scored. */
function scoreEverything(overall = 4.2, slots: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const { combos } = JSON.parse(init.body as string) as { combos: Array<{ template: "saga"; colorKey: "w" }> };
    return jobResponse([
      { type: "start", combos, skipped: [] },
      ...combos.flatMap((c): ScoreBatchEvent[] => [
        { type: "scoring", ...c },
        {
          type: "result",
          ...c,
          ok: true,
          overall,
          global: { dxPct: 0, dyPct: 0, confidence: 0.9 },
          slots: slots as never,
          referenceId: `ref-${c.colorKey}`,
          recorded: true,
        },
      ]),
      { type: "done", scored: combos.length, failed: 0, remaining: [], stopped: null },
    ]);
  });
}

const requestedCombos = (call = 0) =>
  (JSON.parse(fetchMock.mock.calls[call][1].body as string) as { combos: unknown[] }).combos;

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

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  __resetScoreBatchForTests();
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

  it("'Score N colours' is ONE job naming exactly the unscored and stale colours", async () => {
    scoreEverything();
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
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/frame-score-batch");
    expect(requestedCombos()).toEqual([
      { template: "saga", colorKey: "u" },
      { template: "saga", colorKey: "b" },
    ]);
    // Not a client loop of per-colour actions any more.
    expect(actions.scoreFrameColorAction).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 scored/));
  });

  describe("Score all colours (TODO 4.12)", () => {
    const colours = () => [
      view("w", "scored"),
      view("u", "unscored"),
      view("b", "stale"),
      view("c", "no-reference"),
    ];

    it("scores every colour with a printing in one request, shows progress, and ticks nothing", async () => {
      scoreEverything(3.3);
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={colours()}
          ready={false}
          publishableCount={1}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("score-all-colours"));
      });
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestedCombos()).toEqual([
        { template: "saga", colorKey: "w" },
        { template: "saga", colorKey: "u" },
        { template: "saga", colorKey: "b" },
      ]);
      const panel = screen.getByTestId("score-job-panel");
      expect(panel.getAttribute("data-status")).toBe("done");
      expect(panel.textContent).toMatch(/Scored 3 of 3/);
      expect(screen.getByTestId("score-job-chip-saga/w").getAttribute("data-status")).toBe("done");
      expect(panel.textContent).toMatch(/96\.7%/);
      // The job only records scores: no tick, no template publish.
      expect(actions.setFrameReviewAction).not.toHaveBeenCalled();
      expect(actions.signOffFrameTemplateAction).not.toHaveBeenCalled();
      expect(actions.scoreFrameColorAction).not.toHaveBeenCalled();
    });

    it("the job's results fill the per-slot table, with the nudge the colours agree on", async () => {
      scoreEverything(3.3, { title: { score: 9, best: 5, dxPct: 0, dyPct: 0.3 } });
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={colours()}
          ready={false}
          publishableCount={1}
          slotOrder={["artSlot", "title"]}
        />,
      );
      expect(screen.getByTestId("slot-table-empty")).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByTestId("score-all-colours"));
      });
      await waitFor(() => expect(screen.getByTestId("slot-table")).toBeTruthy());
      const title = screen.getByTestId("slot-row-title");
      expect(title.textContent).toMatch(/9%/);
      expect(screen.getByTestId("slot-consensus-title").textContent).toMatch(/→ 0 \/ \+0\.3/);
      expect(screen.getByTestId("slot-consensus-title").textContent).toMatch(/3 of 3/);
    });

    it("once the refresh brings the recorded scores, the table shows them, not the job's copy", async () => {
      scoreEverything(3.3, { title: { score: 9, best: 5, dxPct: 0, dyPct: 0.3 } });
      const props = {
        template: "saga",
        currentVersion: 32,
        currentHash: "none",
        ready: false,
        publishableCount: 1,
        slotOrder: ["title"],
      };
      const { rerender } = render(<FrameTemplateSignOff {...props} colours={colours()} />);
      await act(async () => {
        fireEvent.click(screen.getByTestId("score-all-colours"));
      });
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(screen.getByTestId("slot-table").textContent).toMatch(/new/);
      // The refreshed server render: new props, the recorded (server-judged) scores.
      const refreshed = colours().map((c) =>
        c.colorKey === "c"
          ? c
          : { ...c, score: { ...c.score, state: "scored" as const, overall: 3.3, slots: { title: { score: 9, best: 9, dxPct: 0, dyPct: 0 } } } },
      );
      rerender(<FrameTemplateSignOff {...props} colours={refreshed} />);
      const table = screen.getByTestId("slot-table").textContent ?? "";
      expect(table).not.toMatch(/new/);
      expect(screen.getByTestId("slot-consensus-title").textContent).toMatch(/stays/);
    });

    it("the button is disabled while a job runs, and says how many colours it scores", async () => {
      let release: (value: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={colours()}
          ready={false}
          publishableCount={1}
        />,
      );
      const button = screen.getByTestId("score-all-colours") as HTMLButtonElement;
      expect(button.textContent).toMatch(/Score all 3 colours/);
      await act(async () => {
        fireEvent.click(button);
      });
      expect(button.disabled).toBe(true);
      expect((screen.getByRole("button", { name: /Score 2 colours/ }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        release(
          jobResponse([{ type: "done", scored: 0, failed: 0, remaining: [], stopped: null }]),
        );
      });
      await waitFor(() => expect(button.disabled).toBe(false));
    });
  });

  it("a treatment's frames get one 'Score the treatment' job over all their combos", async () => {
    scoreEverything();
    const treatment: TreatmentView = {
      key: "borderless",
      label: "Borderless",
      templates: [
        {
          template: "m15borderless",
          label: "Borderless",
          colours: [{ colorKey: "w", state: "scored", overall: 5, low: false }],
        },
        {
          template: "m15borderlessartifact",
          label: "Borderless Artifact",
          colours: [{ colorKey: "w", state: "unscored", overall: null, low: false }],
        },
      ],
      combos: [
        { template: "m15borderless", colorKey: "w" },
        { template: "m15borderlessartifact", colorKey: "w" },
      ],
      shared: [
        {
          path: "title",
          templates: ["m15borderless", "m15borderlessartifact"],
          samples: 1,
          meanScore: 9,
          nudge: null,
        },
      ],
    };
    render(
      <FrameTemplateSignOff
        template="m15borderless"
        currentVersion={32}
        currentHash="none"
        colours={[view("w", "scored")]}
        ready
        publishableCount={1}
        treatment={treatment}
      />,
    );
    const panel = screen.getByTestId("treatment-panel");
    expect(panel.textContent).toMatch(/Treatment · Borderless/);
    expect(screen.getByTestId("treatment-row-m15borderlessartifact").textContent).toMatch(/not scored/);
    expect(screen.getByTestId("treatment-shared").textContent).toMatch(/m15borderless, m15borderlessartifact/);
    await act(async () => {
      fireEvent.click(screen.getByTestId("score-treatment"));
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requestedCombos()).toEqual(treatment.combos);
    expect(actions.setFrameReviewAction).not.toHaveBeenCalled();
    expect(actions.signOffFrameTemplateAction).not.toHaveBeenCalled();
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

  describe("a colour below the 90 % warning line (owner, 2026-09-28)", () => {
    // Only the recorded difference is passed: the view derives the warning
    // from it (isLowFrameScore), so no separate flag can go missing.
    const lowView = (colorKey: string, overall: number) => {
      const base = view(colorKey, "scored");
      return { ...base, score: { ...base.score, overall } };
    };
    const renderLow = () =>
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={[view("w", "scored"), lowView("u", 12.4), lowView("b", 20)]}
          ready
          publishableCount={3}
        />,
      );
    const tickAndPublish = async () => {
      await act(async () => {
        fireEvent.click(screen.getByTestId("signoff-confirm"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("signoff-publish"));
      });
    };

    it("marks each low row with its match, and only those", () => {
      renderLow();
      expect(screen.getByTestId("signoff-colour-w").textContent).toMatch(/frame 5\.5% · 94\.5% match/);
      expect(screen.queryByTestId("signoff-low-w")).toBeNull();
      expect(screen.getByTestId("signoff-colour-u").textContent).toMatch(/87\.6% match/);
      expect(screen.getByTestId("signoff-low-u").textContent).toMatch(/Below 90% match/);
      expect(screen.getByTestId("signoff-low-b")).toBeTruthy();
    });

    it("the line is exactly 90 % match: a difference of 10 is not marked, 10.1 is", async () => {
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={[lowView("w", 10), lowView("u", 10.1)]}
          ready
          publishableCount={2}
        />,
      );
      expect(screen.getByTestId("signoff-colour-w").textContent).toMatch(/90% match/);
      expect(screen.queryByTestId("signoff-low-w")).toBeNull();
      expect(screen.getByTestId("signoff-low-u")).toBeTruthy();
      await tickAndPublish();
      const confirm = await screen.findByTestId("signoff-low-confirm");
      expect(confirm.textContent).toMatch(/1 colour scores below 90%/);
      expect(confirm.textContent).toMatch(/U 89\.9%/);
      expect(confirm.textContent).not.toMatch(/W 90%/);
    });

    it("Publish asks first, naming the low colours; Go back publishes nothing", async () => {
      renderLow();
      await tickAndPublish();
      const confirm = await screen.findByTestId("signoff-low-confirm");
      expect(confirm.textContent).toMatch(/2 colours score below 90% — publish anyway\?/);
      expect(confirm.textContent).toMatch(/U 87\.6%, B 80%/);
      expect(actions.signOffFrameTemplateAction).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Go back" }));
      });
      await waitFor(() => expect(screen.queryByTestId("signoff-low-confirm")).toBeNull());
      expect(actions.signOffFrameTemplateAction).not.toHaveBeenCalled();
    });

    it("Publish anyway still publishes (a warning, never a block)", async () => {
      actions.signOffFrameTemplateAction.mockResolvedValue({ ok: true, published: ["w", "u", "b"], sampleOnly: [] });
      renderLow();
      await tickAndPublish();
      await act(async () => {
        fireEvent.click(await screen.findByTestId("signoff-publish-anyway"));
      });
      await waitFor(() =>
        expect(actions.signOffFrameTemplateAction).toHaveBeenCalledWith({ template: "saga", confirmed: true }),
      );
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/W, U, B published/));
    });

    it("one low colour reads in the singular", async () => {
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={[view("w", "scored"), lowView("u", 12.4)]}
          ready
          publishableCount={2}
        />,
      );
      await tickAndPublish();
      expect((await screen.findByTestId("signoff-low-confirm")).textContent).toMatch(
        /1 colour scores below 90% — publish anyway\?/,
      );
    });

    it("a stale low score is marked but doesn't ask at Publish (it isn't published)", async () => {
      actions.signOffFrameTemplateAction.mockResolvedValue({ ok: true, published: ["w"], sampleOnly: [] });
      const stale = view("u", "stale");
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={[view("w", "scored"), { ...stale, score: { ...stale.score, overall: 30 } }]}
          ready
          publishableCount={1}
        />,
      );
      expect(screen.getByTestId("signoff-low-u")).toBeTruthy();
      await tickAndPublish();
      await waitFor(() => expect(actions.signOffFrameTemplateAction).toHaveBeenCalled());
      expect(screen.queryByTestId("signoff-low-confirm")).toBeNull();
    });

    it("a Score below the line says so in its toast", async () => {
      actions.scoreFrameColorAction.mockResolvedValue({ ok: true, overall: 14, referenceId: "r" });
      render(
        <FrameTemplateSignOff
          template="saga"
          currentVersion={32}
          currentHash="none"
          colours={[view("u", "unscored")]}
          ready={false}
          publishableCount={0}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Score$/ }));
      });
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "saga/u scored: frame 14% · 86% match. Below 90% — check it in Compare.",
        ),
      );
    });
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

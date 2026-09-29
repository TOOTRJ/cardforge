// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 4.12's read-outs on the sign-off view:
//   * the per-slot table — each colour's slot score + its own nudge, and ONE
//     template nudge from the colours whose score counts today (a stale
//     colour is shown dimmed and never votes; art is never nudged);
//   * which score a column shows — this tab's job result only while it is
//     newer than the recorded one;
//   * every colour side by side — our live render next to its printing
//     (a landscape scan turned back), sample content when the lookup fails.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { title?: string; profileOverrides?: unknown }) => (
    <div data-testid="card-preview" data-overrides={JSON.stringify(props.profileOverrides ?? null)}>
      {props.title}
    </div>
  ),
}));
const payloads = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("@/lib/scryfall/reference-preview", () => ({ buildFrameComparePayload: payloads.build }));

import { FrameSlotTable, type SlotTableColumn } from "@/components/admin/frame-slot-table";
import { slotTableColumns, type SignOffColourView } from "@/components/admin/frame-template-signoff";
import { FrameColoursSideBySide } from "@/components/admin/frame-colours-side-by-side";
import {
  FrameSignOffSideBySide,
  LOOKUP_TIMEOUT_MS,
  LOOKUP_TTL_MS,
  __resetSideBySideLookupsForTests,
} from "@/components/admin/frame-signoff-side-by-side";
import type { LiveComboResult } from "@/components/admin/score-batch-store";

afterEach(() => {
  cleanup();
  payloads.build.mockReset();
  __resetSideBySideLookupsForTests();
  vi.useRealTimers();
});

const s = (score: number, best: number, dxPct: number, dyPct: number) => ({ score, best, dxPct, dyPct });

const column = (
  colorKey: string,
  state: SlotTableColumn["state"],
  slots: SlotTableColumn["slots"],
): SlotTableColumn => ({
  colorKey,
  state,
  overall: slots ? 5 : null,
  global: slots ? { dxPct: 0.1, dyPct: -0.1, confidence: 0.3 } : null,
  slots,
});

describe("FrameSlotTable", () => {
  it("shows each colour's score and nudge, and the move the current colours agree on", () => {
    render(
      <FrameSlotTable
        slotOrder={["artSlot", "title", "type"]}
        columns={[
          column("w", "scored", { artSlot: s(40, 40, 0, 0), title: s(9, 5, 0, 0.3), type: s(6, 6, 0, 0) }),
          column("u", "live", { artSlot: s(41, 41, 0, 0), title: s(10, 6, 0, 0.2), type: s(6, 6, 0, 0) }),
          column("b", "scored", { artSlot: s(39, 39, 0, 0), title: s(8, 5, 0, 0.3), type: s(6, 6, 0.2, 0) }),
          // Stale: its big nudge must NOT drag the template's suggestion.
          column("r", "stale", { artSlot: s(40, 40, 0, 0), title: s(20, 4, 0, -3), type: s(6, 5, 0.3, 0) }),
          column("c", "no-reference", null),
        ]}
      />,
    );
    const title = screen.getByTestId("slot-row-title");
    expect(title.textContent).toMatch(/9%/);
    expect(title.textContent).toMatch(/→ 0 \/ \+0\.3/);
    const consensus = screen.getByTestId("slot-consensus-title").textContent ?? "";
    expect(consensus).toMatch(/→ 0 \/ \+0\.3/);
    expect(consensus).toMatch(/3 of 3/); // the stale colour did not vote
    // One colour of three wanting a move is no consensus.
    expect(screen.getByTestId("slot-consensus-type").textContent).toMatch(/stays/);
    // Art always differs and is never nudged.
    expect(screen.getByTestId("slot-row-artSlot").textContent).toMatch(/art differs/);
    expect(screen.getByTestId("slot-consensus-artSlot").textContent).toBe("—");
    // Headers say which columns are stale / just scored.
    const table = screen.getByTestId("slot-table");
    expect(table.textContent).toMatch(/rstale/i);
    expect(table.textContent).toMatch(/unew/i);
    // Low registration confidence is flagged.
    expect(table.textContent).toMatch(/conf 0\.3/);
  });

  it("says how to fill it when nothing is scored", () => {
    render(<FrameSlotTable slotOrder={["title"]} columns={[column("w", "unscored", null)]} />);
    expect(screen.getByTestId("slot-table-empty").textContent).toMatch(/Score all colours/);
  });
});

describe("slotTableColumns", () => {
  const view = (colorKey: string, recorded: boolean): SignOffColourView => ({
    colorKey,
    reference: { name: "R", set: "tst", thumbUrl: "https://example.com/t.jpg" },
    referenceId: "ref",
    verified: false,
    stale: false,
    legacy: false,
    staleReasons: [],
    verifiedLayoutVersion: null,
    verifiedOverrideHash: null,
    score: {
      state: recorded ? "stale" : "unscored",
      overall: recorded ? 7 : null,
      reasons: [],
      createdAt: recorded ? "2026-09-29T10:00:00Z" : null,
      slots: recorded ? { title: s(9, 9, 0, 0) } : null,
    },
    walkHref: "#",
    compareHref: "#",
    previews: [],
  });
  const live = (colorKey: string, recorded = true): LiveComboResult => ({
    template: "saga",
    colorKey,
    ok: true,
    overall: 3,
    global: { dxPct: 0, dyPct: 0, confidence: 1 },
    slots: { title: s(4, 4, 0, 0) },
    referenceId: "ref",
    recorded,
  });
  const colours = [view("w", true), view("u", false), view("b", false)];
  const results = {
    "saga/w": live("w"),
    "saga/u": live("u"),
    "saga/b": live("b", false), // scored but not recorded: never shown as counting
    "other/w": live("w"),
  };

  it("shows the job's recorded results while the page still has the data from before it", () => {
    expect(slotTableColumns("saga", colours, results, true).map((c) => [c.colorKey, c.state, c.overall])).toEqual([
      ["w", "live", 3],
      ["u", "live", 3],
      ["b", "unscored", null],
    ]);
  });

  it("once the refreshed server data is in, it is the one truth (it knows what is stale)", () => {
    expect(slotTableColumns("saga", colours, results, false).map((c) => [c.colorKey, c.state, c.overall])).toEqual([
      ["w", "stale", 7],
      ["u", "unscored", null],
      ["b", "unscored", null],
    ]);
  });
});

describe("every colour side by side", () => {
  const colour = (colorKey: string, extra: Partial<Parameters<typeof FrameColoursSideBySide>[0]["colours"][number]> = {}) => ({
    colorKey,
    preview: { title: `Ours ${colorKey}` },
    scanUrl: `https://cards.scryfall.io/png/front/a/b/${colorKey}.png`,
    referenceName: `Ref ${colorKey} (TST)`,
    sample: false,
    score: { state: "scored", overall: 5 },
    compareHref: `/admin/frame-compare?template=saga&color=${colorKey}`,
    ...extra,
  });

  it("puts our render next to the printing for every colour, and switches to one kind", async () => {
    render(
      <FrameColoursSideBySide
        landscape={false}
        colours={[
          colour("w"),
          colour("u", { score: { state: "scored", overall: 12 } }),
          colour("c", { scanUrl: null, referenceName: null, sample: true, score: { state: "no-reference", overall: null } }),
        ]}
      />,
    );
    const w = screen.getByTestId("side-by-side-w");
    expect(w.textContent).toMatch(/Ours w/);
    expect(w.querySelector("img")?.getAttribute("src")).toMatch(/w\.png$/);
    expect(w.textContent).toMatch(/95% match/);
    expect(w.querySelector("a")?.getAttribute("href")).toBe("/admin/frame-compare?template=saga&color=w");
    // A colour under the 90 % line is outlined.
    expect(screen.getByTestId("side-by-side-u").className).toMatch(/border-gold/);
    const c = screen.getByTestId("side-by-side-c");
    expect(c.textContent).toMatch(/sample content/);
    expect(c.textContent).toMatch(/No real printing/);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Ours" }));
    });
    expect(screen.getAllByTestId("card-preview")).toHaveLength(3);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Printing" }));
    });
    expect(screen.queryAllByTestId("card-preview")).toHaveLength(0);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("turns a landscape frame's portrait scan back onto the card", () => {
    render(<FrameColoursSideBySide landscape colours={[colour("w")]} />);
    const img = screen.getByTestId("side-by-side-w").querySelector("img")!;
    expect(img.className).toMatch(/rotate-90/);
    expect(img.parentElement?.className).toMatch(/aspect-\[7\/5\]/);
  });

  it("the server half builds each colour from its reference with today's overrides, sample on a failed lookup", async () => {
    payloads.build.mockImplementation(async (id: string) => {
      if (id === "ref-u") throw new Error("Scryfall down");
      return { preview: { title: `Card ${id}` }, scanUrl: `https://cards.scryfall.io/png/${id}.png` };
    });
    const overrides = { saga: { title: { sizePct: 0.05 } } };
    const element = await FrameSignOffSideBySide({
      template: "saga",
      references: new Map([
        ["w", { name: "Ref W", set: "tst", scryfallId: "ref-w" }],
        ["u", { name: "Ref U", set: "tst", scryfallId: "ref-u" }],
      ]) as never,
      overrides: overrides as never,
      scores: new Map([["w", { state: "scored", overall: 4 }]]),
    });
    render(element);
    expect(screen.getAllByTestId(/^side-by-side-[wubrgcm]$/)).toHaveLength(7);
    const w = screen.getByTestId("side-by-side-w");
    expect(w.textContent).toMatch(/Card ref-w/);
    expect(w.textContent).toMatch(/Ref W \(TST\)/);
    expect(w.querySelector("[data-testid=card-preview]")?.getAttribute("data-overrides")).toBe(JSON.stringify(overrides));
    const u = screen.getByTestId("side-by-side-u");
    expect(u.textContent).toMatch(/sample content/);
    expect(u.textContent).toMatch(/Couldn't load the printing/);
    // No reference at all → sample, no lookup.
    expect(screen.getByTestId("side-by-side-b").textContent).toMatch(/No real printing/);
    expect(payloads.build).toHaveBeenCalledTimes(2);
  });
  const twoReferences = () =>
    new Map([
      ["w", { name: "Ref W", set: "tst", scryfallId: "ref-w" }],
      ["u", { name: "Ref U", set: "tst", scryfallId: "ref-u" }],
    ]) as never;

  it("a lookup that hangs falls back to the sample instead of holding the section", async () => {
    vi.useFakeTimers();
    payloads.build.mockImplementation((id: string) =>
      id === "ref-u"
        ? new Promise(() => {}) // Scryfall never answers
        : Promise.resolve({ preview: { title: `Card ${id}` }, scanUrl: `https://cards.scryfall.io/png/${id}.png` }),
    );
    let element: Awaited<ReturnType<typeof FrameSignOffSideBySide>> | null = null;
    const pending = FrameSignOffSideBySide({
      template: "saga",
      references: twoReferences(),
      overrides: {} as never,
      scores: new Map(),
    }).then((e) => (element = e));
    await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 100);
    expect(element).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    // Settled by the timeout alone — no await on the lookup that never ends.
    expect(element).not.toBeNull();
    await pending;
    vi.useRealTimers();
    render(element!);
    expect(screen.getByTestId("side-by-side-w").textContent).toMatch(/Card ref-w/);
    const u = screen.getByTestId("side-by-side-u");
    expect(u.textContent).toMatch(/sample content/);
    expect(u.textContent).toMatch(/Couldn't load the printing/);
  });

  it("a refresh reuses the lookups that succeeded (only today's overrides are new); failures are asked again", async () => {
    payloads.build.mockImplementation(async (id: string) => {
      if (id === "ref-u") throw new Error("Scryfall down");
      return { preview: { title: `Card ${id}` }, scanUrl: `https://cards.scryfall.io/png/${id}.png` };
    });
    const renderWith = async (overrides: unknown) => {
      cleanup();
      render(
        await FrameSignOffSideBySide({
          template: "saga",
          references: twoReferences(),
          overrides: overrides as never,
          scores: new Map(),
        }),
      );
    };
    await renderWith({ saga: { title: { sizePct: 0.05 } } });
    expect(payloads.build).toHaveBeenCalledTimes(2);

    const edited = { saga: { title: { sizePct: 0.06 } } };
    await renderWith(edited);
    // ref-w came from the memo; ref-u (failed) was looked up again.
    expect(payloads.build.mock.calls.map((c) => c[0])).toEqual(["ref-w", "ref-u", "ref-u"]);
    const w = screen.getByTestId("side-by-side-w");
    expect(w.textContent).toMatch(/Card ref-w/);
    expect(w.querySelector("[data-testid=card-preview]")?.getAttribute("data-overrides")).toBe(JSON.stringify(edited));

    // Past the TTL it asks Scryfall again.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LOOKUP_TTL_MS + 1);
    await renderWith(edited);
    expect(payloads.build.mock.calls.filter((c) => c[0] === "ref-w")).toHaveLength(2);
  });
});

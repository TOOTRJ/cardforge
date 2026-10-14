// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, FaceContent, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveStationTiers } from "@/lib/cards/station";
import { updateCardSchema } from "@/lib/validation/card";
import { withPrintTypographyUpdate } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// TODO 4.27a, PR 3, through the real CardCreatorForm: the AI fill and the
// ideas dialog on a station card, and the tier editor's two notes.
//
// - A fill of the rules text sends the designer the card's tiers
//   (`locked.station_text` — on a station frame only) and keeps the maker's
//   "power / toughness on this tier" with its tier. Main reset the choice on
//   every fill: the plate went back to the tier the text names.
// - An idea for a Spacecraft arrives with its tiers: the new card follows its
//   subtype onto the frame and saves rows.
// - The notes: text that is cut, a band over the row limit, a Planet's rows.
//
// The dialogs are stand-ins that hand the form what the real ones would; the
// jobs API is a stubbed fetch (no generation is run). Every `sent` payload is
// what the form handed the server action.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/create",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/billing/credit-confirm-provider", () => ({ useCreditConfirm: () => async () => true }));
const actions = vi.hoisted(() => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: actions.linkDeckCardAction }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
const ai = vi.hoisted(() => ({ idea: null as Record<string, unknown> | null }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ onGenerate }: { onGenerate: (options: { want: string[] }) => void }) => (
    <button type="button" data-testid="run-fill" onClick={() => onGenerate({ want: ["rules_text"] })}>
      run fill
    </button>
  ),
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({
  CardIdeasDialog: ({ onApply }: { onApply: (patch: Record<string, unknown>) => void }) => (
    <button type="button" data-testid="apply-idea" onClick={() => onApply(ai.idea!)}>
      apply idea
    </button>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15artifact", "m15land", "m15station", "m15stationland"].flatMap((t) =>
  ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)),
);

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Kesh, Emberforge Warden",
    slug: "kesh",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: "Legendary",
    card_type: "creature",
    subtypes: ["Dwarf"],
    tags: [],
    rarity: "rare",
    rules_text: "Haste",
    flavor_text: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "m15" },
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
}

const REMINDER =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)";
const TEXT = `Flying\n${REMINDER}\n3+ | Other creatures you control get +1/+1.\n6+ | Whenever this Spacecraft attacks, draw a card.\n9+ | Flying, lifelink`;
/** The plate on 6+ — a tier the text (its reminder names 9+) would not plate. */
const ROWS: FaceContent = {
  v: 1,
  station: {
    intro: `Flying\n${REMINDER}`,
    tiers: [
      { threshold: 3, text: "Other creatures you control get +1/+1." },
      { threshold: 6, text: "Whenever this Spacecraft attacks, draw a card.", pt: true },
      { threshold: 9, text: "Flying, lifelink" },
    ],
  },
};
const craft = (rules_text: string, face_content: unknown = null, over: Record<string, unknown> = {}) =>
  savedCard({
    title: "Lumen-Class Frigate",
    cost: "{2}{U}",
    color_identity: ["blue"],
    supertype: null,
    card_type: "artifact",
    subtypes: ["Spacecraft"],
    power: "3",
    toughness: "5",
    rules_text,
    face_content,
    frame_style: { finish: "regular", template: "m15station" },
    ...over,
  });

const jobs = { posted: [] as Record<string, unknown>[], fill: {} as Record<string, unknown> };

beforeEach(() => {
  jobs.posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/ai/jobs") {
        jobs.posted.push(JSON.parse(init!.body!) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, job: { id: "job-1" }, credits: 5 }), { status: 200 });
      }
      if (String(url).startsWith("/api/ai/jobs/job-1/step")) {
        return new Response(JSON.stringify({ ok: true, credits: 4, job: { steps: [{ status: "done", fill: jobs.fill }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const renderForm = (mode: "create" | "edit", card?: Card) =>
  render(<CardCreatorForm mode={mode} card={card} userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const goTo = async (step: string) => click(screen.getAllByTitle(`Go to ${step}`)[0]!);
const typeRich = async (name: string, value: string) => {
  const el = document.querySelector(`[data-field="${name}"]`);
  if (!el) throw new Error(`no editor named ${name}`);
  await act(async () => {
    el.textContent = value;
    fireEvent.input(el);
  });
};
const sentUpdate = async () => {
  await click(screen.getByRole("button", { name: /^Save$/ }));
  await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
  return actions.updateCardAction.mock.calls[0]![1] as Record<string, unknown>;
};
const platedOf = (payload: Record<string, unknown>) =>
  resolveStationTiers(payload.face_content as FaceContent | null, payload.rules_text as string, true).tiers.findIndex((t) => t.pt);
const runFill = async (fill: Record<string, unknown>) => {
  jobs.fill = fill;
  await click(screen.getByTestId("run-fill"));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
};
const tierRadio = (tier: number) => screen.getByTestId(`station-tier-${tier - 1}`).querySelector('input[type="radio"]') as HTMLInputElement;

describe("an AI fill of the rules text on a station card", () => {
  it("tells the designer the card's tiers, and the P/T stays on the maker's tier (main: back to 9+)", async () => {
    const card = craft(TEXT, ROWS);
    renderForm("edit", card);
    await goTo("Text & stats");
    expect(tierRadio(2).checked).toBe(true);

    const filled = TEXT.replace("Other creatures you control get +1/+1.", "Other artifacts you control have ward {1}.");
    await runFill({ rules_text: filled });
    expect(jobs.posted[0]).toMatchObject({ kind: "card_fill", want: ["rules_text"], locked: { station_text: TEXT } });
    expect((jobs.posted[0]!.locked as Record<string, unknown>).rules_text).toBeUndefined();

    expect(tierRadio(2).checked).toBe(true);
    const sent = await sentUpdate();
    expect(platedOf(sent)).toBe(1);
    expect((sent.face_content as FaceContent).station!.tiers).toEqual([
      { threshold: 3, text: "Other artifacts you control have ward {1}." },
      { threshold: 6, text: "Whenever this Spacecraft attacks, draw a card.", pt: true },
      { threshold: 9, text: "Flying, lifelink" },
    ]);
    expect(updateCardSchema.safeParse(sent).success).toBe(true);
    // The server typesets only the tier the fill wrote.
    const stored = withPrintTypographyUpdate(sent as never, card as never) as unknown as { face_content: FaceContent };
    expect(stored.face_content.station!.tiers[1]).toEqual(ROWS.station!.tiers[1]);
  });

  it("the tier moved: the choice follows it by number; its tier gone: as the text says", async () => {
    renderForm("edit", craft(TEXT, ROWS));
    await goTo("Text & stats");
    // 3+ is gone: 6+ is now the first tier.
    await runFill({ rules_text: `Flying\n${REMINDER}\n6+ | Whenever this Spacecraft attacks, draw a card.\n9+ | Flying, lifelink` });
    expect(tierRadio(1).checked).toBe(true);
    // Now a text with no 6+ at all: the plate is where the text names it.
    await runFill({ rules_text: `Flying\n${REMINDER}\n2+ | Scry 1.\n9+ | Flying, lifelink` });
    expect(tierRadio(2).checked).toBe(true);
    expect(platedOf(await sentUpdate())).toBe(1);
  });

  it("a fill on any other card sends what it always sent — no `station_text`", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await runFill({ rules_text: "Haste, trample" });
    expect(jobs.posted[0]!.locked).not.toHaveProperty("station_text");
    // …nor does a Spacecraft that is NOT on the station frame, or one with no tier yet.
    cleanup();
    renderForm("edit", craft(TEXT, null, { frame_style: { finish: "regular", template: "m15artifact" } }));
    await goTo("Text & stats");
    await runFill({ rules_text: TEXT });
    expect(jobs.posted[1]!.locked).not.toHaveProperty("station_text");
    cleanup();
    renderForm("edit", craft("Flying"));
    await goTo("Text & stats");
    await runFill({ rules_text: TEXT });
    expect(jobs.posted[2]!.locked).not.toHaveProperty("station_text");
  });
});

describe("the tier editor's notes", () => {
  const group = () => screen.getByTestId("station-tiers");
  const describedBy = () => (group().getAttribute("aria-describedby") ?? "").split(" ");

  it("nothing on a card that fits; neither note is a live region", async () => {
    renderForm("edit", craft(TEXT, ROWS));
    await goTo("Text & stats");
    expect(screen.queryByTestId("station-text-cut")).toBeNull();
    expect(screen.queryByTestId("station-over-limit")).toBeNull();
    expect(describedBy()).toHaveLength(1);
  });

  it("text that is cut: a note under the tiers, part of the group's description; the save is not blocked", async () => {
    renderForm("edit", craft(TEXT, ROWS));
    await goTo("Text & stats");
    await typeRich("station_tier_2", Array.from({ length: 12 }, () => "Whenever this Spacecraft attacks, draw a card, then discard a card.").join(" "));
    const note = await screen.findByTestId("station-text-cut");
    expect(note.textContent).toBe("This text doesn't fit: the card has more text than its box holds, so the end of every band is cut off. Shorten the text.");
    expect(note.getAttribute("role")).toBeNull();
    expect(note.getAttribute("aria-live")).toBeNull();
    expect(describedBy()).toContain(note.id);
    // Over 600 characters as well: the other note, and what is lost.
    const over = screen.getByTestId("station-over-limit");
    expect(over.textContent).toContain("Tier 3 (9+) is over 600 characters");
    expect(over.textContent).toContain("the power / toughness goes back to tier 3 (9+), the tier the text names");
    expect(describedBy()).toContain(over.id);
    const sent = await sentUpdate();
    // Saved as lines of text, as the note said — the tiers still draw.
    expect(sent.face_content).toBeNull();
    expect(resolveStationTiers(null, sent.rules_text as string, true).tiers.map((t) => t.threshold)).toEqual([3, 6, 9]);
  });

  it("a Planet's rows mark no tier", async () => {
    const text = "This land enters tapped.\n{T}: Add {G}.\nStation (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n12+ | {G}, {T}: Add {G}{G}.";
    renderForm("edit", craft(text, null, { title: "Evenfall", cost: null, card_type: "land", subtypes: ["Planet"], color_identity: ["green"], power: null, toughness: null, frame_style: { finish: "regular", template: "m15stationland" } }));
    await goTo("Text & stats");
    await typeRich("station_tier_0", "{G}, {T}: Add {G}{G}{G}.");
    const sent = await sentUpdate();
    expect((sent.face_content as FaceContent).station!.tiers).toEqual([{ threshold: 12, text: "{G}, {T}: Add {G}{G}{G}." }]);
  });
});

describe("the ideas dialog: an idea for a Spacecraft", () => {
  it("arrives with its tiers — on a station card the editor shows them and the save writes rows", async () => {
    ai.idea = {
      title: "Halcyon Driftbarge",
      rules_text: `${REMINDER}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying`,
      power: "4",
      toughness: "5",
    };
    renderForm("edit", craft("Flying"));
    await goTo("Text & stats");
    expect(screen.queryByTestId("station-tier-0")).toBeNull();
    await click(screen.getByTestId("apply-idea"));
    expect(screen.getByTestId("station-tier-1")).toBeTruthy();
    const sent = await sentUpdate();
    expect((sent.face_content as FaceContent).station!.tiers).toEqual([
      { threshold: 2, text: "Whenever you cast an artifact spell, scry 1." },
      { threshold: 9, text: "Flying", pt: true },
    ]);
  });
});

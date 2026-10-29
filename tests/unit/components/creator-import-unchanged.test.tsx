// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import importPrintings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// The creator's half of the import fingerprint (TODO DK2.5), driven through
// the real CardCreatorForm: a NEW card started from a Scryfall printing says
// `import_unchanged` — true while every printed field is still the import's
// (a change of frame, colour, rarity or visibility doesn't count), false once
// one moved — and a card with no import this session never names the key, so
// its payload is what it always was. The server stores the fingerprint only
// on true (tests/unit/cards/import-provenance-save.test.ts).
// Harness: tests/unit/components/creator-form-reliability.test.tsx.
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
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { title?: string }) => <div data-testid="card-preview" data-title={props.title ?? ""} />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15artifact", "m15land"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)));

const ELVES = scryfallCardSchema.parse(structuredClone(importPrintings["dom-168"]));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

function stubNamedRoute() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/scryfall/named")
        ? new Response(
            JSON.stringify({ ok: true, card: { name: ELVES.name, scryfall_uri: null }, patch: JSON.parse(JSON.stringify(mapScryfallToFormPatch(ELVES))) }),
            { status: 200 },
          )
        : // No art: the text-only prefill.
          new Response(JSON.stringify({ ok: false }), { status: 200 }),
    ),
  );
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "llanowar-elves" });
  actions.linkDeckCardAction.mockResolvedValue({ ok: true });
}

function renderDeckPrefill() {
  render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      deckRemix={{
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: ELVES.id,
        deckSlug: "tester/elves",
        deckTitle: "Elves",
        entryName: ELVES.name,
      }}
    />,
  );
}

const titleInput = () => screen.getByPlaceholderText("Emberbound Wyrm") as HTMLInputElement;

async function goToLastStep() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}

async function saveAsDraft() {
  await goToLastStep();
  await act(async () => {
    fireEvent.click(screen.getByTestId("save-as-draft"));
  });
  await act(async () => {
    fireEvent.submit(screen.getByTestId("save-as-draft").closest("form")!);
  });
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
}

describe("import_unchanged on a new card's save", () => {
  it("an import saved with only its visibility changed: unchanged", async () => {
    stubNamedRoute();
    renderDeckPrefill();
    await waitFor(() => expect(screen.getAllByTestId("card-preview")[0]!.dataset.title).toBe("Llanowar Elves"));
    const payload = await saveAsDraft();
    expect(payload).toMatchObject({ title: "Llanowar Elves", source_scryfall_id: ELVES.id, import_unchanged: true });
  });

  it("an import whose name was changed: not unchanged", async () => {
    stubNamedRoute();
    renderDeckPrefill();
    await waitFor(() => expect(titleInput().value).toBe("Llanowar Elves"));
    await act(async () => {
      fireEvent.change(titleInput(), { target: { value: "Llanowar Elder" } });
    });
    const payload = await saveAsDraft();
    expect(payload).toMatchObject({ title: "Llanowar Elder", source_scryfall_id: ELVES.id, import_unchanged: false });
  });

  it("a card with no import this session never names the key", async () => {
    stubNamedRoute();
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "wyrm" });
    render(
      <CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />,
    );
    await act(async () => {
      fireEvent.click(screen.getAllByTitle("Go to Identity")[0]!);
    });
    await act(async () => {
      fireEvent.change(titleInput(), { target: { value: "Wyrm" } });
    });
    const payload = await saveAsDraft();
    expect(payload.title).toBe("Wyrm");
    expect(payload).not.toHaveProperty("import_unchanged");
  });
});

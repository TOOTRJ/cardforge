// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO DK0.6: in the deck-card flow (/create?deckCard=…) the card is linked
// into its own deck after the save, so the save must never carry a deck_id
// as well — that was a second entry for the same card. The Publish picker is
// hidden there; this holds the AI fill to the same rule, through the REAL
// CardCreatorForm: a fill that names a deck sets deck_id on a plain new card
// and never in the deck-card flow.
//
// The dialog is a stand-in; the jobs API is a stubbed fetch handing back the
// fill a step hands. No generation is run.
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
vi.mock("@/components/billing/credit-confirm-provider", () => ({
  useCreditConfirm: () => async () => true,
}));
const actions = vi.hoisted(() => ({ createCardAction: vi.fn(), updateCardAction: vi.fn() }));
vi.mock("@/lib/cards/actions", () => actions);
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn(async () => ({ ok: true, deckCardId: "e" })) }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
const EVERY_FIELD = ["card_type", "color_identity", "title", "cost", "rarity", "rules_text", "flavor_text", "stats", "art"];
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ onGenerate }: { onGenerate: (options: Record<string, unknown>) => void }) => (
    <button type="button" data-testid="run-fill" onClick={() => onGenerate({ want: EVERY_FIELD, design_kind: "card", frame: "card" })}>
      run fill
    </button>
  ),
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "77777777-7777-4777-8777-777777777777";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15", k));
const ART = `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png`;
const FILL = {
  art_url: ART,
  artist_credit: "Tester",
  rarity: "uncommon",
  deck_id: DECK,
  title: "Fill Title",
  cost: "{1}{R}",
  card_type: "instant",
  supertype: null,
  subtypes: [],
  color_identity: ["red"],
  rules_text: "Deal 2 damage to any target.",
  flavor_text: null,
  power: null,
  toughness: null,
  frame_template: "m15",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/ai/jobs") {
        return new Response(JSON.stringify({ ok: true, job: { id: "job-1" }, credits: 5 }), { status: 200 });
      }
      if (String(url).startsWith("/api/ai/jobs/job-1/step")) {
        return new Response(JSON.stringify({ ok: true, credits: 4, job: { steps: [{ status: "done", fill: FILL }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "card-1", slug: "made" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

/** Run the fill on a new card and save it: what the save hands the server. */
async function fillAndSave(deckRemix: Record<string, unknown> | null) {
  render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      myDecks={[{ id: DECK, title: "Burn", format: "modern" }]}
      deckRemix={deckRemix as never}
    />,
  );
  await click(screen.getByTestId("run-fill"));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
  await waitFor(() => expect(save().disabled).toBe(false));
  await click(save());
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return JSON.parse(JSON.stringify(actions.createCardAction.mock.calls[0]![0])) as Record<string, unknown>;
}

describe("an AI fill's deck (DK0.6)", () => {
  it("a plain new card takes the deck the fill names", async () => {
    const sent = await fillAndSave(null);
    expect(sent.deck_id).toBe(DECK);
  });

  it("the deck-card flow never does: the save links its own entry instead", async () => {
    const sent = await fillAndSave({
      deckCardId: "66666666-6666-4666-8666-666666666666",
      scryfallId: null,
      deckSlug: "burn",
      deckTitle: "Burn",
      entryName: "Shock",
    });
    expect(sent.deck_id ?? null).toBeNull();
  });
});

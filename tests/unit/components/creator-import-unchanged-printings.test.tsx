// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FRAME_TEMPLATE_VALUES, type GameSystem } from "@/types/card";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import importPrintings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// "Edited" = ANY change to the card (TODO DK2.5, owner 2026-10-29) — so the
// creator's baseline must be the import AFTER the form's own automatic steps
// have run on it (the art's fit, the frame follows, anatomy and kind
// defaults, the rows of a walker or saga, a second face): never the maker's
// edits, never a reason to call an untouched import Edited.
//
// Every printing of the import fixture (62: transform and modal DFCs, the
// walker backs, tokens, sagas, split / aftermath / Room, adventure / Omen,
// flip, class, case, meld, Dryad Arbor, reversible, the 1993 / 1997 / 2003
// frames…) lands through the deck pre-fill — the real handler, with its art
// — on a narrow and an everything-verified database, and for a paid account
// with its own default footer, is walked to the last step and saved
// untouched: `import_unchanged: true`. Then ONE change of the frame, the
// colour, the rarity or the crop alone reads Edited; and a keyboard walk
// that blurs every field, or a visit to the other face's tab, is no edit.
// Harness: tests/unit/components/creator-import-unchanged.test.tsx. The
// window that keeps the maker's own changes out of the baseline is
// creator-import-settle-window.test.tsx.
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
const ART = "https://example.supabase.co/storage/v1/object/public/card-art/u/imported.png";

/** The creator-form-reliability harness's database: the wave-1 frames. */
const NARROW = ["m15", "m15artifact", "m15land", "m15pw", "m15token", "saga", "battle", "split", "aftermath", "adventure", "flip"].flatMap(
  (t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
);
/** Everything published: every follow, dress and double-faced body lands. */
const EVERYTHING = FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)));

const PRINTINGS = importPrintings as unknown as Record<string, unknown>;
const printing = (key: string): ScryfallCard => scryfallCardSchema.parse(structuredClone(PRINTINGS[key]));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

function prefill(card: ScryfallCard, verified: readonly string[], account: { paid?: boolean; footer?: string } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/scryfall/named")) {
        return new Response(
          JSON.stringify({
            ok: true,
            card: { name: card.name, scryfall_uri: null },
            // What the route sends: the match finalized against the database.
            patch: JSON.parse(JSON.stringify(finalizeImportMatch(mapScryfallToFormPatch(card), new Set(verified)))),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/scryfall/import-art")) {
        return new Response(JSON.stringify({ ok: true, publicUrl: ART }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "imported" });
  actions.linkDeckCardAction.mockResolvedValue({ ok: true });
  render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      isPaid={account.paid}
      defaultFooterText={account.footer}
      verifiedFrameKeys={[...verified]}
      deckRemix={{
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      }}
    />,
  );
}

async function landed() {
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  // Let every effect the import set off run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function goToLastStep() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}

async function goTo(step: string) {
  await act(async () => {
    fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]!);
  });
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

const KEYS = Object.keys(PRINTINGS).sort();

describe.each([
  ["the wave-1 frames verified", NARROW, {}],
  ["everything verified", EVERYTHING, {}],
  // A subscriber: no forced watermark, their own default footer — what a
  // new card of theirs starts with is never "left over" (preImportChanges).
  ["everything verified, a paid account with a default footer", EVERYTHING, { paid: true, footer: "tester.art" }],
] as const)("an untouched import saves import_unchanged: true — %s", (_db, verified, account) => {
  it.each(KEYS)("%s", { timeout: 30_000 }, async (key) => {
    const card = printing(key);
    prefill(card, verified, account);
    await landed();
    const payload = await saveAsDraft();
    expect(payload.source_scryfall_id).toBe(card.id);
    expect(payload.import_unchanged).toBe(true);
  });
});

describe("one change alone reads Edited (Llanowar Elves DOM #168, everything verified)", () => {
  const elves = () => printing("dom-168");

  it("the rarity alone", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    await goTo("Text & stats");
    const rarity = screen.getByRole("radiogroup", { name: "Rarity" });
    await act(async () => {
      fireEvent.click(within(rarity).getByRole("radio", { name: /mythic/i }));
    });
    const payload = await saveAsDraft();
    expect(payload.rarity).toBe("mythic");
    expect(payload.import_unchanged).toBe(false);
  });

  it("the colour alone", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    await goTo("Card");
    const colour = screen.getByRole("radiogroup", { name: "Color identity" });
    await act(async () => {
      fireEvent.click(within(colour).getByRole("radio", { name: /^blue/i }));
    });
    const payload = await saveAsDraft();
    expect(payload.color_identity).toEqual(["blue"]);
    expect(payload.import_unchanged).toBe(false);
  });

  it("the frame alone", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    await goTo("Card");
    const variations = screen.getByRole("radiogroup", { name: "Frame variations" });
    const other = within(variations)
      .getAllByRole("radio")
      .find((chip) => chip.getAttribute("aria-checked") !== "true" && chip.getAttribute("aria-disabled") !== "true");
    expect(other).toBeTruthy();
    await act(async () => {
      fireEvent.click(other!);
    });
    const payload = await saveAsDraft();
    expect((payload.frame_style as { template: string }).template).not.toBe("m15");
    expect(payload.import_unchanged).toBe(false);
  });

  it("the art's crop alone", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    // An import opens on Identity, its picture's step.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Zoom in" })[0]!);
    });
    const payload = await saveAsDraft();
    expect((payload.art_position as { scale: number }).scale).toBeGreaterThan(1);
    expect(payload.import_unchanged).toBe(false);
  });

  it("and the same walk with no change: unchanged (a click on a step is not an edit)", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    await goTo("Card");
    await goTo("Text & stats");
    await goTo("Identity");
    const payload = await saveAsDraft();
    expect(payload.import_unchanged).toBe(true);
  });
});

// The other direction (the review of #664): what ISN'T an edit never reads
// as one — a keyboard walk that focuses and blurs every field (the form's
// print-typography pass runs on blur), and a visit to the other face's or
// part's tab on every step. Every printing, everything verified.
async function submitDraft() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("save-as-draft"));
  });
  await act(async () => {
    fireEvent.submit(screen.getByTestId("save-as-draft").closest("form")!);
  });
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
}

describe("no edit, no Edited: a keyboard walk that blurs every field", () => {
  it.each(KEYS)("%s", { timeout: 60_000 }, async (key) => {
    prefill(printing(key), EVERYTHING);
    await landed();
    const form = document.querySelector("form")!;
    await act(async () => {
      fireEvent.keyDown(form, { key: "Tab" });
    });
    const blurAll = async () => {
      for (const field of Array.from(form.querySelectorAll("input[name], textarea[name]"))) {
        await act(async () => {
          fireEvent.focusIn(field);
          fireEvent.focusOut(field);
        });
      }
    };
    await blurAll();
    while (screen.queryByRole("button", { name: /^Next/ })) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
      });
      await blurAll();
    }
    expect((await submitDraft()).import_unchanged).toBe(true);
  });
});

describe("no edit, no Edited: the other face's tab on every step", () => {
  it.each(KEYS)("%s", { timeout: 60_000 }, async (key) => {
    prefill(printing(key), EVERYTHING);
    await landed();
    const walk = async () => {
      while (screen.queryByRole("button", { name: /^Next/ })) {
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
        });
      }
    };
    // One-faced printings have no tab to visit.
    if (screen.queryAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") !== "true").length === 0) return;
    await act(async () => {
      fireEvent.click(screen.getAllByTitle(/^Go to /)[0]!);
    });
    for (const tab of screen.queryAllByRole("tab").filter((t) => t.getAttribute("aria-selected") !== "true")) {
      await act(async () => {
        fireEvent.click(tab);
      });
      await act(async () => {
        fireEvent.click(screen.getAllByTitle(/^Go to /)[0]!);
      });
      await walk();
    }
    await walk();
    expect((await submitDraft()).import_unchanged).toBe(true);
  });
});

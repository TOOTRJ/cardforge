// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 6.3 — the Nickname field through the real CardCreatorForm: what a
// save sends (CLAUDE.md "An EDIT never changes a field its maker did not
// touch": a card without a nickname never carries the key; an edit sends it
// only when it changed, null when emptied; a remix keeps its parent's), the
// field's FieldGroup shape (one input: named by its caption, described by
// its helper) and print typography on blur. Harness:
// creator-clear-fields-save.test.tsx.
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
// The ideas dialog needs the AI: a stand-in with ONE button that hands the
// form an idea through the same `onApply` the real one calls.
vi.mock("@/components/creator/card-ideas-dialog", () => ({
  CardIdeasDialog: (props: { onApply: (patch: { title: string }) => void }) => (
    <button type="button" data-testid="idea-apply" onClick={() => props.onApply({ title: "Gloomwood Stalker" })}>
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
const VERIFIED = ["m15", "m15pw", "m15land", "saga", "split", "aftermath", "adventure", "flip"].flatMap((t) =>
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
    flavor_text: "\"Hold the line.\"",
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

function renderForm(mode: "create" | "edit" | "remix", card?: Card) {
  return render(
    <CardCreatorForm
      mode={mode}
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  });
};
const field = (name: string) => {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
};
const type = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(name), { target: { value } });
  });
};
const sentUpdate = async () => {
  await save();
  await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
  return actions.updateCardAction.mock.calls[0][1] as Record<string, unknown>;
};

describe("what a save sends for the nickname", () => {
  it("an edit of a card without one never names the key (a retitle)", async () => {
    renderForm("edit", savedCard());
    await type("title", "Kesh, Emberforge Keeper");
    const payload = await sentUpdate();
    expect(payload.title).toBe("Kesh, Emberforge Keeper");
    expect(payload).not.toHaveProperty("nickname");
  });

  it("an edit of a card WITH one leaves it out while untouched", async () => {
    renderForm("edit", savedCard({ nickname: "The Ember Warden" }));
    await type("title", "Kesh, Emberforge Keeper");
    expect(await sentUpdate()).not.toHaveProperty("nickname");
  });

  it("an edit that types one sends it", async () => {
    renderForm("edit", savedCard());
    await type("nickname", "  The Ember Warden ");
    expect((await sentUpdate()).nickname).toBe("The Ember Warden");
  });

  it("an edit that empties it sends null (the column clears)", async () => {
    renderForm("edit", savedCard({ nickname: "The Ember Warden" }));
    await type("nickname", "   ");
    expect((await sentUpdate()).nickname).toBeNull();
  });

  it("a remix keeps its parent's nickname; a remix of a card without one names no key", async () => {
    // (A remix saves once something is changed: its name, here.)
    renderForm("remix", savedCard({ nickname: "The Ember Warden" }));
    await type("title", "Kesh, Remixed");
    await save();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect((actions.createCardAction.mock.calls[0][0] as Record<string, unknown>).nickname).toBe("The Ember Warden");
    cleanup();
    actions.createCardAction.mockClear();
    renderForm("remix", savedCard());
    await type("title", "Kesh, Remixed");
    await save();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0] as Record<string, unknown>).not.toHaveProperty("nickname");
  });

  it("is set as print sets it when the field loses focus", async () => {
    renderForm("edit", savedCard());
    await type("nickname", "Kesh's \"Last\" Stand");
    await act(async () => {
      fireEvent.blur(field("nickname"));
    });
    expect(field("nickname").value).toBe("Kesh’s “Last” Stand");
  });
});

describe("the Nickname field", () => {
  it("is ONE input named by its caption and described by its helper (FieldGroup field shape)", () => {
    renderForm("edit", savedCard());
    const input = screen.getByRole("textbox", { name: "Nickname" });
    expect(input).toBe(field("nickname"));
    expect(input.closest("label")).not.toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    const description = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(description?.textContent).toMatch(/prints in the title bar/);
    // The helper is never part of the name.
    expect(screen.queryByRole("textbox", { name: /title bar/ })).toBeNull();
  });

  it("says so on a frame that prints no nickname", () => {
    renderForm("edit", savedCard({ frame_style: { finish: "regular", template: "modern" } }));
    const input = screen.getByRole("textbox", { name: "Nickname" });
    const description = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(description?.textContent).toMatch(/this frame doesn't print a nickname/);
  });

  it("is folded away until it holds a value", () => {
    renderForm("edit", savedCard());
    expect((field("nickname").closest("details") as HTMLDetailsElement).open).toBe(false);
    cleanup();
    renderForm("edit", savedCard({ nickname: "The Ember Warden" }));
    expect((field("nickname").closest("details") as HTMLDetailsElement).open).toBe(true);
  });
});

// Owner Round 80: another card forgets the nickname of the card before it,
// as its borrowed words are — an idea, an AI fill that names the card.
const goTo = async (step: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
  });
};

describe("another card forgets the nickname", () => {
  it("an idea", async () => {
    renderForm("create");
    await goTo("Identity");
    await type("nickname", "The Ember Warden");
    await act(async () => {
      fireEvent.click(screen.getByTestId("idea-apply"));
    });
    expect(field("title").value).toBe("Gloomwood Stalker");
    expect(field("nickname").value).toBe("");
  });

  it("an AI fill that names the card (the one offered back after a reload)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/ai/card-fill?")) {
          return new Response(
            JSON.stringify({ ok: true, fill: { jobId: "j1", result: { title: "Gloomwood Stalker", card_type: "creature" }, createdAt: "2026-10-21T00:00:00Z" } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }),
    );
    renderForm("create");
    await goTo("Identity");
    await type("nickname", "The Ember Warden");
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    const options = toast.info.mock.calls.at(-1)![1] as { action: { onClick: () => void } };
    await act(async () => {
      options.action.onClick();
    });
    expect(field("title").value).toBe("Gloomwood Stalker");
    expect(field("nickname").value).toBe("");
  });

  it("…but an edit keeps the card's own", async () => {
    renderForm("edit", savedCard({ nickname: "The Ember Warden" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("idea-apply"));
    });
    expect(field("nickname").value).toBe("The Ember Warden");
  });
});

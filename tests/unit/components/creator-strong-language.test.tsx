// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { STRONG_LANGUAGE_CHOICE_REASON } from "@/lib/moderation/profanity";
import { chipOff } from "../helpers/chip";

// ---------------------------------------------------------------------------
// The creator's side of the strong-language rule (owner policy 2026-10-28):
// while the card's text holds strong language the Publish step says so in
// ONE polite note naming the fields, its Public / Unlisted choices are
// unavailable (aria-disabled, the reason in their name, none shown picked),
// the save sends private, and ONE toast after it says why — also when the
// server is the one that kept it private. A clean card saves exactly as
// before. The real CardCreatorForm, its actions stubbed (the harness of
// creator-form-reliability.test.tsx). The word is ROT13'd: the repo is
// public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const STRONG = rot13("fuvg");

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
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15", k));

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Emberbound Wyrm",
    slug: "emberbound-wyrm",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Dragon"],
    tags: [],
    rarity: "rare",
    rules_text: "Flying",
    flavor_text: null,
    power: "5",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: null,
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
    updated_at: "2026-09-26T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
}

type FormProps = Parameters<typeof CardCreatorForm>[0];
function renderForm(props: Partial<FormProps>) {
  return render(
    <CardCreatorForm
      mode="edit"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
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
const titleInput = () => screen.getByPlaceholderText("Emberbound Wyrm") as HTMLInputElement;
async function typeTitle(value: string) {
  await act(async () => {
    fireEvent.change(titleInput(), { target: { value } });
  });
}
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (!button) throw new Error(`no step ${step}`);
  await click(button);
}
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
const visibilityChip = (label: RegExp) => {
  const group = screen.getByRole("radiogroup", { name: "Visibility" });
  const chip = Array.from(group.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? ""));
  if (!chip) throw new Error(`no chip ${label}`);
  return chip;
};
const note = () => screen.getByTestId("strong-language-note");

describe("the Publish step while the text holds strong language", () => {
  it("a clean card: no note, both choices open, Public picked", async () => {
    renderForm({ card: savedCard() });
    await goTo(/Publish/);
    expect(note().textContent).toBe("");
    expect(chipOff(visibilityChip(/^Public/))).toBe(false);
    expect(chipOff(visibilityChip(/^Unlisted/))).toBe(false);
    expect(visibilityChip(/^Public/).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "Visibility" }).getAttribute("aria-describedby")).toBeNull();
  });

  it("names the field in ONE polite note; both choices are unavailable with the reason, none picked", async () => {
    renderForm({ card: savedCard() });
    await typeTitle(`${STRONG} Wyrm`);
    await goTo(/Publish/);
    expect(note().getAttribute("role")).toBe("status");
    expect(note().textContent).toBe(
      "This card's name includes strong language, so it will be saved as private. Remove it to publish.",
    );
    for (const label of [/^Public/, /^Unlisted/]) {
      const chip = visibilityChip(label);
      expect(chipOff(chip)).toBe(true);
      expect(chip.textContent).toContain(STRONG_LANGUAGE_CHOICE_REASON);
      expect(chip.getAttribute("aria-checked")).toBe("false");
    }
    const group = screen.getByRole("radiogroup", { name: "Visibility" });
    expect(group.getAttribute("aria-describedby")).toBe(note().id);
    // Never an alert of its own.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the words removed, the maker's choice is back", async () => {
    renderForm({ card: savedCard() });
    await typeTitle(`${STRONG} Wyrm`);
    await typeTitle("Emberbound Wyrm, Reborn");
    await goTo(/Publish/);
    expect(note().textContent).toBe("");
    expect(visibilityChip(/^Public/).getAttribute("aria-checked")).toBe("true");
  });

  it("a choice still open says nothing more than its chips: an unlisted card kept from Public", async () => {
    renderForm({ card: savedCard({ visibility: "unlisted", flavor_text: STRONG }) });
    await goTo(/Publish/);
    expect(chipOff(visibilityChip(/^Public/))).toBe(true);
    expect(visibilityChip(/^Public/).textContent).toContain(STRONG_LANGUAGE_CHOICE_REASON);
    expect(chipOff(visibilityChip(/^Unlisted/))).toBe(false);
    expect(visibilityChip(/^Unlisted/).getAttribute("aria-checked")).toBe("true");
    // Its current choice saves as asked: no note.
    expect(note().textContent).toBe("");
    expect(screen.getByRole("radiogroup", { name: "Visibility" }).getAttribute("aria-describedby")).toBeNull();
  });

  it("an edit of a card already public that adds none is left alone (not retroactive)", async () => {
    renderForm({ card: savedCard({ flavor_text: STRONG }) });
    await goTo(/Publish/);
    expect(note().textContent).toBe("");
    expect(chipOff(visibilityChip(/^Public/))).toBe(false);
  });
});

describe("the save", () => {
  it("edit: sends private and ONE toast says why", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "emberbound-wyrm" });
    renderForm({ card: savedCard() });
    await typeTitle(`${STRONG} Wyrm`);
    await click(saveButton());
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    expect(actions.updateCardAction.mock.calls[0][1]).toMatchObject({ visibility: "private" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        `Saved “${STRONG} Wyrm” as private — its name includes strong language. Remove it to publish.`,
      ),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.message).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    // A private card is no first publish: no share prompt, no card page.
    expect(router.push).not.toHaveBeenCalled();
  });

  it("edit: a clean save is exactly as before", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "emberbound-wyrm" });
    renderForm({ card: savedCard() });
    await typeTitle("Emberbound Wyrm, Reborn");
    await click(saveButton());
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    expect(actions.updateCardAction.mock.calls[0][1]).toMatchObject({ visibility: "public" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Changes saved."));
  });

  it("remix: the server kept it private (a word this form didn't see) — the toast says so, no share prompt", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "wyrm-reborn",
      forcedPrivate: { reason: "profanity", fields: ["rules_text"] },
    });
    renderForm({ mode: "remix", card: savedCard() });
    await typeTitle("Wyrm Reborn");
    await click(saveButton());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0]).toMatchObject({ visibility: "public" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Saved “Wyrm Reborn” as private — its rules text includes strong language. Remove it to publish.",
      ),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    // Stays in the editor as a draft would — never the public share flow.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/card\/wyrm-reborn\/edit/)));
  });

  it("remix: a typed word sends private", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "x" });
    renderForm({ mode: "remix", card: savedCard() });
    await typeTitle(`${STRONG} Reborn`);
    await click(saveButton());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0]).toMatchObject({ visibility: "private" });
  });
});

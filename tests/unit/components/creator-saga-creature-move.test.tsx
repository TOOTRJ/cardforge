// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, FaceContent, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveSagaCreature } from "@/lib/cards/saga-creature";
import { SAGA_CREATURE_NEEDS_CHAPTER } from "@/lib/creator/form-schema";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.5d — the saga creature body in the REAL CardCreatorForm (the
// independent check of #651): an edit that moves a saga on or off the
// `sagacreature` frame re-reads its rows for the new frame; the Creature
// abilities field stays shown wherever it holds a value; and a box with no
// chapter to follow blocks the save and says so.
// (The text model itself: tests/unit/creator/saga-creature-text-model.test.ts.)
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
const actions = vi.hoisted(() => ({ createCardAction: vi.fn(), updateCardAction: vi.fn() }));
vi.mock("@/lib/cards/actions", () => actions);
vi.mock("@/lib/cards/dfc-adopt-actions", () => ({ adoptDfcBodiesAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));
vi.mock("@/components/creator/art-uploader", () => ({
  ArtUploader: (props: {
    fieldAnchor?: string;
    onArtChange: (next: { artUrl: string | null; artPosition: { focalX: number; focalY: number; scale: number } }) => void;
  }) => (
    <button
      type="button"
      data-field-anchor={props.fieldAnchor}
      data-art-stub={props.fieldAnchor}
      onClick={() => props.onArtChange({ artUrl: "https://example.com/front.png", artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 } })}
    >
      set art
    </button>
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)));

const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after V.)";
const FIN_36 = [
  REMINDER,
  "I, II, III, IV — Create three 2/2 white Knight creature tokens.",
  "V — Ultimate End — Other creatures you control get +2/+2 until end of turn.",
  "Indestructible",
].join("\n");

function summon(template: string, rules_text: string, face_content: FaceContent | null = null): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Summon: Knights of Round",
    slug: "summon-knights-of-round",
    game_system_id: GAME,
    cost: "{3}{W}{W}",
    color_identity: ["white"],
    supertype: "Creature",
    printed_types: null,
    card_type: "enchantment",
    subtypes: ["Saga", "Knight"],
    tags: [],
    rarity: "mythic",
    rules_text,
    flavor_text: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template },
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-28T10:00:00.000Z",
  } as unknown as Card;
}

function renderForm(mode: "create" | "edit", card?: Card) {
  return render(
    <CardCreatorForm
      mode={mode}
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={VERIFIED}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
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
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  // (The open step's own entry may not be a button.)
  if (button) await click(button);
}
async function reach<T extends Element>(find: () => T | null, what: string): Promise<T> {
  if (find()) return find()!;
  for (const step of [/^card/i, /^identity/i, /^text/i, /^publish/i]) {
    const rail = screen.getByRole("navigation", { name: /card editor steps/i });
    const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
    if (button) await click(button);
    if (find()) return find()!;
  }
  throw new Error(`not found anywhere: ${what}`);
}
async function type(name: string, value: string) {
  const el = await reach(() => document.querySelector<HTMLInputElement>(`[name='${name}']`), name);
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
async function typeTypes(value: string) {
  const el = await reach(() => document.querySelector<HTMLInputElement>("[data-testid='types-field-input-front']"), "types field");
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
async function chip(group: string, label: RegExp) {
  const el = await reach(() => {
    const radiogroup = Array.from(document.querySelectorAll("[role='radiogroup']")).find((g) => g.getAttribute("aria-label") === group);
    return (
      (Array.from(radiogroup?.querySelectorAll("[role='radio']") ?? []).find((c) => label.test(c.textContent ?? "")) as HTMLElement | undefined) ??
      null
    );
  }, `${group} ${label}`);
  await click(el);
}
const rich = (name: string) => document.querySelector<HTMLElement>(`[data-field='${name}']`);
async function typeRich(name: string, value: string) {
  const el = await reach(() => rich(name), name);
  await act(async () => {
    el.textContent = value;
    fireEvent.input(el);
    fireEvent.blur(el);
  });
}
const creatureField = () => document.querySelector<HTMLElement>("[aria-label='Creature abilities']");
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function sent(action: "createCardAction" | "updateCardAction") {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await click(saveButton());
  await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
  const call = actions[action].mock.calls[0];
  return (action === "createCardAction" ? call[0] : call[1]) as Record<string, unknown>;
}
async function blockedSave() {
  await click(saveButton());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(actions.updateCardAction).not.toHaveBeenCalled();
  expect(actions.createCardAction).not.toHaveBeenCalled();
}
const template = (payload: Record<string, unknown>) => (payload.frame_style as { template: string }).template;

/** A new Saga in white with a picture, a name and one chapter. */
async function newSaga() {
  renderForm("create");
  await chip("Card type", /^Saga/);
  await chip("Color identity", /^white/i);
  await type("title", "Summon: Knights of Round");
  await click(await reach(() => document.querySelector("[data-art-stub='art_url']"), "art"));
  if (!rich("saga_chapters.0.text")) {
    await click(await reach(() => screen.queryByRole("button", { name: /Add chapter/ }), "Add chapter"));
  }
  await typeRich("saga_chapters.0.text", "Create three 2/2 white Knight creature tokens.");
}

describe("a NEW saga creature in the creator", () => {
  it("the Creature word moves it onto the body, the box's field shows, and its lines save after the chapters", async () => {
    await newSaga();
    await goTo(/text/i);
    expect(creatureField()).toBeNull();
    await typeTypes("Enchantment Creature");
    await type("power", "3");
    await type("toughness", "3");
    await goTo(/text/i);
    expect(creatureField()).not.toBeNull();
    await typeRich("saga_creature_text", "- Indestructible");
    const payload = await sent("createCardAction");
    expect(template(payload)).toBe("sagacreature");
    const rules = payload.rules_text as string;
    expect(rules).toBe("I — Create three 2/2 white Knight creature tokens.\n• Indestructible");
    // Drawn once, in the box — the leading "•" kept.
    const drawn = resolveSagaCreature(payload.face_content as FaceContent, rules);
    expect(drawn.creatureText).toBe("• Indestructible");
    expect(drawn.chapters.map((c) => c.text)).toEqual(["Create three 2/2 white Knight creature tokens."]);
  });

  it("moved back off the body, the box's lines stay — the field shown, saying the frame doesn't print them", async () => {
    await newSaga();
    await typeTypes("Enchantment Creature");
    await type("power", "3");
    await type("toughness", "3");
    await typeRich("saga_creature_text", "Indestructible");
    await typeTypes("Enchantment");
    await goTo(/text/i);
    expect(creatureField()?.textContent).toBe("Indestructible");
    expect(document.body.textContent).toContain("This frame doesn’t print them");
    const payload = await sent("createCardAction");
    expect(template(payload)).toBe("saga");
    expect((payload.rules_text as string).endsWith("\nIndestructible")).toBe(true);
  });

  it("the box with no chapter to follow: the field says so, and the save waits with the reason", async () => {
    await newSaga();
    await typeTypes("Enchantment Creature");
    await type("power", "3");
    await type("toughness", "3");
    await typeRich("saga_creature_text", "Indestructible");
    await typeRich("saga_chapters.0.text", "");
    await goTo(/text/i);
    expect(document.body.textContent).toContain("Add a chapter first: these lines are saved after the last chapter.");
    await blockedSave();
    expect(document.body.textContent).toContain(SAGA_CREATURE_NEEDS_CHAPTER);
  });
});

describe("an EDIT of a stored saga creature", () => {
  const rows: FaceContent = {
    v: 1,
    saga: {
      intro: REMINDER,
      chapters: [
        { numerals: [1, 2, 3, 4], text: "Create three 2/2 white Knight creature tokens." },
        { numerals: [5], text: "Ultimate End — Other creatures you control get +2/+2 until end of turn." },
      ],
    },
  };

  it.each([
    ["stored as plain text", null],
    ["stored with rows", rows],
  ])("%s: the box opens with its line, and a retitle sends the stored text byte for byte", async (_, faceContent) => {
    renderForm("edit", summon("sagacreature", FIN_36, faceContent));
    await goTo(/text/i);
    expect(creatureField()?.textContent).toBe("Indestructible");
    expect(rich("saga_chapters.1.text")?.textContent).not.toContain("Indestructible");
    await type("title", "Summon: Knights of the Round");
    const payload = await sent("updateCardAction");
    expect(payload.rules_text).toBe(FIN_36);
  });
});

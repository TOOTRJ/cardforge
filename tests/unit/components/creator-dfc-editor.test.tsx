// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 5.2 — the double-faced editor through the real CardCreatorForm: the
// Transform chip (dark until a front AND the default back are verified; the
// Modal chip the same on 5.1b's bodies), the Card step's face-type and icon-family
// rows, the back-face panel on the Identity step, the live preview's back
// (its own body and colour, flipped when the panel takes focus), the save
// (the derived body, the explicit colour, no cost on a transform back, the
// back's art required to publish), an edit's family patch, and the Q3 hint
// on an imported card.
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
  adoptDfcBodiesAction: vi.fn(),
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/cards/dfc-adopt-actions", () => ({ adoptDfcBodiesAction: actions.adoptDfcBodiesAction }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
// The live preview reports what it was handed: the face shown and the back.
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: {
    cardType?: string | null;
    frameStyle?: { template?: string; dfcIcon?: string };
    colorIdentity?: string[];
    face?: string;
    backFace?: unknown;
  }) => (
    <div
      data-testid="card-preview"
      data-card-type={props.cardType ?? ""}
      data-template={props.frameStyle?.template ?? ""}
      data-family={props.frameStyle?.dfcIcon ?? ""}
      data-colour={JSON.stringify(props.colorIdentity ?? [])}
      data-face={props.face ?? ""}
      data-back-face={JSON.stringify(props.backFace ?? null)}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const BASE_VERIFIED = ["m15", "m15artifact", "m15land", "m15pw", "m15token", "saga", "battle", "split", "aftermath", "adventure", "flip"].flatMap((t) =>
  EVERY_COLOUR.map((k) => frameComboKey(t, k)),
);
const TRANSFORM_VERIFIED = [
  ...BASE_VERIFIED,
  frameComboKey("m15dfcfront", "u"),
  frameComboKey("m15dfcfront", "g"),
  frameComboKey("m15dfclandfront", "c"),
  frameComboKey("m15dfcback", "u"),
  frameComboKey("m15dfcback", "g"),
  frameComboKey("m15dfcbackleft", "u"),
  frameComboKey("m15dfcbackleft", "g"),
  frameComboKey("m15dfcbackleft", "c"),
  frameComboKey("m15dfclandback", "c"),
];

type FormProps = Parameters<typeof CardCreatorForm>[0];
function renderForm(props: Partial<FormProps> = {}) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={TRANSFORM_VERIFIED}
      {...props}
    />,
  );
}

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Delver of Secrets",
    slug: "delver-of-secrets",
    game_system_id: GAME,
    cost: "{U}",
    color_identity: ["blue"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Human", "Wizard"],
    tags: [],
    rarity: "common",
    rules_text: null,
    flavor_text: null,
    power: "1",
    toughness: "1",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "m15dfcfront", dfcIcon: "arrows", collector: "2023" },
    visibility: "public",
    back_face: {
      title: "Insectile Aberration",
      card_type: "creature",
      subtypes: ["Human", "Insect"],
      power: "3",
      toughness: "2",
      art_url: "https://example.com/back.png",
      frame_style: { template: "m15dfcback" },
      color_identity: ["blue"],
    },
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-02T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
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

function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    cardType: el.dataset.cardType,
    template: el.dataset.template,
    family: el.dataset.family,
    colour: JSON.parse(el.dataset.colour ?? "[]") as string[],
    face: el.dataset.face,
    backFace: JSON.parse(el.dataset.backFace ?? "null") as Record<string, unknown> | null,
  };
}
function chipIn(group: string, label: RegExp) {
  const radiogroup = screen.getByRole("radiogroup", { name: group });
  const chip = Array.from(radiogroup.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? "")) as HTMLButtonElement | undefined;
  if (!chip) throw new Error(`no ${group} chip ${label}`);
  return chip;
}
async function clickChip(group: string, label: RegExp) {
  await act(async () => {
    fireEvent.click(chipIn(group, label));
  });
}
/** Jump the step rail (xl+; the rail renders the ACTIVE step as a non-button). */
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (!button) throw new Error(`no step ${step}`);
  await act(async () => {
    fireEvent.click(button);
  });
}
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function setField(placeholder: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
  });
}

describe("the kind chips", () => {
  it("Transform is dark with the hint until a front AND the default back are verified; Modal stays dark", () => {
    renderForm({ verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15dfcfront", "u")] });
    const transform = chipIn("Card type", /^Transform/);
    expect(transform.disabled).toBe(true);
    expect(transform.textContent).toMatch(/Frames awaiting verification/);
    expect(chipIn("Card type", /Modal double-faced/).disabled).toBe(true);
    cleanup();
    renderForm();
    expect(chipIn("Card type", /^Transform/).disabled).toBe(false);
    expect(chipIn("Card type", /^Transform/).textContent).toMatch(/the front transforms into its back/);
    expect(chipIn("Card type", /Modal double-faced/).disabled).toBe(true);
  });
});

describe("a new transform card", () => {
  it("picking Transform moves onto the front body with the arrows family and a forced creature back; the face-type and family rows appear", async () => {
    renderForm();
    await clickChip("Card type", /^Transform/);
    expect(preview().template).toBe("m15dfcfront");
    expect(preview().family).toBe("arrows");
    expect(preview().cardType).toBe("creature");
    expect(screen.getByTestId("dfc-front-type")).toBeTruthy();
    expect(screen.getByTestId("dfc-icon-family")).toBeTruthy();
    // The new card was colourless; the front body isn't verified in `c`
    // here, so the colour followed the frame to blue (and said so).
    expect(preview().colour).toEqual(["blue"]);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/switched the colour to blue/));
    // The back draws on its own body in the front's colour — the preview's
    // backFace carries the body and the colour the save will store.
    expect(preview().backFace).toMatchObject({ card_type: "creature", frame_style: { template: "m15dfcback" }, color_identity: ["blue"] });
  });

  it("a double-faced creature can't be colourless (D2): the front's `c` verified, the colour still moves off it and says so; the Colorless chip is dark with the reason until the type says Artifact", async () => {
    renderForm({ verifiedFrameKeys: [...TRANSFORM_VERIFIED, frameComboKey("m15dfcfront", "c")] });
    await clickChip("Card type", /^Transform/);
    expect(preview().colour).toEqual(["blue"]);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/can't be colourless — switched the colour to blue/));
    expect(chipIn("Color identity", /^colorless/i).disabled).toBe(true);
    expect(chipIn("Color identity", /^colorless/i).textContent).toMatch(/needs “Artifact”/);
    await clickChip("Front face type", /^Artifact/);
    expect(chipIn("Color identity", /^colorless/i).disabled).toBe(false);
    await clickChip("Color identity", /^colorless/i);
    expect(preview().colour).toEqual(["colorless"]);
    // Back to a creature: off colourless again.
    await clickChip("Front face type", /^Creature/);
    expect(preview().colour).toEqual(["blue"]);
  });

  it("the front's face type moves the card between the spell and the land front, keeping the colour verified", async () => {
    renderForm();
    await clickChip("Card type", /^Transform/);
    await clickChip("Color identity", /^blue/i);
    expect(preview().colour).toEqual(["blue"]);
    await clickChip("Front face type", /^Land/);
    expect(preview().cardType).toBe("land");
    expect(preview().template).toBe("m15dfclandfront");
    // The land front is verified in colourless only: the colour follows.
    expect(preview().colour).toEqual(["colorless"]);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/switched the colour to colorless/));
    await clickChip("Front face type", /^Creature/);
    expect(preview().template).toBe("m15dfcfront");
  });

  it("the family picks the back body; the back's own colour wins over the front's; the panel flips the preview on focus", async () => {
    renderForm();
    await clickChip("Card type", /^Transform/);
    await clickChip("Color identity", /^blue/i);
    await clickChip("Transform icon family", /Sun \/ moon/);
    expect(preview().family).toBe("sunmoon");
    expect(preview().backFace).toMatchObject({ frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] });
    await goTo(/^identity$/i);
    const panel = screen.getByTestId("dfc-face-panel");
    expect(panel).toBeTruthy();
    // No cost on a transform back; the type chips and the colour chips show.
    expect(screen.queryByText(/^Cost$/)).toBeNull();
    expect(preview().face).toBe("front");
    await act(async () => {
      fireEvent.focus(screen.getByPlaceholderText("Insectile Aberration"));
    });
    expect(preview().face).toBe("back");
    await clickChip("Back face color", /^green/i);
    expect(preview().backFace).toMatchObject({ color_identity: ["green"] });
    // The back's own body in the summary; its unverified colours are dark.
    expect(chipIn("Back face color", /^red/i).disabled).toBe(true);
    // A colourless back needs an Artifact word on a spell body (D2): the
    // chip is dark with the reason until the back's type says Artifact.
    expect(chipIn("Back face color", /^colorless/i).disabled).toBe(true);
    expect(chipIn("Back face color", /^colorless/i).textContent).toMatch(/needs “Artifact”/);
    await clickChip("Back face type", /^Artifact/);
    expect(chipIn("Back face color", /^colorless/i).disabled).toBe(false);
  });

  it("a land back goes colourless (the land back is verified on `c` alone) and follows the front again when the type leaves land", async () => {
    renderForm();
    await clickChip("Card type", /^Transform/);
    await clickChip("Color identity", /^green/i);
    await goTo(/^identity$/i);
    await clickChip("Back face type", /^Land/);
    expect(preview().backFace).toMatchObject({ frame_style: { template: "m15dfclandback" }, color_identity: ["colorless"] });
    expect(chipIn("Back face color", /^colorless/i).disabled).toBe(false);
    await clickChip("Back face type", /^Creature/);
    expect(preview().backFace).toMatchObject({ frame_style: { template: "m15dfcback" }, color_identity: ["green"] });
  });

  it("saves the derived body, the explicit colour and no cost; the back's art is needed to publish", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "delver-of-secrets" });
    renderForm();
    await clickChip("Card type", /^Transform/);
    await clickChip("Color identity", /^blue/i);
    await goTo(/^identity$/i);
    await setField("Emberbound Wyrm", "Delver of Secrets");
    await setField("Insectile Aberration", "Insectile Aberration");
    // Front art, no back art: the Save hint asks for the back's artwork.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Add artwork and the back face's artwork to enable Save/)).toBeTruthy();
    expect(actions.createCardAction).not.toHaveBeenCalled();
    // A draft needs neither.
    await goTo(/^publish$/i);
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    expect(saveButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.frame_style).toMatchObject({ template: "m15dfcfront", dfcIcon: "arrows" });
    expect(payload.back_face).toMatchObject({
      title: "Insectile Aberration",
      card_type: "creature",
      frame_style: { template: "m15dfcback" },
      color_identity: ["blue"],
    });
    expect(payload.back_face).not.toHaveProperty("cost");
    expect(payload).not.toHaveProperty("back_card_id");
    expect(payload.visibility).toBe("private");
  });

  it("leaving the Transform kind drops the forced back face with it", async () => {
    renderForm();
    await clickChip("Card type", /^Transform/);
    expect(preview().backFace).not.toBeNull();
    await clickChip("Card type", /^Creature$/);
    expect(preview().template).toBe("m15");
    expect(preview().backFace).toBeNull();
  });
});

describe("editing a stored transform card", () => {
  it("locks the back's type AND colour (owner 2026-10-05) with the lock's copy, shows the family chips in the panel, and sends a family change as frame_anatomy.dfcIcon with the stored colour", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "delver-of-secrets" });
    renderForm({ mode: "edit", card: savedCard() });
    expect(screen.getByTestId("dfc-back-type-locked").textContent).toMatch(/Creature/);
    expect(screen.queryByRole("radiogroup", { name: "Back face type" })).toBeNull();
    // The colour is read-only too: no chips, the stored colour named, and
    // the lock's copy (a colour change would move the back onto another
    // master — what the lock exists for).
    expect(screen.getByTestId("dfc-back-color-locked").textContent).toMatch(/Blue/);
    expect(screen.queryByRole("radiogroup", { name: "Back face color" })).toBeNull();
    expect(screen.queryByTestId("dfc-back-color")).toBeNull();
    expect(screen.getByTestId("dfc-face-panel").textContent).toMatch(/set when the card is created, like the front's/);
    expect(screen.getByTestId("dfc-icon-family-revise")).toBeTruthy();
    expect(screen.getByTestId("locked-summary").textContent).toMatch(/Creature — Human Wizard · Transform/);
    await clickChip("Transform icon family", /Sun \/ moon/);
    expect(preview().backFace).toMatchObject({ frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.updateCardAction.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.frame_anatomy).toEqual({ dfcIcon: "sunmoon" });
    expect(payload).not.toHaveProperty("frame_style");
    expect(payload.back_face).toMatchObject({ frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] });
  });

  it("a remix locks the back's type and colour the same way (kept from the original)", () => {
    renderForm({ mode: "remix", card: savedCard({ back_face: { ...(savedCard().back_face as object), color_identity: ["green"] } }) });
    expect(screen.getByTestId("dfc-back-type-locked").textContent).toMatch(/Creature/);
    expect(screen.getByTestId("dfc-back-color-locked").textContent).toMatch(/Green/);
    expect(screen.queryByRole("radiogroup", { name: "Back face color" })).toBeNull();
    // The preview's back keeps the stored colour.
    expect(preview().backFace).toMatchObject({ color_identity: ["green"] });
  });
});

describe("an imported double-faced card (the Q3 hint)", () => {
  const legacy = () =>
    savedCard({
      frame_style: { finish: "regular", template: "m15" },
      back_face: { title: "Insectile Aberration", card_type: "creature", power: "3", toughness: "2", art_url: "https://example.com/back.png" },
    });

  it("shows the move, dark until both bodies are verified in the card's colour, and calls the action on click", async () => {
    renderForm({ mode: "edit", card: legacy(), verifiedFrameKeys: BASE_VERIFIED });
    expect(screen.getByTestId("dfc-adopt-hint")).toBeTruthy();
    expect(screen.queryByTestId("dfc-face-panel")).toBeNull();
    const move = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    expect(screen.getByText(/Frames awaiting verification in this card's colour/)).toBeTruthy();
    cleanup();

    actions.adoptDfcBodiesAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "delver-of-secrets", frontBody: "m15dfcfront", backBody: "m15dfcback" });
    renderForm({ mode: "edit", card: legacy() });
    const button = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toMatch(/Move onto the transform frames/);
    // ONE layout — the one the back's shape derives (no cost: transform);
    // no chip row to pick another (owner 2026-10-05).
    expect(screen.queryByRole("radiogroup", { name: "Double-faced layout" })).toBeNull();
    expect(screen.getByTestId("dfc-adopt-hint").textContent).toMatch(/the front gets the transform front/);
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(actions.adoptDfcBodiesAction).toHaveBeenCalledWith(CARD_ID, "transform"));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Moved onto the transform frames/));
  });

  it("judges a LAND back in colourless, the colour the move gives it — Tobirama lights with the front in white and the land back in `c`", () => {
    // The production row's back keeps its printed "(Transforms from …)"
    // reminder — the sign that reads a cost-less LAND back as a transform
    // card (skeptic 2026-10-05; a modal land back never says the word).
    const tobirama = (backRules = "(Transforms from Ojer Taq, Deepest Foundation.)\n{T}: Add {W}.") =>
      savedCard({
        color_identity: ["white"],
        frame_style: { finish: "regular", template: "m15" },
        back_face: { title: "Temple of Civilization", card_type: "land", rules_text: backRules },
      });
    renderForm({
      mode: "edit",
      card: tobirama(),
      verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfclandback", "c")],
    });
    const button = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.getByTestId("dfc-adopt-hint").textContent).toMatch(/colourless — a land has none/);
    cleanup();
    // The same land back without the sign (a ZNR modal land's shape) is a
    // modal card: the hint offers the MODAL pair (5.1b) — dark on the
    // transform land back's ticks, judged in the front's colour (the modal
    // land back is one tint per colour), lit once both modal bodies are
    // ticked in white.
    renderForm({
      mode: "edit",
      card: tobirama("{T}: Add {W}."),
      verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfclandback", "c")],
    });
    const modalDark = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(modalDark.textContent).toMatch(/Move onto the modal double-faced frames/);
    expect(modalDark.disabled).toBe(true);
    expect(screen.getByTestId("dfc-adopt-hint").textContent).toMatch(/colour \(the front's\)/);
    cleanup();
    renderForm({
      mode: "edit",
      card: tobirama("{T}: Add {W}."),
      verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15mdfcfront", "w"), frameComboKey("m15mdfclandback", "w")],
    });
    expect((screen.getByTestId("dfc-adopt-move") as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    // The land back in the front's white is never what the move writes.
    renderForm({
      mode: "edit",
      card: tobirama(),
      verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfclandback", "w")],
    });
    expect((screen.getByTestId("dfc-adopt-move") as HTMLButtonElement).disabled).toBe(true);
  });

  it("never shows for a card on a DFC body, nor for one with a walker back", () => {
    renderForm({ mode: "edit", card: savedCard() });
    expect(screen.queryByTestId("dfc-adopt-hint")).toBeNull();
    cleanup();
    renderForm({ mode: "edit", card: savedCard({ frame_style: { template: "m15" }, back_face: { title: "Tibalt", card_type: "planeswalker", loyalty: "5" } }) });
    expect(screen.queryByTestId("dfc-adopt-hint")).toBeNull();
  });

  it("a legacy back WITH a mana cost is a modal card (owner 2026-10-05): the hint offers the modal pair alone (5.1b), dark until both modal bodies are verified in the card's colour — every transform combo verified or not", async () => {
    const vader = () =>
      savedCard({
        color_identity: ["black"],
        cost: "{2}{B}",
        frame_style: { finish: "regular", template: "m15" },
        back_face: {
          title: "Tergrid's Lantern",
          card_type: "artifact",
          cost: "{3}{B}",
          rules_text: "{T}: Target player loses 3 life unless they sacrifice a nonland permanent or discard a card.",
        },
      });
    renderForm({
      mode: "edit",
      card: vader(),
      verifiedFrameKeys: [...TRANSFORM_VERIFIED, frameComboKey("m15dfcfront", "b"), frameComboKey("m15dfcback", "b")],
    });
    const dark = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(dark.textContent).toMatch(/Move onto the modal double-faced frames/);
    expect(dark.disabled).toBe(true);
    expect(screen.getByTestId("dfc-adopt-hint").textContent).toMatch(/the front gets the modal double-faced front/);
    expect(screen.queryByRole("radiogroup", { name: "Double-faced layout" })).toBeNull();
    // Still a legacy back: no back-face panel either.
    expect(screen.queryByTestId("dfc-face-panel")).toBeNull();
    cleanup();
    actions.adoptDfcBodiesAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "vader", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    renderForm({
      mode: "edit",
      card: vader(),
      verifiedFrameKeys: [...BASE_VERIFIED, frameComboKey("m15mdfcfront", "b"), frameComboKey("m15mdfcback", "b")],
    });
    const lit = screen.getByTestId("dfc-adopt-move") as HTMLButtonElement;
    expect(lit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(lit);
    });
    await waitFor(() => expect(actions.adoptDfcBodiesAction).toHaveBeenCalledWith(CARD_ID, "modal"));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Moved onto the modal double-faced frames/));
  });
});

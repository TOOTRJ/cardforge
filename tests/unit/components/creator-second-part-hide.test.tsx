// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// A second part's never-drawn fields (TODO 5.14, owner round 52, 2026-10-13):
// on the second tab of a split, aftermath, adventure or flip card a field the
// card NEVER DRAWS is hidden while it is empty and shown whenever it holds a
// value. Through the real CardCreatorForm, per kind and per field:
//   * a new card: not on the page at all — no input, no label, no helper, no
//     fold, nothing to tab to;
//   * a stored card that holds a value: shown, with the value, editable, and
//     what a save sends holds the rest as stored;
//   * emptied in this sitting: still shown — through a tab change and a step
//     change too;
//   * a value that arrives (an import): shown from then on;
//   * a server error on a hidden field: shown, on its step and tab, with the
//     message;
//   * what Save still needs never names one.
// What "never drawn" means per frame is held to both renderers by
// tests/unit/render/second-part-never-drawn.test.tsx; what a save sends by
// creator-face-tabs-payload.test.tsx.
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
vi.mock("@/lib/frames/frame-request-actions", () => ({
  recordFrameRequestAction: vi.fn(async () => ({ ok: true })),
}));
// The import dialog needs Scryfall: a stand-in with one button that hands
// the form a payload through the same `onImport` the real one calls.
const importer = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: ({ onImport }: { onImport: (payload: unknown) => unknown }) => (
    <button type="button" onClick={() => onImport(importer.payload)}>
      test: import
    </button>
  ),
  toastImportNotice: () => {},
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/creator/art-uploader", () => ({
  ArtUploader: (props: { fieldAnchor?: string; artUrl?: string | null; heading?: string }) => (
    <button type="button" data-field-anchor={props.fieldAnchor} data-art-url={props.artUrl ?? ""}>
      {props.heading}
    </button>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: Record<string, unknown>) => (
    <div
      data-testid="card-preview"
      data-props={JSON.stringify(props, (_key, value) => (typeof value === "function" ? undefined : value))}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { useSecondPartFields } from "@/components/creator/use-second-part-fields";
import { secondPartArtNotDrawnNote } from "@/components/creator/panels/second-part-panels";
import { SECOND_PART_WORDS } from "@/lib/creator/second-part";
import {
  SECOND_PART_HIDEABLE,
  SECOND_PART_UNIT_KEYS,
  neverDrawnSecondPartUnits,
  secondPartShown,
  secondPartUnitOfField,
  type SecondPartHideable,
} from "@/lib/creator/second-part-fields";
import { PART_FIELD_STEP } from "@/lib/creator/face-tabs";
import { saveNeedsOf } from "@/lib/creator/save-needs";
import { getFrameProfile } from "@/lib/cards/template-layout";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = ["m15", "m15artifact", "m15land", "split", "aftermath", "adventure", "flip"].flatMap((template) =>
  EVERY_COLOUR.map((key) => frameComboKey(template, key)),
);

type Kind = "split" | "aftermath" | "adventure" | "flip";
const KINDS: { kind: Kind; chip: RegExp; cardType: string }[] = [
  { kind: "split", chip: /^Split/, cardType: "instant" },
  { kind: "aftermath", chip: /^Aftermath/, cardType: "sorcery" },
  { kind: "adventure", chip: /^Adventure/, cardType: "creature" },
  { kind: "flip", chip: /^Flip/, cardType: "creature" },
];
const wordsOf = (kind: Kind) => SECOND_PART_WORDS[kind]!;
const neverOf = (kind: Kind) => neverDrawnSecondPartUnits(getFrameProfile(kind));
/** The form field of each unit, the step it is on, and an odd stored value. */
const UNIT: Record<SecondPartHideable, { fields: string[]; step: RegExp; stored: Record<string, string> }> = {
  pt: { fields: ["back_face.power", "back_face.toughness"], step: /^text/i, stored: { power: "1", toughness: "2" } },
  loyalty: { fields: ["back_face.loyalty"], step: /^text/i, stored: { loyalty: "3" } },
  defense: { fields: ["back_face.defense"], step: /^text/i, stored: { defense: "4" } },
  flavor: { fields: ["back_face.flavor_text"], step: /^text/i, stored: { flavor_text: "Cold comfort." } },
  artist: { fields: ["back_face.artist_credit"], step: /^identity/i, stored: { artist_credit: "Bo Marsh" } },
  art: { fields: ["back_face.art_url"], step: /^identity/i, stored: { art_url: "https://example.com/back.png" } },
};
const ODD_BACK = Object.assign({}, ...SECOND_PART_HIDEABLE.map((unit) => UNIT[unit].stored)) as Record<string, string>;

type FormProps = Parameters<typeof CardCreatorForm>[0];
function renderForm(props: Partial<FormProps> = {}) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={VERIFIED}
      {...props}
    />,
  );
}

/** A stored card of `kind`; `back` is laid over a plain second part. */
function storedPart(kind: Kind, back: Record<string, unknown> = {}): Card {
  const creature = kind === "adventure" || kind === "flip";
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Fire",
    slug: "fire",
    game_system_id: GAME,
    cost: "{1}{R}",
    color_identity: ["red"],
    supertype: null,
    printed_types: null,
    card_type: KINDS.find((k) => k.kind === kind)!.cardType,
    subtypes: creature ? ["Giant"] : [],
    tags: [],
    rarity: "uncommon",
    rules_text: "Fire deals 2 damage to any target.",
    flavor_text: null,
    power: creature ? "4" : null,
    toughness: creature ? "3" : null,
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: kind },
    visibility: "private",
    back_face: {
      title: "Ice",
      card_type: "instant",
      cost: "{1}{U}",
      subtypes: [],
      rules_text: "Tap target permanent.",
      ...back,
    },
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-02T10:00:00.000Z",
  } as unknown as Card;
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
  importer.payload = null;
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
async function pickKind(label: RegExp) {
  const group = screen.getByRole("radiogroup", { name: "Card type" });
  await click(Array.from(group.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? ""))!);
}
const stepButtons = () =>
  Array.from(screen.getByRole("navigation", { name: /card editor steps/i }).querySelectorAll("button"));
const activeStep = () =>
  screen.getByRole("navigation", { name: /card editor steps/i }).querySelector("[aria-current='step']")?.textContent ?? "";
async function goTo(step: RegExp) {
  // The step that is open is not a button.
  if (step.test(activeStep().trim())) return;
  const button = stepButtons().find((b) => step.test(b.textContent ?? ""));
  if (!button) throw new Error(`no step ${step}: ${stepButtons().map((b) => JSON.stringify(b.textContent)).join(",")}`);
  await click(button);
}
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const selected = () => screen.getByTestId("face-switch").dataset.face;
const named = (name: string) =>
  document.querySelector<HTMLElement>(`[name='${name}'], [data-field-anchor='${name}']`);
const change = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(named(name)!, { target: { value } });
    fireEvent.blur(named(name)!);
  });
};
const panelText = () => screen.getByRole("tabpanel").textContent ?? "";
/** Every unit's fields that are on the page, over both steps of the second
 *  part's tab. */
async function fieldsOnSecondTab(kind: Kind): Promise<string[]> {
  const found: string[] = [];
  for (const step of [/^identity/i, /^text/i]) {
    await goTo(step);
    await click(tab(wordsOf(kind).second));
    for (const unit of SECOND_PART_HIDEABLE) for (const field of UNIT[unit].fields) if (named(field)) found.push(field);
  }
  return found.sort();
}
const fieldsOf = (units: Iterable<SecondPartHideable>) => [...units].flatMap((unit) => UNIT[unit].fields).sort();
async function importCard(patch: Record<string, unknown>) {
  importer.payload = { patch, importedArtUrl: null, source: { name: "Fire // Ice", scryfallUri: null } };
  await click(screen.getByRole("button", { name: "test: import" }));
}

describe("the rule, pure", () => {
  it("each never-drawn unit is hidden while empty, shown with a value, an error, or once kept", () => {
    for (const { kind } of KINDS) {
      const never = neverOf(kind);
      const empty = secondPartShown({ never, backFace: { title: "Ice", power: " ", loyalty: "" } });
      for (const unit of SECOND_PART_HIDEABLE) expect(empty[unit], `${kind} / ${unit} empty`).toBe(!never.has(unit));
      for (const unit of SECOND_PART_HIDEABLE) {
        const held = secondPartShown({ never, backFace: UNIT[unit].stored });
        const errored = secondPartShown({ never, backFace: {}, errors: { [SECOND_PART_UNIT_KEYS[unit][0]]: { message: "no" } } });
        const kept = secondPartShown({ never, backFace: {}, kept: new Set([unit]) });
        for (const other of SECOND_PART_HIDEABLE) {
          const expected = other === unit || !never.has(other);
          expect(held[other], `${kind}: ${other} with ${unit} held`).toBe(expected);
          expect(errored[other], `${kind}: ${other} with an error on ${unit}`).toBe(expected);
          expect(kept[other], `${kind}: ${other} with ${unit} kept`).toBe(expected);
        }
      }
    }
  });

  it("power and toughness are one unit: a half that holds either shows both", () => {
    const never = neverOf("split");
    expect(secondPartShown({ never, backFace: { toughness: "2" } }).pt).toBe(true);
    expect(secondPartShown({ never, backFace: { power: "*" } }).pt).toBe(true);
  });

  it("a form field's unit — the art position is the art box's", () => {
    expect(secondPartUnitOfField("back_face.art_position")).toBe("art");
    expect(secondPartUnitOfField("back_face.toughness")).toBe("pt");
    expect(secondPartUnitOfField("back_face.title")).toBeNull();
    expect(secondPartUnitOfField("loyalty")).toBeNull();
    // Every hideable field is one the tabs know a step for.
    for (const unit of SECOND_PART_HIDEABLE) for (const key of SECOND_PART_UNIT_KEYS[unit]) expect(PART_FIELD_STEP[key]).toBeTruthy();
  });

  it("what Save still needs never names a field the rule can hide", () => {
    for (const { kind } of KINDS) {
      for (const savesAsDraft of [true, false]) {
        const needs = saveNeedsOf({
          title: "",
          artUrl: "",
          hasBackFace: true,
          backFace: {},
          savesAsDraft,
          visibility: "public",
          doubleFaced: false,
          words: wordsOf(kind),
        });
        for (const need of needs) expect(secondPartUnitOfField(need.field), `${kind}: ${need.field}`).toBeNull();
      }
    }
  });
});

describe("the memory (useSecondPartFields)", () => {
  type Props = { template: Kind; backFace: Record<string, unknown>; scope: string; errors?: Record<string, unknown> };
  const mount = (initial: Props) =>
    renderHook(
      (props: Props) =>
        useSecondPartFields({ ...props, profile: getFrameProfile(props.template) }),
      { initialProps: initial },
    );

  it("a unit that held a value stays shown once emptied; another card, or Start over, forgets", () => {
    const hook = mount({ template: "split", backFace: { loyalty: "3" }, scope: "a" });
    expect(hook.result.current.shown.loyalty).toBe(true);
    expect(hook.result.current.shown.defense).toBe(false);
    hook.rerender({ template: "split", backFace: { loyalty: "" }, scope: "a" });
    expect(hook.result.current.shown.loyalty).toBe(true);
    // Start over.
    act(() => hook.result.current.forget());
    expect(hook.result.current.shown.loyalty).toBe(false);
    // Kept again, then another card.
    hook.rerender({ template: "split", backFace: { loyalty: "1" }, scope: "a" });
    hook.rerender({ template: "split", backFace: {}, scope: "a" });
    expect(hook.result.current.shown.loyalty).toBe(true);
    hook.rerender({ template: "split", backFace: {}, scope: "b" });
    expect(hook.result.current.shown.loyalty).toBe(false);
  });

  it("the memory is per frame: a flip side's power / toughness (drawn there) is not a split half's", () => {
    const hook = mount({ template: "flip", backFace: { power: "1", toughness: "2", defense: "4" }, scope: "a" });
    expect(hook.result.current.shown).toMatchObject({ pt: true, defense: true });
    hook.rerender({ template: "split", backFace: {}, scope: "a" });
    expect(hook.result.current.shown).toMatchObject({ pt: false, defense: false });
    // Back on the flip frame the emptied defense is still remembered.
    hook.rerender({ template: "flip", backFace: {}, scope: "a" });
    expect(hook.result.current.shown).toMatchObject({ pt: true, defense: true });
  });

  it("reveal shows a hidden unit by its field; an error shows it and it stays once the error is gone", () => {
    const hook = mount({ template: "aftermath", backFace: {}, scope: "a" });
    act(() => hook.result.current.reveal("back_face.flavor_text"));
    expect(hook.result.current.shown.flavor).toBe(true);
    act(() => hook.result.current.reveal("back_face.title"));
    hook.rerender({ template: "aftermath", backFace: {}, scope: "a", errors: { defense: { message: "Too long." } } });
    expect(hook.result.current.shown.defense).toBe(true);
    hook.rerender({ template: "aftermath", backFace: {}, scope: "a" });
    expect(hook.result.current.shown.defense).toBe(true);
    expect(hook.result.current.shown.loyalty).toBe(false);
  });

  it("nothing is hidden on a card whose frame paints no second part", () => {
    const hook = renderHook(() => useSecondPartFields({ profile: null, template: "m15", backFace: {}, scope: "a" }));
    expect(Object.values(hook.result.current.shown).every(Boolean)).toBe(true);
  });
});

describe.each(KINDS)("$kind in the creator", ({ kind, chip }) => {
  const words = wordsOf(kind);
  const never = neverOf(kind);
  const drawn = SECOND_PART_HIDEABLE.filter((unit) => !never.has(unit));

  it("a new card: what the card never draws is not on the page — no field, no label, no fold, no empty row", async () => {
    renderForm();
    await pickKind(chip);
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(drawn));
    await goTo(/^identity/i);
    expect(panelText()).not.toMatch(/Artist credit/i);
    expect(screen.queryByText("More options — artist credit")).toBeNull();
    expect(Boolean(screen.queryByTestId("second-part-artwork"))).toBe(!never.has("art"));
    expect(screen.queryByTestId("second-part-art-not-drawn")).toBeNull();
    await goTo(/^text/i);
    for (const label of ["Flavor text", "Loyalty", "Defense"]) expect(panelText()).not.toContain(label);
    expect(panelText().includes("Power")).toBe(!never.has("pt"));
    // …and no empty row is left where the stats were.
    expect(screen.getByRole("tabpanel").querySelectorAll("div.grid:empty")).toHaveLength(0);
    // Nothing hidden is left for the keyboard or a screen reader: every
    // control of the panel is one the page shows.
    const hidden = fieldsOf(never);
    for (const control of screen.getByRole("tabpanel").querySelectorAll<HTMLElement>("input, textarea, select, button, [tabindex]")) {
      expect(hidden).not.toContain(control.getAttribute("name") ?? "");
    }
    // The first part keeps all of its own.
    await click(tab(words.first));
    expect(named("flavor_text")).toBeTruthy();
    await goTo(/^identity/i);
    expect(named("art_url")).toBeTruthy();
    expect(named("artist_credit")).toBeTruthy();
  });

  it("a stored card that holds them: every one is shown with its value — and only those", async () => {
    renderForm({ mode: "edit", card: storedPart(kind, ODD_BACK) });
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(SECOND_PART_HIDEABLE));
    await goTo(/^text/i);
    for (const key of ["power", "toughness", "loyalty", "defense", "flavor_text"]) {
      expect((named(`back_face.${key}`) as HTMLInputElement).value, key).toBe(ODD_BACK[key]);
    }
    await goTo(/^identity/i);
    expect((named("back_face.artist_credit") as HTMLInputElement).value).toBe("Bo Marsh");
    expect(named("back_face.art_url")!.dataset.artUrl).toBe("https://example.com/back.png");
    // A picture the frame never draws says so where it is shown.
    expect(Boolean(screen.queryByTestId("second-part-art-not-drawn"))).toBe(never.has("art"));
    if (never.has("art")) expect(screen.getByTestId("second-part-art-not-drawn").textContent).toBe(secondPartArtNotDrawnNote(words));
  });

  it.each(SECOND_PART_HIDEABLE)("a stored card that holds only %s shows only that one beside what is drawn", async (unit) => {
    renderForm({ mode: "edit", card: storedPart(kind, UNIT[unit].stored) });
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(new Set([...drawn, unit])));
  });

  it("emptied in this sitting, a field stays — through a tab change and a step change — and the save sends the rest as stored", async () => {
    renderForm({ mode: "edit", card: storedPart(kind, ODD_BACK) });
    await goTo(/^text/i);
    await click(tab(words.second));
    for (const key of ["power", "toughness", "loyalty", "defense", "flavor_text"]) {
      await change(`back_face.${key}`, "");
      expect(named(`back_face.${key}`), `${key} just emptied`).toBeTruthy();
    }
    await goTo(/^identity/i);
    await change("back_face.artist_credit", "");
    expect(named("back_face.artist_credit")).toBeTruthy();
    await click(tab(words.first));
    await goTo(/^publish/i);
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(SECOND_PART_HIDEABLE));
    // "Clear" empties the whole part and takes no field away either.
    await goTo(/^identity/i);
    await click(screen.getByRole("button", { name: `Clear ${words.phrase}` }));
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(SECOND_PART_HIDEABLE));
    await goTo(/^identity/i);
    await change("back_face.title", "Ice");
    // Typed again, it is what is saved.
    await goTo(/^text/i);
    await change("back_face.loyalty", "6");
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const back = (actions.updateCardAction.mock.calls[0][1] as { back_face: Record<string, unknown> }).back_face;
    expect(back).toMatchObject({ title: "Ice", loyalty: "6" });
    for (const key of ["power", "toughness", "defense", "flavor_text", "artist_credit", "art_url"]) expect(back[key] ?? "", key).toBe("");
  });

  it("a value that arrives — an import — shows its field from then on", async () => {
    renderForm();
    await pickKind(chip);
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(drawn));
    await importCard({
      kind,
      card_type: KINDS.find((k) => k.kind === kind)!.cardType,
      title: "Fire",
      color_identity: ["red"],
      back_face: { title: "Ice", card_type: "instant", rules_text: "Tap target permanent.", loyalty: "3", flavor_text: "Cold comfort.", artist_credit: "Bo Marsh" },
    });
    expect(await fieldsOnSecondTab(kind)).toEqual(fieldsOf(new Set<SecondPartHideable>([...drawn, "loyalty", "flavor", "artist"])));
    await goTo(/^text/i);
    expect((named("back_face.loyalty") as HTMLInputElement).value).toBe("3");
    // …and emptied by hand it is still there.
    await change("back_face.loyalty", "");
    await change("back_face.flavor_text", "");
    expect(named("back_face.loyalty")).toBeTruthy();
    expect(named("back_face.flavor_text")).toBeTruthy();
  });

  it("a server error on a hidden field shows the field, on its step and its tab, with the message", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.defense": "That defense is too long." },
    });
    renderForm();
    await pickKind(chip);
    await goTo(/^identity/i);
    await change("title", "First Name");
    await goTo(/^text/i);
    await click(tab(words.second));
    expect(named("back_face.defense")).toBeNull();
    await click(tab(words.first));
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(activeStep()).toMatch(/Text/));
    expect(selected()).toBe("back");
    expect(named("back_face.defense")).toBeTruthy();
    expect(screen.getByText("That defense is too long.")).toBeTruthy();
    // Fixing it does not take the field away.
    await change("back_face.defense", "");
    expect(named("back_face.defense")).toBeTruthy();
    // The other never-drawn fields stayed hidden.
    expect(named("back_face.loyalty")).toBeNull();
    expect(named("back_face.flavor_text")).toBeNull();
  });

  it("the still-needed links name only fields that are on the page", async () => {
    renderForm();
    await pickKind(chip);
    const links = Array.from(screen.getByTestId("save-needs").querySelectorAll<HTMLButtonElement>("button[data-need]"));
    expect(links.map((link) => link.dataset.need).sort()).toEqual(["art", "second-name", "title"]);
    for (const link of links) {
      await click(link);
      expect(document.activeElement, link.dataset.need).not.toBe(document.body);
      expect(secondPartUnitOfField(document.activeElement?.getAttribute("name") ?? document.activeElement?.getAttribute("data-field-anchor") ?? "")).toBeNull();
    }
  });
});

// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Face tabs, part 1 (TODO 5.14, owner round 46) — Transform and Modal
// double-faced cards, through the real CardCreatorForm and the switch on
// its own:
//   * ONE Front face | Back face switch (a tab list from SECOND_PART_WORDS),
//     each tab with the face's name and what it still needs; arrow keys;
//     a battle's Back face tab greyed out with "Battle backs are coming";
//   * every back field on the step of its front twin, writing the form path
//     it always wrote;
//   * the preview: the edited face large, the other small — a click on it
//     selects its tab; it never changes face by itself;
//   * the per-face "still needed" links and a server error select the TAB
//     as well as the step;
//   * a one-faced card, and the kinds of part 2, have no switch.
// What a save sends is held by creator-face-tabs-payload.test.tsx.
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
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: Record<string, unknown>) => (
    <div
      data-testid="card-preview"
      data-props={JSON.stringify(props, (_key, value) => (typeof value === "function" ? undefined : value))}
    />
  ),
}));


import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { FaceSwitch } from "@/components/creator/face-switch";
import { SECOND_PART_WORDS } from "@/lib/creator/second-part";
import {
  BACK_FIELD_STEP,
  errorPaths,
  faceFieldStepIndex,
  faceOfField,
  faceStatusOf,
  firstErrorPath,
  groupNeedsByFace,
} from "@/lib/creator/face-tabs";
import { visibleSteps } from "@/lib/creator/steps";
import { saveNeedsOf } from "@/lib/creator/save-needs";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  "m15", "m15artifact", "m15land", "m15pw", "m15token", "saga", "battle", "split", "aftermath", "adventure", "flip",
  "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
  "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
].flatMap((template) => EVERY_COLOUR.map((key) => frameComboKey(template, key)));

function renderForm() {
  return render(
    <CardCreatorForm
      mode="create"
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

type PreviewProps = {
  face?: string;
  flipOnClick?: boolean;
  hideFlipControl?: boolean;
  title?: string;
  backFace?: Record<string, unknown> | null;
};
const propsOf = (el: Element) => JSON.parse((el as HTMLElement).dataset.props ?? "{}") as PreviewProps;
/** The desktop column's two pictures (the phone block holds the same two). */
const largePreview = () => propsOf(within(screen.getAllByTestId("face-preview-large").at(-1)!).getByTestId("card-preview"));
const smallPreview = () => propsOf(within(screen.getAllByTestId("face-preview-other").at(-1)!).getByTestId("card-preview"));
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
function kindChip(label: RegExp) {
  const group = screen.getByRole("radiogroup", { name: "Card type" });
  const chip = Array.from(group.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? ""));
  if (!chip) throw new Error(`no kind chip ${label}`);
  return chip as HTMLButtonElement;
}
const pickKind = (label: RegExp) => click(kindChip(label));
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (button) await click(button);
}
const activeStep = () =>
  screen.getByRole("navigation", { name: /card editor steps/i }).querySelector("[aria-current='step']")
    ?.textContent ?? "";
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const selected = () => screen.getByTestId("face-switch").dataset.face;
const named = (name: string) => document.querySelector<HTMLElement>(`[name='${name}'], [data-field='${name}'], [data-field-anchor='${name}']`);

describe("the switch on its own (components/creator/face-switch.tsx)", () => {
  const parts = {
    front: { name: "Dusk Ferryman", status: faceStatusOf({ title: "Dusk Ferryman", art_url: "https://example.com/a.png" }) },
    back: { name: "", status: faceStatusOf({ title: "", art_url: "" }) },
  };
  it("is a tab list named from the kind's words, each tab with its face's name and what it still needs", () => {
    render(<FaceSwitch words={SECOND_PART_WORDS.transform!} value="back" onChange={() => {}} panelId="panel" {...parts} />);
    const list = screen.getByRole("tablist");
    expect(list.getAttribute("aria-label")).toBe("Which part of the card you are editing");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Front faceDusk Ferryman· complete", "Back faceneeds a name and artwork"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    // One tab stop: the selected tab.
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0]);
    expect(tabs.every((t) => t.getAttribute("aria-controls") === "panel")).toBe(true);
    // The status is words; the dot beside it is decoration.
    expect(tabs[0].querySelector("[data-face-status='complete'] [aria-hidden]")).toBeTruthy();
    expect(tabs[1].querySelector("[data-face-status='needs']")).toBeTruthy();
  });

  it.each(["transform", "mdfc", "split", "aftermath", "adventure", "flip"] as const)(
    "%s: the two labels are the table's (part 2 only has to mount it)",
    (kind) => {
      const words = SECOND_PART_WORDS[kind]!;
      render(<FaceSwitch words={words} value="front" onChange={() => {}} panelId="panel" {...parts} />);
      expect(tab(new RegExp(`^${words.first}`))).toBeTruthy();
      expect(tab(new RegExp(`^${words.second}`))).toBeTruthy();
    },
  );

  it("arrow keys, Home and End move between the tabs and select; the focus stays on a tab", async () => {
    const onChange = vi.fn();
    const view = render(<FaceSwitch words={SECOND_PART_WORDS.mdfc!} value="front" onChange={onChange} panelId="panel" {...parts} />);
    tab(/^Front face/).focus();
    fireEvent.keyDown(tab(/^Front face/), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("back");
    expect(document.activeElement).toBe(tab(/^Back face/));
    view.rerender(<FaceSwitch words={SECOND_PART_WORDS.mdfc!} value="back" onChange={onChange} panelId="panel" {...parts} />);
    fireEvent.keyDown(tab(/^Back face/), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("front");
    expect(document.activeElement).toBe(tab(/^Front face/));
    view.rerender(<FaceSwitch words={SECOND_PART_WORDS.mdfc!} value="front" onChange={onChange} panelId="panel" {...parts} />);
    fireEvent.keyDown(tab(/^Front face/), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("back");
    fireEvent.keyDown(tab(/^Back face/), { key: "Home" });
    expect(document.activeElement).toBe(tab(/^Front face/));
    // A key that is not the switch's is left alone.
    onChange.mockClear();
    fireEvent.keyDown(tab(/^Front face/), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a battle: the Back face tab is greyed out, says “Battle backs are coming”, and cannot be selected", () => {
    const onChange = vi.fn();
    render(
      <>
        <FaceSwitch words={SECOND_PART_WORDS.battle!} value="back" onChange={onChange} panelId="panel" noteId="note" front={{ name: "Siege", status: null }} back={{ name: "", status: null }} />
        <p id="note">Battle backs are coming.</p>
      </>,
    );
    const back = tab(/^Back face/);
    expect(tab(/^Battle/).getAttribute("aria-selected")).toBe("true");
    expect(back.getAttribute("aria-selected")).toBe("false");
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(back.getAttribute("aria-describedby")).toBe("note");
    expect(back.textContent).toBe("Back faceBattle backs are coming");
    fireEvent.click(back);
    fireEvent.keyDown(tab(/^Battle/), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    // The key still takes the focus there, so the line is heard.
    expect(document.activeElement).toBe(back);
  });
});

describe("the pure part (lib/creator/face-tabs.ts)", () => {
  const create = visibleSteps({ template: "m15dfcfront", cardType: "creature", hasBackFace: true, kind: "transform", revise: false });
  const edit = visibleSteps({ template: "m15dfcfront", cardType: "creature", hasBackFace: true, kind: "transform", revise: true });
  const keyAt = (steps: typeof create, field: string, tabs = true) => steps[faceFieldStepIndex(field, steps, tabs)]?.key;

  it("a back field is on the step of its front twin; without the switch it is where it always was", () => {
    expect(keyAt(create, "back_face.card_type")).toBe("card");
    expect(keyAt(create, "back_face.color_identity")).toBe("card");
    expect(keyAt(create, "back_face.frame_style")).toBe("card");
    for (const field of ["title", "supertype", "printed_types", "subtypes_text", "art_url", "art_position", "artist_credit"]) {
      expect(keyAt(create, `back_face.${field}`), field).toBe("identity");
      expect(keyAt(create, field === "printed_types" ? "supertype" : field), field).toBe("identity");
    }
    for (const field of ["cost", "rules_text", "flavor_text", "power", "toughness"]) {
      expect(keyAt(create, `back_face.${field}`), field).toBe("text");
      expect(keyAt(create, field), field).toBe("text");
    }
    // An edit has no Card step: the back's locked type and colour are on Identity.
    expect(keyAt(edit, "back_face.color_identity")).toBe("identity");
    expect(keyAt(edit, "back_face.frame_style")).toBe("identity");
    // No switch (a split half, a legacy back): the Identity step, as before.
    expect(keyAt(create, "back_face.rules_text", false)).toBe("identity");
    expect(keyAt(create, "back_face", true)).toBe("identity");
    // Every back field of the form has a step.
    expect(Object.keys(BACK_FIELD_STEP).sort()).toEqual(
      ["art_position", "art_url", "artist_credit", "card_type", "color_identity", "cost", "defense", "flavor_text", "frame_style", "loyalty", "power", "printed_types", "rules_text", "subtypes_text", "supertype", "title", "toughness"],
    );
  });

  it("faceOfField, firstErrorPath and errorPaths read a nested back error as its own field", () => {
    expect(faceOfField("back_face.title")).toBe("back");
    expect(faceOfField("title")).toBe("front");
    expect(faceOfField("frame_style")).toBe("front");
    expect(firstErrorPath({ back_face: { rules_text: { message: "too long" } } })).toBe("back_face.rules_text");
    expect(firstErrorPath({ title: { message: "required" }, back_face: { title: { message: "x" } } })).toBe("title");
    expect(firstErrorPath({ back_face: { message: "whole" } })).toBe("back_face");
    expect(firstErrorPath({})).toBeNull();
    expect(errorPaths({ title: { message: "a" }, back_face: { cost: { message: "b" }, title: { message: "c" } } })).toEqual([
      "title",
      "back_face.cost",
      "back_face.title",
    ]);
  });

  it("a face's status is words: what it still lacks to be shown to other people", () => {
    expect(faceStatusOf({ title: "A", art_url: "u" })).toEqual({ complete: true, text: "complete" });
    expect(faceStatusOf({ title: "A", art_url: "" }).text).toBe("needs artwork");
    expect(faceStatusOf({ title: " ", art_url: "u" }).text).toBe("needs a name");
    expect(faceStatusOf({}).text).toBe("needs a name and artwork");
  });

  it("the grouped list is the Save rule's own list, in face order — never a second rule", () => {
    const words = SECOND_PART_WORDS.transform!;
    const needs = saveNeedsOf({ title: "", artUrl: "", hasBackFace: true, backFace: {}, savesAsDraft: false, visibility: "public", doubleFaced: true, words });
    const groups = groupNeedsByFace(needs, words);
    expect(groups.map((g) => [g.face, g.label, g.needs.map((n) => n.id)])).toEqual([
      ["front", "Front face", ["title", "art"]],
      ["back", "Back face", ["second-art", "second-name"]],
    ]);
    expect(groups.flatMap((g) => g.needs)).toHaveLength(needs.length);
    expect(groupNeedsByFace(needs.filter((n) => n.field.startsWith("back_face.")), words).map((g) => g.face)).toEqual(["back"]);
  });
});

describe("a Transform or Modal card in the creator", () => {
  it.each([[/^Transform/], [/^Modal double-faced/]] as const)("%s: one switch above the step, on every step; the step is the selected tab's panel", async (kind) => {
    renderForm();
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await pickKind(kind);
    for (const step of [/^card/i, /^identity/i, /^text/i, /^set/i, /^subscriber/i, /^publish/i]) {
      await goTo(step);
      expect(screen.getAllByRole("tablist"), String(step)).toHaveLength(1);
      const panel = screen.getByRole("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab(/^Front face/).id);
      expect(tab(/^Front face/).getAttribute("aria-controls")).toBe(panel.id);
      expect(screen.getByTestId("face-switch-note").textContent, String(step)).toMatch(/shared by both faces/);
    }
    // A shared step says so; the switch still works there.
    expect(screen.getByTestId("face-switch-note").textContent).toBe(
      "Everything on this step is shared by both faces. The switch still chooses which face the preview shows.",
    );
    await click(tab(/^Back face/));
    expect(selected()).toBe("back");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab(/^Back face/).id);
  });

  it("each tab says what its face still needs, and follows the form", async () => {
    renderForm();
    await pickKind(/^Transform/);
    expect(tab(/^Front face/).textContent).toBe("Front faceneeds a name and artwork");
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.change(named("title")!, { target: { value: "Dusk Ferryman" } });
    });
    expect(tab(/^Front face/).textContent).toBe("Front faceneeds artwork");
    await click(tab(/^Back face/));
    await act(async () => {
      fireEvent.change(named("back_face.title")!, { target: { value: "Ferryman of the Drowned" } });
    });
    expect(tab(/^Back face/).textContent).toBe("Back faceneeds artwork");
  });

  // back field → the step it is on, with the front twin that is on that
  // step while the Front face tab is selected.
  const RELOCATED: Array<[string, RegExp, string | null]> = [
    ["back_face.title", /^identity/i, "title"],
    ["back_face.subtypes_text", /^identity/i, "subtypes_text"],
    ["back_face.art_url", /^identity/i, "art_url"],
    ["back_face.artist_credit", /^identity/i, "artist_credit"],
    ["back_face.cost", /^text/i, null],
    ["back_face.rules_text", /^text/i, "rules_text"],
    ["back_face.flavor_text", /^text/i, "flavor_text"],
    ["back_face.power", /^text/i, "power"],
    ["back_face.toughness", /^text/i, "toughness"],
  ];
  it("every back field is on the step of its front twin — on the Back face tab only, and nowhere else", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    const steps = [/^card/i, /^identity/i, /^text/i, /^set/i, /^subscriber/i, /^publish/i];
    // The cost picker has no form control: found by its field group.
    const present = (field: string) =>
      field === "back_face.cost"
        ? /Back face — Cost/.test(screen.getByRole("tabpanel").textContent ?? "")
        : Boolean(named(field));
    for (const step of steps) {
      await goTo(step);
      await click(tab(/^Front face/));
      for (const [field, home, twin] of RELOCATED) {
        expect(present(field), `${field} on ${step} / front`).toBe(false);
        if (String(step) === String(home) && twin) expect(named(twin), `${twin} on ${step} / front`).toBeTruthy();
      }
      await click(tab(/^Back face/));
      for (const [field, home, twin] of RELOCATED) {
        expect(present(field), `${field} on ${step} / back`).toBe(String(step) === String(home));
        if (twin) expect(named(twin), `${twin} on ${step} / back`).toBeNull();
      }
    }
    // The back's type and colour are on the Card step, where the front's are.
    await goTo(/^card/i);
    expect(screen.getByRole("radiogroup", { name: "Back face type" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Back face color" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Front face type" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Color identity" })).toBeNull();
    // …and what is the card's stays on both tabs.
    expect(screen.getByRole("radiogroup", { name: "Card type" })).toBeTruthy();
    await click(tab(/^Front face/));
    expect(screen.getByRole("radiogroup", { name: "Front face type" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Color identity" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Back face type" })).toBeNull();
  });

  it("the same order on both tabs: Identity = name, Types, Subtypes, artwork, artist; Text = cost, rarity, rules, alignment, flavour, stats", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    const order = (names: string[]) =>
      names
        .map((n) => [n, document.querySelector(`[name='${n}'], [data-field='${n}'], [data-field-anchor='${n}'], [data-testid='${n}'], [aria-label='${n}']`)] as const)
        .filter(([, el]) => el)
        .sort(([, a], [, b]) => (a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map(([n]) => n);
    await goTo(/^identity/i);
    expect(order(["title", "types-field-input-front", "subtypes_text", "art_url", "artist_credit"])).toEqual(
      ["title", "types-field-input-front", "subtypes_text", "art_url", "artist_credit"],
    );
    await click(tab(/^Back face/));
    expect(order(["back_face.title", "types-field-input-back", "back_face.subtypes_text", "back_face.art_url", "back_face.artist_credit"])).toEqual(
      ["back_face.title", "types-field-input-back", "back_face.subtypes_text", "back_face.art_url", "back_face.artist_credit"],
    );
    await goTo(/^text/i);
    expect(order(["Remove last mana symbol", "Rarity", "back_face.rules_text", "Text alignment", "back_face.flavor_text", "back_face.power"]).filter((n) => n !== "Remove last mana symbol")).toEqual(
      ["Rarity", "back_face.rules_text", "Text alignment", "back_face.flavor_text", "back_face.power"],
    );
    await click(tab(/^Front face/));
    expect(order(["Rarity", "rules_text", "Text alignment", "flavor_text", "power"])).toEqual(
      ["Rarity", "rules_text", "Text alignment", "flavor_text", "power"],
    );
  });

  it("a moved field writes the form path it always wrote", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await click(tab(/^Back face/));
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.change(named("back_face.title")!, { target: { value: "Insectile Aberration" } });
      fireEvent.change(named("back_face.subtypes_text")!, { target: { value: "Human, Insect" } });
      fireEvent.change(named("back_face.artist_credit")!, { target: { value: "Bo Marsh" } });
    });
    await goTo(/^text/i);
    await act(async () => {
      fireEvent.change(named("back_face.flavor_text")!, { target: { value: "It hums." } });
      fireEvent.change(named("back_face.power")!, { target: { value: "3" } });
      fireEvent.change(named("back_face.toughness")!, { target: { value: "2" } });
    });
    expect(largePreview().backFace).toMatchObject({
      title: "Insectile Aberration",
      subtypes: ["Human", "Insect"],
      artist_credit: "Bo Marsh",
      flavor_text: "It hums.",
      power: "3",
      toughness: "2",
    });
    // A transform back has no cost: the Text step says so where it would be.
    expect(screen.getByTestId("back-no-cost-note")).toBeTruthy();
  });

  it("a field is heard with its face: “Back face — Title”, “Front face — Title”; what is shared is not", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    expect(screen.getByLabelText(/^Front face — Title/)).toBe(named("title"));
    expect(screen.getByText("Front face — Artwork")).toBeTruthy();
    await click(tab(/^Back face/));
    expect(screen.getByLabelText(/^Back face — Title/)).toBe(named("back_face.title"));
    expect(screen.getByLabelText(/^Back face — Subtypes/)).toBe(named("back_face.subtypes_text"));
    expect(screen.getByText("Back face — Artwork")).toBeTruthy();
    await goTo(/^text/i);
    expect(screen.getByLabelText("Back face rules text")).toBeTruthy();
    expect(screen.getByLabelText(/^Back face — Power/)).toBe(named("back_face.power"));
    // A field of several controls is a named group (#518): its name carries
    // the face too.
    expect(screen.getByRole("group", { name: "Back face — Rules text" })).toBeTruthy();
    // Rarity is the card's: its group is "Rarity" on both tabs.
    const rarityGroup = () => screen.getByRole("radiogroup", { name: "Rarity" }).closest("[role='group']")!;
    expect(rarityGroup().textContent).not.toMatch(/face —/);
    expect(screen.getByRole("group", { name: "Rarity" })).toBe(rarityGroup());
    await click(tab(/^Front face/));
    expect(screen.getByLabelText("Front face rules text")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Front face — Rules text" })).toBeTruthy();
    expect(rarityGroup().textContent).not.toMatch(/face —/);
    expect(screen.getByRole("group", { name: "Rarity" })).toBe(rarityGroup());
  });

  it("switching moves no focus by itself: a click leaves it on the tab", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    tab(/^Back face/).focus();
    await click(tab(/^Back face/));
    expect(document.activeElement).toBe(tab(/^Back face/));
  });
});

describe("the preview", () => {
  it("shows the face being edited large and says which; the other one small; neither has a turn control of its own", async () => {
    renderForm();
    await pickKind(/^Transform/);
    expect(largePreview()).toMatchObject({ face: "front", flipOnClick: false, hideFlipControl: true });
    expect(smallPreview()).toMatchObject({ face: "back", flipOnClick: false, hideFlipControl: true });
    for (const el of screen.getAllByTestId("face-preview-showing")) expect(el.textContent).toBe("Showing: Front face");
    await click(tab(/^Back face/));
    expect(largePreview().face).toBe("back");
    expect(smallPreview().face).toBe("front");
    for (const el of screen.getAllByTestId("face-preview-showing")) expect(el.textContent).toBe("Showing: Back face");
    // The old "click the card to turn it" hint has no card to sit on.
    expect(screen.getAllByTestId("card-preview").every((el) => propsOf(el).flipOnClick === false)).toBe(true);
  });

  it("the small face is a named button: a click selects its tab", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    const other = () => screen.getAllByRole("button", { name: "Back face — edit this face" });
    expect(other().length).toBeGreaterThan(0);
    await click(other().at(-1)!);
    expect(selected()).toBe("back");
    expect(tab(/^Back face/).getAttribute("aria-selected")).toBe("true");
    expect(largePreview().face).toBe("back");
    await click(screen.getAllByRole("button", { name: "Front face — edit this face" }).at(-1)!);
    expect(selected()).toBe("front");
  });

  it("never changes face by itself: not on a step change, not on a focus in a field, not on typing", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await click(tab(/^Back face/));
    for (const step of [/^identity/i, /^text/i, /^set/i, /^subscriber/i, /^publish/i, /^card/i]) {
      await goTo(step);
      expect(largePreview().face, String(step)).toBe("back");
      expect(selected(), String(step)).toBe("back");
    }
    await click(tab(/^Front face/));
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.focus(named("title")!);
      fireEvent.change(named("title")!, { target: { value: "Delver" } });
    });
    await goTo(/^text/i);
    expect(largePreview().face).toBe("front");
    // Next / Back keep the tab too.
    await click(tab(/^Back face/));
    await click(screen.getByRole("button", { name: /^Next/ }));
    await click(screen.getByRole("button", { name: /Back$/ }));
    expect(largePreview().face).toBe("back");
  });

  it("a card that gains or loses the switch starts on its front", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await click(tab(/^Back face/));
    await pickKind(/^Modal double-faced/);
    // Still a two-faced card: the tab stays.
    expect(selected()).toBe("back");
    await pickKind(/^Creature/);
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await pickKind(/^Transform/);
    expect(selected()).toBe("front");
    expect(largePreview().face).toBe("front");
  });
});

describe("what a save still needs, per face", () => {
  const need = (id: string) =>
    screen.getByTestId("save-needs").querySelector<HTMLButtonElement>(`button[data-need='${id}']`)!;

  it("the line groups the Save rule's items by face; each link selects the tab and the step and focuses the field", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    const line = screen.getByTestId("save-needs");
    expect(line.textContent).toBe(
      "Still needed to save: Front face — a title and artwork · Back face — artwork and a name.",
    );
    expect(Array.from(line.querySelectorAll("[data-face-group]")).map((el) => (el as HTMLElement).dataset.faceGroup)).toEqual(["front", "back"]);

    await goTo(/^publish/i);
    await click(need("second-name"));
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("back");
    expect(document.activeElement).toBe(named("back_face.title"));

    await goTo(/^text/i);
    await click(need("title"));
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("front");
    expect(document.activeElement).toBe(named("title"));

    await goTo(/^set/i);
    await click(need("second-art"));
    expect(selected()).toBe("back");
    expect(document.activeElement).toBe(named("back_face.art_url"));
    expect(need("second-art").getAttribute("aria-label")).toBe(
      "Back face: artwork — go to this field on the Back face tab of the Identity step",
    );
  });

  it("a server error on a back field opens ITS step on the Back face tab, and lights that step", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.rules_text": "The back's rules are too long." },
    });
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.change(named("title")!, { target: { value: "Delver of Secrets" } });
    });
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(activeStep()).toMatch(/Text/));
    expect(selected()).toBe("back");
    expect(screen.getByText("The back's rules are too long.")).toBeTruthy();
  });

  it("the server's refusal of the back's body or colour is said on the Back face tab of the Card step", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.frame_style": "This back frame isn't verified in green yet." },
    });
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.change(named("title")!, { target: { value: "Delver of Secrets" } });
    });
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(activeStep()).toMatch(/Card/));
    expect(selected()).toBe("back");
    expect(screen.getByTestId("dfc-back-error").textContent).toBe("This back frame isn't verified in green yet.");
    // On the Front face tab it is not shown (it is not the front's).
    await click(tab(/^Front face/));
    expect(screen.queryByTestId("dfc-back-error")).toBeNull();
  });

  // The server's schema errors name the top-level key only ("back_face",
  // lib/auth/schemas.ts fieldErrorsFromZod): no field stands under it. Before
  // (and on origin/main) the step opened and the message was said nowhere.
  it("a refusal keyed on the whole back face is said at the top of the Back face tab", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { back_face: "Rules text must be 4000 characters or fewer." },
    });
    renderForm();
    await pickKind(/^Modal double-faced/);
    await goTo(/^identity/i);
    await act(async () => {
      fireEvent.change(named("title")!, { target: { value: "Valakut Awakening" } });
    });
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(selected()).toBe("back"));
    expect(activeStep()).toMatch(/Identity/);
    expect(screen.getByTestId("dfc-back-error").textContent).toBe("Rules text must be 4000 characters or fewer.");
    await click(tab(/^Front face/));
    expect(screen.queryByTestId("dfc-back-error")).toBeNull();
  });
});

describe("what is the card's on the Back face tab", () => {
  // ONE legendary crown serves both faces (TODO 5.1d): its row shows when
  // EITHER face prints one. A legendary back under a plain front used to
  // have its switch beside the back's own type line (the old Back face
  // panel sat on the same step); with the tabs it must not be on the
  // Front face tab alone.
  it("a legendary back under a plain front: the crown's switch is on the Back face tab, where “Legendary” is typed — and it is the one switch", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    expect(screen.queryByRole("switch", { name: /crown/i })).toBeNull();
    await click(tab(/^Back face/));
    expect(screen.queryByRole("switch", { name: /crown/i })).toBeNull();
    const types = document.querySelector<HTMLInputElement>("#types-field-back")!;
    await act(async () => {
      fireEvent.change(types, { target: { value: "Legendary Creature" } });
    });
    const onBack = screen.getByRole("switch", { name: /crown/i });
    expect(onBack.getAttribute("aria-checked")).toBe("true");
    // Between the type line and the artwork, as on the Front face tab.
    const typeLine = screen.getByTestId("back-type-line-fields");
    const artwork = screen.getByTestId("back-face-artwork");
    expect(typeLine.compareDocumentPosition(onBack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onBack.compareDocumentPosition(artwork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(onBack);
    expect(screen.getByRole("switch", { name: /crown/i }).getAttribute("aria-checked")).toBe("false");
    // The same state on the Front face tab.
    await click(tab(/^Front face/));
    expect(screen.getByRole("switch", { name: /crown/i }).getAttribute("aria-checked")).toBe("false");
  });

  // An import is another card. On origin/main it opened on the front (a
  // step change turned the preview there); with the tabs kept through a
  // step change, an import made from the Back face tab landed on the back.
  it("an import made from the Back face tab opens on the Front face tab", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await click(tab(/^Back face/));
    expect(selected()).toBe("back");
    importer.payload = {
      patch: { title: "Delver of Secrets" },
      importedArtUrl: null,
      source: { name: "Delver of Secrets // Insectile Aberration", scryfallUri: null },
    };
    await click(screen.getByRole("button", { name: "test: import" }));
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("front");
    expect(named("title")?.getAttribute("name")).toBe("title");
  });

  it("the small face stays in reach where the preview is one sticky column: it stands in the label's row below xl, beside the card from xl up", async () => {
    renderForm();
    await pickKind(/^Transform/);
    // The desktop column's (the last in the DOM; the phone block is inline).
    const other = screen.getAllByTestId("face-preview-other").at(-1)!;
    const slot = other.parentElement!;
    expect(slot.className).toMatch(/(^| )absolute( |$)/);
    expect(slot.className).toMatch(/(^| )top-0( |$)/);
    expect(slot.className).toMatch(/(^| )xl:static( |$)/);
    // …and the column is its positioning box.
    expect(slot.closest("[data-testid='face-preview']")!.className).toMatch(/(^| )relative( |$)/);
  });
});

describe("cards without the switch, and the battle's greyed tab", () => {
  it.each([[/^Creature/], [/^Land/], [/^Planeswalker/], [/^Saga/], [/^Token/], [/^Instant/]] as const)(
    "%s: no switch, no two-face preview, the old sentence above Save, on every step",
    async (kind) => {
      renderForm();
      await pickKind(kind);
      for (const step of [/^card/i, /^identity/i, /^text/i, /^set/i, /^subscriber/i, /^publish/i]) {
        await goTo(step);
        expect(screen.queryByTestId("face-switch")).toBeNull();
        expect(screen.queryByRole("tablist")).toBeNull();
        expect(screen.queryByRole("tabpanel")).toBeNull();
        expect(screen.queryByTestId("face-preview")).toBeNull();
        expect(screen.queryByTestId("face-switch-note")).toBeNull();
      }
      // (A land names itself: only the artwork is missing there.)
      expect(screen.getByTestId("save-needs").textContent).toMatch(/^Add (a title and )?artwork to enable Save\.$/);
      expect(screen.getByTestId("save-needs").hasAttribute("data-by-face")).toBe(false);
      // The preview keeps its own props: nothing of the switch reaches it.
      expect(screen.getAllByTestId("card-preview").every((el) => propsOf(el).hideFlipControl === undefined)).toBe(true);
      await goTo(/^identity/i);
      expect(screen.getByLabelText(/^Title/).closest("label")!.textContent).not.toMatch(/face —/);
    },
  );

  it.each([[/^Split/, "right half"], [/^Aftermath/, "aftermath half"], [/^Adventure/, "adventure spell"], [/^Flip/, "flipped side"]] as const)(
    "%s (part 2): no switch yet — the second part is still under “More options”",
    async (kind, phrase) => {
      renderForm();
      await pickKind(kind);
      expect(screen.queryByTestId("face-switch")).toBeNull();
      await goTo(/^identity/i);
      expect(screen.getByText(`More options — artist credit & ${phrase}`)).toBeTruthy();
      expect(named("back_face.title")!.closest("details")).toBeTruthy();
    },
  );

  it("a battle: the switch with its Back face tab greyed out and one line; nothing else changes", async () => {
    renderForm();
    await pickKind(/^Battle/);
    for (const step of [/^card/i, /^identity/i, /^text/i, /^publish/i]) {
      await goTo(step);
      const back = tab(/^Back face/);
      expect(back.getAttribute("aria-disabled")).toBe("true");
      expect(tab(/^Battle/).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("face-switch-note").textContent).toBe("Battle backs are coming.");
      await click(back);
      expect(selected()).toBe("front");
    }
    // The preview is the single one, as before; the Save line is the sentence.
    expect(screen.queryByTestId("face-preview")).toBeNull();
    expect(screen.getByTestId("save-needs").hasAttribute("data-by-face")).toBe(false);
    await goTo(/^identity/i);
    expect(named("title")!.closest("label")!.textContent).not.toMatch(/face —/);
    expect(named("back_face.title")).toBeNull();
  });
});

// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 5.14, the three quick fixes of 2026-10-12, through the real
// CardCreatorForm:
//   1. a change of card type that would throw the card's second part away
//      (a back face, a split / aftermath / flip half, an adventure's spell)
//      asks first — only when that part holds something; Cancel changes
//      nothing; the part comes back when the kind is picked again;
//   2. each "still needed" item above Save is a link to its field — the
//      step opens, a closed "More options" fold opens, the field is focused;
//   3. every kind's second part is called by its own name, with its own
//      example text.
// The server actions, the router and the heavy dialogs are stubbed; the
// live preview reports the props it was handed.
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
vi.mock("@/lib/cards/actions", () => ({ createCardAction: vi.fn(), updateCardAction: vi.fn() }));
vi.mock("@/lib/cards/dfc-adopt-actions", () => ({ adoptDfcBodiesAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({
  recordFrameRequestAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
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
import { MODAL_LAND_BACK_COST_HINT } from "@/components/creator/panels/dfc-face-panel";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  "m15",
  "m15artifact",
  "m15land",
  "m15pw",
  "m15token",
  "saga",
  "battle",
  "split",
  "aftermath",
  "adventure",
  "flip",
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
  "m15mdfcfront",
  "m15mdfcback",
  "m15mdfclandfront",
  "m15mdfclandback",
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
  for (const fn of [...Object.values(toast), ...Object.values(router)]) fn.mockReset();
});

type PreviewProps = {
  title?: string;
  frameStyle?: { template?: string };
  backFace?: Record<string, unknown> | null;
};
const preview = () =>
  JSON.parse(screen.getAllByTestId("card-preview")[0].dataset.props ?? "{}") as PreviewProps;
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
/** The step the rail shows as current. */
const activeStep = () =>
  screen.getByRole("navigation", { name: /card editor steps/i }).querySelector("[aria-current='step']")
    ?.textContent ?? "";
const field = <T extends HTMLElement = HTMLInputElement>(name: string) =>
  document.querySelector<T>(`[name='${name}']`);
async function type(name: string, value: string) {
  const el = field(name);
  if (!el) throw new Error(`no field ${name}`);
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
}
/** Pick a two-part kind and name its second part. */
async function cardWithSecondPart(kind: RegExp, name = "Second Name") {
  await pickKind(kind);
  await goTo(/^identity/i);
  await type("back_face.title", name);
  await goTo(/^card/i);
}
const lossDialog = () => screen.queryByTestId("second-part-loss-dialog");
const need = (id: string) =>
  screen.getByTestId("save-needs").querySelector<HTMLButtonElement>(`button[data-need='${id}']`);

describe("1 · a change of card type that would throw the second part away asks first", () => {
  it("Transform → Creature with a named back: the dialog names what goes, Cancel has the focus and changes nothing", async () => {
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    // The chip is pressed with the focus on it, as a keyboard or a click
    // leaves it.
    kindChip(/^Creature/).focus();
    await pickKind(/^Creature/);

    const dialog = lossDialog();
    expect(dialog).toBeTruthy();
    expect(within(dialog!).getByText("Remove the back face?")).toBeTruthy();
    expect(dialog!.textContent).toContain(
      "Changing this card to Creature removes the back face (“Insectile Aberration”) — its name.",
    );
    expect(dialog!.textContent).toMatch(/switch back to Transform before you leave this page/);
    // Cancel is the default action.
    const cancel = within(dialog!).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    // Nothing has changed while the question is open…
    expect(preview().frameStyle?.template).toBe("m15dfcfront");
    await click(cancel);
    // …nor after Cancel.
    expect(lossDialog()).toBeNull();
    expect(preview().frameStyle?.template).toBe("m15dfcfront");
    expect(preview().backFace?.title).toBe("Insectile Aberration");
    expect(kindChip(/^Transform/).getAttribute("aria-checked")).toBe("true");
    // The focus is handed back to the chip that opened the question.
    await waitFor(() => expect(document.activeElement).toBe(kindChip(/^Creature/)));
  });

  it("confirming removes the back; picking Transform again restores it, and says so", async () => {
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    await goTo(/^identity/i);
    await type("back_face.subtypes_text", "Human, Insect");
    await goTo(/^card/i);
    await pickKind(/^Creature/);
    expect(lossDialog()!.textContent).toContain("its name and type line.");
    await click(within(lossDialog()!).getByRole("button", { name: "Remove the back face" }));

    expect(lossDialog()).toBeNull();
    expect(preview().frameStyle?.template).toBe("m15");
    expect(preview().backFace ?? null).toBeNull();

    await pickKind(/^Transform/);
    expect(preview().frameStyle?.template).toBe("m15dfcfront");
    expect(preview().backFace).toMatchObject({ title: "Insectile Aberration", subtypes: ["Human", "Insect"] });
    expect(toast.info).toHaveBeenCalledWith("Back face restored — “Insectile Aberration”.");
  });

  it("nothing is asked when the second part is empty", async () => {
    renderForm();
    for (const kind of [/^Transform/, /^Modal double-faced/, /^Adventure/, /^Split/, /^Aftermath/, /^Flip/]) {
      await pickKind(kind);
      await pickKind(/^Creature/);
      expect(lossDialog(), String(kind)).toBeNull();
      expect(preview().frameStyle?.template, String(kind)).toBe("m15");
    }
  });

  it.each([
    [/^Modal double-faced/, "the back face"],
    [/^Adventure/, "the adventure spell"],
    [/^Split/, "the right half"],
    [/^Aftermath/, "the aftermath half"],
    [/^Flip/, "the flipped side"],
  ] as const)("%s: the question uses the kind's own word", async (kind, phrase) => {
    renderForm();
    await cardWithSecondPart(kind, "Second Name");
    await pickKind(/^Instant/);
    expect(within(lossDialog()!).getByText(`Remove ${phrase}?`)).toBeTruthy();
    expect(lossDialog()!.textContent).toContain(`removes ${phrase} (“Second Name”)`);
    expect(within(lossDialog()!).getByRole("button", { name: `Remove ${phrase}` })).toBeTruthy();
  });

  it("moving between two kinds that both have a second part keeps it and asks nothing", async () => {
    renderForm();
    await cardWithSecondPart(/^Split/, "Ice");
    await pickKind(/^Aftermath/);
    expect(lossDialog()).toBeNull();
    expect(preview().backFace).toMatchObject({ title: "Ice" });
    await pickKind(/^Transform/);
    expect(lossDialog()).toBeNull();
    expect(preview().backFace).toMatchObject({ title: "Ice" });
  });

  it("a removed part returns only to the kind it came from, and Start over forgets it", async () => {
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    await pickKind(/^Creature/);
    await click(within(lossDialog()!).getByRole("button", { name: "Remove the back face" }));
    // Another two-part kind starts from its own blank half.
    await pickKind(/^Split/);
    expect(preview().backFace).toMatchObject({ title: "", card_type: "instant" });
    // Back on Transform it is still offered (the split half was untouched).
    await pickKind(/^Transform/);
    expect(preview().backFace).toMatchObject({ title: "Insectile Aberration" });

    // Remove it again, start over: gone for good.
    await pickKind(/^Creature/);
    await click(within(lossDialog()!).getByRole("button", { name: "Remove the back face" }));
    await click(screen.getByRole("button", { name: /Start over/ }));
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: /Start over/ }));
    await pickKind(/^Transform/);
    expect(preview().backFace).toMatchObject({ title: "" });
  });
});

describe("2 · each “still needed” item is a link to its field", () => {
  it("the line is the Save gate's own list: the same sentence, the same items, Save disabled while any is left", async () => {
    renderForm();
    await pickKind(/^Transform/);
    const line = screen.getByTestId("save-needs");
    expect(line.textContent).toBe(
      "Add a title, artwork, the back face's artwork and the back face's name to enable Save.",
    );
    const save = screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The button's hover text is the sentence the line reads as.
    expect(save.title).toBe(line.textContent);
    const list = within(line).getByRole("list", { name: "Still needed before saving" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    // Each link is named by its words and says where it goes.
    expect(need("title")!.getAttribute("aria-label")).toBe("a title — go to this field on the Identity step");
    expect(need("second-art")!.getAttribute("aria-label")).toBe(
      "the back face's artwork — go to this field on the Identity step",
    );

    // A draft needs a title only: the list follows the rule.
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    expect(screen.getByTestId("save-needs").textContent).toBe("Add a title to enable Save.");
    await goTo(/^identity/i);
    await type("title", "Delver of Secrets");
    expect(screen.queryByTestId("save-needs")).toBeNull();
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a link opens the field's step and puts the focus in the field (title, front art, back art, back name)", async () => {
    renderForm();
    await pickKind(/^Transform/);
    expect(activeStep()).toMatch(/Card/);

    await click(need("title")!);
    expect(activeStep()).toMatch(/Identity/);
    expect(document.activeElement).toBe(field("title"));

    await goTo(/^text/i);
    await click(need("art")!);
    expect(activeStep()).toMatch(/Identity/);
    expect(document.activeElement).toBe(document.querySelector("[data-field-anchor='art_url']"));
    expect(document.activeElement?.textContent).toMatch(/Choose file/);

    await goTo(/^publish/i);
    await click(need("second-art")!);
    const backArt = document.querySelector("[data-field-anchor='back_face.art_url']");
    expect(backArt?.closest("[data-testid='dfc-face-panel']")).toBeTruthy();
    expect(document.activeElement).toBe(backArt);

    await goTo(/^card/i);
    await click(need("second-name")!);
    expect(document.activeElement).toBe(field("back_face.title"));
  });

  it("a field inside a closed “More options” fold: the fold opens, then the field is focused", async () => {
    renderForm();
    await pickKind(/^Split/);
    await goTo(/^identity/i);
    const nameInput = field("back_face.title")!;
    const fold = nameInput.closest("details") as HTMLDetailsElement;
    // The maker folded it away and moved on.
    fold.open = false;
    await goTo(/^text/i);
    await click(need("second-name")!);
    expect(activeStep()).toMatch(/Identity/);
    const again = field("back_face.title")!;
    expect((again.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement).toBe(again);
    expect(need("second-name")!.textContent).toBe("the right half's name");
  });

  it("works from the keyboard: the links are buttons in the tab order", async () => {
    renderForm();
    const link = need("title")!;
    expect(link.tagName).toBe("BUTTON");
    expect(link.type).toBe("button");
    expect(link.tabIndex).toBe(0);
  });
});

describe("3 · every kind's second part has its own words", () => {
  it.each([
    [/^Split/, "Right half", "right half", "Ice"],
    [/^Aftermath/, "Aftermath half", "aftermath half", "Ribbons"],
    [/^Flip/, "Flipped side", "flipped side", "Tok-Tok, Volcano Born"],
    [/^Adventure/, "Adventure spell", "adventure spell", "Stomp"],
  ] as const)("%s: label, fold, example name, accessible names and Clear", async (kind, label, phrase, example) => {
    renderForm();
    await pickKind(kind);
    await goTo(/^identity/i);
    expect(screen.getByText(`More options — artist credit & ${phrase}`)).toBeTruthy();
    expect(screen.getByText(`${label} name`)).toBeTruthy();
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe(example);
    // No kind borrows the transform back's example or its accessible name.
    expect(screen.queryByPlaceholderText("Insectile Aberration")).toBeNull();
    expect(screen.queryByLabelText("Back face rules text")).toBeNull();
    expect(screen.getByLabelText(`${label} rules text`)).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: `${label} card type` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Clear the ${phrase}` })).toBeTruthy();
    expect(screen.getByTestId("save-needs").textContent).toContain(`the ${phrase}'s name`);
  });

  it("a new Adventure's spell starts as an Instant, never the creature it rides on", async () => {
    renderForm();
    await pickKind(/^Adventure/);
    expect(preview().backFace).toMatchObject({ card_type: "instant" });
    await goTo(/^identity/i);
    const types = screen.getByRole("radiogroup", { name: "Adventure spell card type" });
    expect(types.querySelector("[aria-checked='true']")?.textContent).toMatch(/^Instant/);
    // Clear keeps the spell's own type.
    await type("back_face.title", "Stomp");
    await click(screen.getByRole("button", { name: "Clear the adventure spell" }));
    expect(preview().backFace).toMatchObject({ title: "", card_type: "instant" });
  });

  it("a transform back keeps “Back face” and its own example; a modal back has a modal card's", async () => {
    renderForm();
    await pickKind(/^Transform/);
    await goTo(/^identity/i);
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe("Insectile Aberration");
    expect(screen.getByLabelText("Back face rules text")).toBeTruthy();
    await goTo(/^card/i);
    await pickKind(/^Modal double-faced/);
    await goTo(/^identity/i);
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe("Emeria, Shattered Skyclave");
  });

  it("a modal LAND back's Cost field says a land has no cost; a spell back's says nothing", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    await goTo(/^identity/i);
    expect(screen.queryByText(MODAL_LAND_BACK_COST_HINT)).toBeNull();
    const backTypes = screen.getByRole("radiogroup", { name: "Back face type" });
    await click(
      Array.from(backTypes.querySelectorAll("[role='radio']")).find((el) => /^Land/.test(el.textContent ?? ""))!,
    );
    expect(screen.getByText(MODAL_LAND_BACK_COST_HINT)).toBeTruthy();
  });

  it("the phone bar over the preview says what it does — it folds the preview, it never turns the card", async () => {
    renderForm();
    expect(screen.queryByText(/tap to toggle/i)).toBeNull();
    const summary = screen.getByText("Hide the preview").closest("summary")!;
    expect(summary.textContent).toContain("Live preview");
    expect(within(summary).getByText("Show the preview")).toBeTruthy();
  });
});

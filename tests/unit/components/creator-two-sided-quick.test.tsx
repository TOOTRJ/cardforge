// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
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
import { MODAL_LAND_BACK_COST_HINT } from "@/components/creator/panels/back-face-panels";
import { revealAndFocusField } from "@/lib/creator/focus-field";

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
/** A phone-width window: no `min-width` query matches (happy-dom's own
 *  window is 1024 px wide — the creator's desktop layout). */
function phoneWidth() {
  const real = window.matchMedia.bind(window);
  vi.stubGlobal("matchMedia", (query: string) =>
    /min-width/.test(query) ? { ...real(query), matches: false, media: query } : real(query),
  );
}

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
/** Select a tab of the Front face | Back face switch (Face tabs, TODO 5.14). */
async function faceTab(name: RegExp) {
  await click(screen.getByRole("tab", { name }));
}
async function type(name: string, value: string) {
  // On a card with Face tabs a field is on its own face's tab.
  // (The tabs carry the kind's own words — "Left half | Right half" — so
  // they are taken by their place: the first part's, the second part's.)
  if (!field(name) && screen.queryByTestId("face-switch")) {
    await click(screen.getAllByRole("tab")[name.startsWith("back_face.") ? 1 : 0]);
  }
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
    // A card with Face tabs (TODO 5.14) groups the same items per face.
    expect(line.textContent).toBe(
      "Still needed to save: Front face — a title and artwork · Back face — artwork and a name.",
    );
    const save = screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The button's hover text is the Save rule's own sentence, as before.
    expect(save.title).toBe(
      "Add a title, artwork, the back face's artwork and the back face's name to enable Save.",
    );
    const list = within(line).getByRole("list", { name: "Still needed before saving" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(line.querySelectorAll("button[data-need]")).toHaveLength(4);
    // Each link is named by its face and its words and says where it goes.
    expect(need("title")!.getAttribute("aria-label")).toBe(
      "Front face: a title — go to this field on the Front face tab of the Identity step",
    );
    expect(need("second-art")!.getAttribute("aria-label")).toBe(
      "Back face: artwork — go to this field on the Back face tab of the Identity step",
    );

    // A draft needs a title only: the list follows the rule.
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    expect(screen.getByTestId("save-needs").textContent).toBe("Still needed to save: Front face — a title.");
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
    // The link selected the Back face TAB as well as the step.
    expect(activeStep()).toMatch(/Identity/);
    expect(screen.getByRole("tab", { name: /^Back face/ }).getAttribute("aria-selected")).toBe("true");
    const backArt = document.querySelector("[data-field-anchor='back_face.art_url']");
    expect(backArt).toBeTruthy();
    expect(document.activeElement).toBe(backArt);

    await goTo(/^card/i);
    await click(need("second-name")!);
    expect(document.activeElement).toBe(field("back_face.title"));
    // …and a front item selects the Front face tab again.
    await goTo(/^publish/i);
    await click(need("art")!);
    expect(screen.getByRole("tab", { name: /^Front face/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector("[data-field-anchor='art_url']"));
  });

  it("a split half's name: the link selects the Right half tab, opens Identity and focuses the field — no fold in the way", async () => {
    // Until Face tabs part 2 the half lived inside the Identity step's
    // "More options" fold, which the link had to open first.
    renderForm();
    await pickKind(/^Split/);
    await goTo(/^text/i);
    expect(field("back_face.title")).toBeNull();
    expect(need("second-name")!.textContent).toBe("a name");
    await click(need("second-name")!);
    expect(activeStep()).toMatch(/Identity/);
    expect(screen.getByRole("tab", { name: /^Right half/ }).getAttribute("aria-selected")).toBe("true");
    const nameInput = field("back_face.title")!;
    expect(nameInput.closest("details")).toBeNull();
    expect(document.activeElement).toBe(nameInput);
  });

  it("a field inside a closed fold: the fold opens, then the field is focused", () => {
    // (The rule itself — lib/creator/focus-field.ts — on a plain page.)
    const host = document.createElement("div");
    host.innerHTML = `<details><summary>More options</summary><input name="artist_credit" /></details>`;
    document.body.append(host);
    const fold = host.querySelector("details")!;
    expect(fold.open).toBe(false);
    expect(revealAndFocusField(host, "artist_credit")).toBe(true);
    expect(fold.open).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("input"));
    host.remove();
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
  ] as const)("%s: tab, label, example name, accessible names and Clear", async (kind, label, phrase, example) => {
    renderForm();
    await pickKind(kind);
    await goTo(/^identity/i);
    // Face tabs, part 2: the second part has a tab of its own, in the
    // kind's words — no fold holds it any more.
    expect(screen.queryByText(`More options — artist credit & ${phrase}`)).toBeNull();
    await click(screen.getByRole("tab", { name: new RegExp(`^${label}`) }));
    expect(field("back_face.title")!.closest("label")!.textContent).toContain(`${label} — Title`);
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe(example);
    // No kind borrows the transform back's example or its accessible name.
    expect(screen.queryByPlaceholderText("Insectile Aberration")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: `${label} card type` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Clear the ${phrase}` })).toBeTruthy();
    await goTo(/^text/i);
    expect(screen.queryByLabelText("Back face rules text")).toBeNull();
    expect(screen.getByLabelText(`${label} rules text`)).toBeTruthy();
    // The Save rule's own sentence still names the part in full.
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).title).toContain(
      `the ${phrase}'s name`,
    );
    expect(screen.getByTestId("save-needs").textContent).toContain(`${label} — a name`);
  });

  it("a new Adventure's spell starts as an Instant, never the creature it rides on", async () => {
    renderForm();
    await pickKind(/^Adventure/);
    expect(preview().backFace).toMatchObject({ card_type: "instant" });
    await goTo(/^identity/i);
    await faceTab(/^Adventure spell/);
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
    await faceTab(/^Back face/);
    await goTo(/^identity/i);
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe("Insectile Aberration");
    await goTo(/^text/i);
    expect(screen.getByLabelText("Back face rules text")).toBeTruthy();
    await goTo(/^card/i);
    await pickKind(/^Modal double-faced/);
    await goTo(/^identity/i);
    expect(field("back_face.title")!.getAttribute("placeholder")).toBe("Emeria, Shattered Skyclave");
  });

  it("a modal LAND back's Cost field says a land has no cost; a spell back's says nothing", async () => {
    renderForm();
    await pickKind(/^Modal double-faced/);
    await faceTab(/^Back face/);
    await goTo(/^text/i);
    expect(screen.queryByText(MODAL_LAND_BACK_COST_HINT)).toBeNull();
    await goTo(/^card/i);
    const backTypes = screen.getByRole("radiogroup", { name: "Back face type" });
    await click(
      Array.from(backTypes.querySelectorAll("[role='radio']")).find((el) => /^Land/.test(el.textContent ?? ""))!,
    );
    await goTo(/^text/i);
    expect(screen.getByText(MODAL_LAND_BACK_COST_HINT)).toBeTruthy();
  });

  it("the phone bar over the preview says what it does — it folds the preview, it never turns the card", async () => {
    // (A phone: since TODO 3b.9 only the preview that shows is mounted.)
    phoneWidth();
    renderForm();
    expect(screen.queryByText(/tap to toggle/i)).toBeNull();
    const summary = screen.getByText("Hide the preview").closest("summary")!;
    expect(summary.textContent).toContain("Live preview");
    expect(within(summary).getByText("Show the preview")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TODO 3b.9 — ONE live preview: the phone's inline one or the desktop aside,
// never both with one hidden by CSS (each drew the whole card on every
// keystroke).
// ---------------------------------------------------------------------------
describe("3b.9 one live preview is mounted", () => {
  it("on a desktop: the aside's, and no phone bar", () => {
    renderForm();
    expect(screen.getAllByTestId("card-preview")).toHaveLength(1);
    expect(screen.queryByText("Hide the preview")).toBeNull();
    expect(screen.getByTestId("card-preview").closest("aside")).not.toBeNull();
  });

  it("on a phone: the inline one, under its bar", () => {
    phoneWidth();
    renderForm();
    expect(screen.getAllByTestId("card-preview")).toHaveLength(1);
    expect(screen.getByTestId("card-preview").closest("details")).not.toBeNull();
    expect(document.querySelector("aside")).toBeNull();
  });

  it("a two-faced card's face preview too", async () => {
    phoneWidth();
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.getAllByTestId("card-preview").every((el) => el.closest("details"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skeptic pass, 2026-10-12.
// ---------------------------------------------------------------------------
describe("skeptic: the promise the question makes, and the links' dead ends", () => {
  const removeButton = () =>
    Array.from(lossDialog()!.querySelectorAll("button")).find((b) => /^Remove /.test(b.textContent ?? ""))!;

  it("each kind keeps its OWN removed part: a half removed from a Split card on the way does not cost the Transform back its place", async () => {
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    await pickKind(/^Creature/);
    await click(removeButton());
    // On the way: a split card, its half named, removed too.
    await pickKind(/^Split/);
    await goTo(/^identity/i);
    await type("back_face.title", "Ice");
    await goTo(/^card/i);
    await pickKind(/^Creature/);
    expect(lossDialog()!.textContent).toContain("removes the right half (“Ice”)");
    await click(removeButton());
    // "If you switch back to Transform before you leave this page, it comes
    // back as it was" — still true.
    await pickKind(/^Transform/);
    expect(preview().backFace).toMatchObject({ title: "Insectile Aberration", card_type: "creature" });
    // …and so is the split half's.
    await pickKind(/^Creature/);
    await click(removeButton());
    await pickKind(/^Split/);
    expect(preview().backFace).toMatchObject({ title: "Ice", card_type: "instant" });
    expect(toast.info.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["Back face restored — “Insectile Aberration”.", "Right half restored — “Ice”."]),
    );
  });

  it("after a CONFIRM the focus is handed on, never dropped on the page's body", async () => {
    // (In a browser the Card type section has folded shut around the chip by
    // then, and the dialog falls back to the section's bar — measured in the
    // real page; happy-dom lets a chip inside a closed <details> take it.)
    renderForm();
    await cardWithSecondPart(/^Transform/, "Insectile Aberration");
    kindChip(/^Creature/).focus();
    await pickKind(/^Creature/);
    await click(removeButton());
    await waitFor(() => expect(lossDialog()).toBeNull());
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active).not.toBe(document.body);
      expect(["radio", null]).toContain(active?.getAttribute("role") ?? null);
      expect(active?.closest("details")).toBe(screen.getByRole("radiogroup", { name: "Card type" }).closest("details"));
    });
  });

  it("a back face kept on a one-part frame has no name field: its item is plain words, not a link to nowhere", async () => {
    // The shape of an imported double-faced card from before the real
    // frames (a legacy back: content only, drawn on the front's frame) —
    // here with its name missing and the card visible to others.
    const legacy = {
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: USER,
      title: "Moorland Chaplain",
      slug: "moorland-chaplain",
      game_system_id: GAME,
      cost: "{1}{W}",
      color_identity: ["white"],
      supertype: null,
      card_type: "creature",
      subtypes: [],
      tags: [],
      rarity: "common",
      rules_text: null,
      flavor_text: null,
      power: "2",
      toughness: "2",
      loyalty: null,
      defense: null,
      artist_credit: null,
      art_url: null,
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: { finish: "regular", template: "m15" },
      visibility: "unlisted",
      back_face: { title: "", card_type: "creature", subtypes: [] },
      back_card_id: null,
      source_scryfall_id: null,
      set_icon_url: null,
      set_icon_code: null,
      face_content: null,
      watermark: null,
      footer_text: null,
      updated_at: "2026-10-02T10:00:00.000Z",
    } as unknown as Card;
    render(
      <CardCreatorForm
        mode="edit"
        userId={USER}
        ownerUsername="tester"
        gameSystems={GAME_SYSTEMS}
        aiConfigured={false}
        verifiedFrameKeys={VERIFIED}
        card={legacy}
      />,
    );
    const line = screen.getByTestId("save-needs");
    expect(line.textContent).toBe("Add artwork and the back face's name to enable Save.");
    // The front's art has a field: a link. The legacy back's name has none.
    expect(need("art")).toBeTruthy();
    expect(need("second-name")).toBeNull();
    const plain = line.querySelector("[data-need='second-name']")!;
    expect(plain.tagName).toBe("SPAN");
    expect(plain.textContent).toBe("the back face's name");
    // The gate itself is unchanged: Save stays disabled, with the sentence.
    const save = document.querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe(line.textContent);
    expect(document.querySelector("[name='back_face.title']")).toBeNull();
  });

  it("the half's “art from a real card” button is named by the kind's own word", async () => {
    renderForm();
    await pickKind(/^Aftermath/);
    await goTo(/^identity/i);
    await faceTab(/^Aftermath half/);
    expect(screen.getByRole("button", { name: "Use art from a real card for the aftermath half" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /for the second face/i })).toBeNull();
  });
});

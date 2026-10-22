// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 5.5 (c) — a double-sided token in the creator (owner Round 76): a NEW
// token's Card step has a "Faces" row — One face (the default, every token
// until now) | Two faces. With two faces the Front face | Back face switch
// appears, the back is a token of its own (its types, colour, name, text,
// stats and art on the steps of their front twins), and its frame is never
// a pick: the token template its words and text derive in the front's
// design — what the live preview draws and the save sends. One face saves
// one-faced exactly as before.
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

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = ["m15", "m15token", "m15tokentext", "m15tokenartifact", "m15tokenartifacttext", "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"].flatMap(
  (template) => EVERY_COLOUR.map((key) => frameComboKey(template, key)),
);

function renderForm(verified: string[] = VERIFIED) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={verified}
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

const propsOf = (el: Element) => JSON.parse((el as HTMLElement).dataset.props ?? "{}") as Record<string, unknown>;
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
function chipIn(group: string, label: RegExp) {
  const root = screen.getByRole("radiogroup", { name: group });
  const chip = Array.from(root.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? ""));
  if (!chip) throw new Error(`no chip ${label} in ${group}`);
  return chip as HTMLElement;
}
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (button) await click(button);
}
/** A chip of a multi-select row (a named group of toggle buttons). */
function toggleIn(group: string, label: RegExp) {
  const root = screen.getByRole("group", { name: group });
  const chip = Array.from(root.querySelectorAll("button")).find((el) => label.test(el.textContent ?? ""));
  if (!chip) throw new Error(`no chip ${label} in ${group}`);
  return chip as HTMLElement;
}
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const named = (name: string) => document.querySelector<HTMLElement>(`[name='${name}'], [data-field='${name}'], [data-field-anchor='${name}']`);
const change = async (name: string, value: string) => {
  const el = named(name)!;
  await act(async () => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      fireEvent.change(el, { target: { value } });
    } else {
      // The rules editor (a contenteditable PipTextEditor).
      el.textContent = value;
      fireEvent.input(el);
    }
    fireEvent.blur(el);
  });
};
const backTemplates = () =>
  screen
    .getAllByTestId("card-preview")
    .map((el) => (propsOf(el).backFace as { frame_style?: { template?: string } } | null)?.frame_style?.template ?? null);

async function saveDraft() {
  await goTo(/^publish/i);
  await click(screen.getByTestId("save-as-draft"));
  await click(screen.getByRole("button", { name: /^Save$/ }));
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as {
    card_type: string;
    frame_style: { template: string };
    back_face?: { title?: string; card_type?: string; supertype?: string; rules_text?: string; cost?: string; color_identity?: string[]; frame_style?: { template?: string } } | null;
  };
}

describe("a token's faces (TODO 5.5 (c))", () => {
  it("a new token starts with ONE face and no switch; it saves one-faced, as before", async () => {
    actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
    renderForm();
    await click(chipIn("Card type", /^Token/));
    await goTo(/^card/i);
    expect(chipIn("Token faces", /^One face/).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await goTo(/^identity/i);
    await change("title", "Goblin");
    const payload = await saveDraft();
    expect(payload.card_type).toBe("token");
    expect(payload.back_face ?? null).toBeNull();
  });

  it("“Two faces”: a Back face tab, the back's own token types and colour on the Card step — and the save sends the back on the token frame its words and text pick", async () => {
    actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
    renderForm();
    await click(chipIn("Card type", /^Token/));
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^Two faces/));
    expect(chipIn("Token faces", /^Two faces/).getAttribute("aria-checked")).toBe("true");
    expect(tab(/^Front face/).getAttribute("aria-selected")).toBe("true");
    await click(tab(/^Back face/));
    // The back's types stand where the front's are; no Emblem choice there.
    expect(screen.getByRole("group", { name: "Back face Token types" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Token types" })).toBeNull();
    expect(screen.getByTestId("dfc-back-color")).toBeTruthy();
    // A new token starts on the full-art design (verified here): the back
    // is a full-art token too. Artifact on the back: its artifact dress.
    expect(backTemplates()).toContain("m20token");
    await click(toggleIn("Back face Token types", /^Creature/));
    await click(toggleIn("Back face Token types", /^Artifact/));
    expect(backTemplates()).toContain("m20tokenartifact");
    await goTo(/^identity/i);
    await change("back_face.title", "Treasure");
    await goTo(/^text/i);
    // A token prints no cost: no Cost field on the back.
    expect(screen.queryByTestId("back-no-cost-note")).toBeNull();
    await change("back_face.rules_text", "{T}, Sacrifice this artifact: Add one mana of any color.");
    // Text on the back: the height its text asks for, the front's own frame untouched.
    expect(backTemplates()).toContain("m20tokenartifacttext");
    await click(tab(/^Front face/));
    await goTo(/^identity/i);
    await change("title", "Dinosaur");
    const payload = await saveDraft();
    expect(payload.frame_style.template).toBe("m20token");
    expect(payload.back_face).toMatchObject({
      title: "Treasure",
      card_type: "token",
      supertype: "Artifact",
      frame_style: { template: "m20tokenartifacttext" },
    });
    expect(payload.back_face?.cost).toBeUndefined();
  });

  it("back to “One face”: no switch, and the token saves one-faced — the back kept for the visit", async () => {
    actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
    renderForm();
    await click(chipIn("Card type", /^Token/));
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^Two faces/));
    await goTo(/^identity/i);
    await click(tab(/^Back face/));
    await change("back_face.title", "Soldier");
    await click(tab(/^Front face/));
    await change("title", "Goblin");
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^One face/));
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await click(chipIn("Token faces", /^Two faces/));
    await goTo(/^identity/i);
    await click(tab(/^Back face/));
    expect((named("back_face.title") as HTMLInputElement).value).toBe("Soldier");
    await click(tab(/^Front face/));
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^One face/));
    const payload = await saveDraft();
    expect(payload.back_face ?? null).toBeNull();
  });

  it("leaving the token kind takes the back with it", async () => {
    actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
    renderForm();
    await click(chipIn("Card type", /^Token/));
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^Two faces/));
    await click(chipIn("Card type", /^Creature/));
    // The back holds a Creature token: asked first, as any second part.
    await click(screen.getByRole("button", { name: /^Remove the back face/ }));
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await goTo(/^identity/i);
    await change("title", "Goblin Raider");
    const payload = await saveDraft();
    expect(payload.card_type).toBe("creature");
    expect(payload.back_face ?? null).toBeNull();
  });

  it("an Enchantment back where the Nyx dress isn't verified stays on the plain design — every colour open, the save goes out on it", async () => {
    actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
    renderForm(); // (no m20tokennyx tick here — as on production today)
    await click(chipIn("Card type", /^Token/));
    await goTo(/^card/i);
    await click(chipIn("Token faces", /^Two faces/));
    await click(tab(/^Back face/));
    await click(toggleIn("Back face Token types", /^Enchantment/));
    expect(backTemplates()).toContain("m20token");
    expect(screen.getByTestId("dfc-back-color").textContent).not.toMatch(/Soon/);
    await goTo(/^identity/i);
    await change("back_face.title", "Spirit");
    await click(tab(/^Front face/));
    await change("title", "Goblin");
    const payload = await saveDraft();
    expect(payload.back_face).toMatchObject({ supertype: "Enchantment Creature", frame_style: { template: "m20token" } });
  });

  // A kind whose frame has a second part of its own (Transform, Modal,
  // Adventure) never takes the token's back as its back face or half: asked
  // first, it starts its own — and the token's comes back with the kind.
  const WITH_LAYOUTS = [
    ...VERIFIED,
    ...["m15dfcfront", "m15dfcback", "m15mdfcfront", "m15mdfcback", "adventure"].flatMap((template) =>
      EVERY_COLOUR.map((key) => frameComboKey(template, key)),
    ),
  ];
  for (const [kindLabel, template, backType] of [
    ["Transform", "m15dfcfront", "creature"],
    ["Modal double-faced", "m15mdfcfront", "creature"],
    ["Adventure", "adventure", "instant"],
  ] as const) {
    it(`a token's back never becomes the ${kindLabel} card's second part — and returns with the token kind`, async () => {
      actions.createCardAction.mockResolvedValue({ ok: false, fieldErrors: { title: "stop here" } });
      renderForm(WITH_LAYOUTS);
      await click(chipIn("Card type", /^Token/));
      await goTo(/^card/i);
      await click(chipIn("Token faces", /^Two faces/));
      await goTo(/^identity/i);
      await click(tab(/^Back face/));
      await change("back_face.title", "Soldier");
      await click(tab(/^Front face/));
      await change("title", "Goblin");
      await goTo(/^card/i);
      await click(chipIn("Card type", new RegExp(`^${kindLabel}`)));
      await click(screen.getByRole("button", { name: /^Remove the back face/ }));
      await click(chipIn("Card type", /^Token/));
      expect(toast.info).toHaveBeenCalledWith("Back face restored.");
      await goTo(/^identity/i);
      await click(tab(/^Back face/));
      expect((named("back_face.title") as HTMLInputElement).value).toBe("Soldier");
      await click(tab(/^Front face/));
      await goTo(/^card/i);
      await click(chipIn("Card type", new RegExp(`^${kindLabel}`)));
      await click(screen.getByRole("button", { name: /^Remove the back face/ }));
      const payload = await saveDraft();
      expect(payload.frame_style.template).toBe(template);
      expect(payload.back_face).toMatchObject({ title: "", card_type: backType });
    });
  }
});

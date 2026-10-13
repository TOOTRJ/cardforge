// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Face tabs, part 2 (TODO 5.14, owner rounds 46 and 50) — the four two-PART
// kinds that are ONE picture: Split, Aftermath, Adventure, Flip. Through the
// real CardCreatorForm:
//   * the same switch as a double-faced card's, in the kind's own words
//     ("Left half | Right half"), on every step; usable on shared steps;
//   * the second part's fields out of the "More options" fold: each on the
//     step of its first-part twin, on the second tab only, writing the form
//     path it always wrote — and EVERY field the old panel showed is still
//     offered (which to hide is the owner's decision per field);
//   * a part's status ("needs a name"): an adventure's spell and a flip
//     card's other side have no artwork of their own and are not asked for
//     any; their tab shows a glyph instead of an art window;
//   * ONE preview: no two-face preview; the part being edited is outlined
//     and named — an overlay beside the card, never inside it, and nothing
//     of it is handed to the renderer;
//   * the per-part "still needed" links and a server error select the tab.
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
import { PartOutline } from "@/components/creator/part-outline";
import { secondPartArtNotDrawnNote } from "@/components/creator/panels/second-part-panels";
import { SECOND_PART_WORDS } from "@/lib/creator/second-part";
import { BACK_FIELD_STEP, PART_FIELD_STEP, faceFieldStepIndex, faceStatusOf } from "@/lib/creator/face-tabs";
import { partOutlineRects, secondPartHasOwnArt } from "@/lib/creator/part-outline";
import { visibleSteps } from "@/lib/creator/steps";
import { getFrameProfile } from "@/lib/cards/template-layout";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  "m15", "m15artifact", "m15land", "battle", "split", "aftermath", "adventure", "flip",
  "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
  "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
].flatMap((template) => EVERY_COLOUR.map((key) => frameComboKey(template, key)));

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

function storedSplit(over: Record<string, unknown> = {}): Card {
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
    card_type: "instant",
    subtypes: [],
    tags: [],
    rarity: "uncommon",
    rules_text: "Fire deals 2 damage divided as you choose among one or two targets.",
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "split" },
    visibility: "private",
    back_face: { title: "Ice", card_type: "instant", cost: "{1}{U}", subtypes: [], rules_text: "Tap target permanent." },
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-02T10:00:00.000Z",
    ...over,
  } as unknown as Card;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

type PreviewProps = { face?: string; hideFlipControl?: boolean; backFace?: Record<string, unknown> | null } & Record<string, unknown>;
const propsOf = (el: Element) => JSON.parse((el as HTMLElement).dataset.props ?? "{}") as PreviewProps;
const previews = () => screen.getAllByTestId("card-preview").map(propsOf);
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
const stepButtons = () =>
  Array.from(screen.getByRole("navigation", { name: /card editor steps/i }).querySelectorAll("button"));
async function goTo(step: RegExp) {
  const button = stepButtons().find((b) => step.test(b.textContent ?? ""));
  if (!button) throw new Error(`no step ${step}`);
  await click(button);
}
const activeStep = () =>
  screen.getByRole("navigation", { name: /card editor steps/i }).querySelector("[aria-current='step']")
    ?.textContent ?? "";
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const selected = () => screen.getByTestId("face-switch").dataset.face;
const named = (name: string) =>
  document.querySelector<HTMLElement>(`[name='${name}'], [data-field='${name}'], [data-field-anchor='${name}']`);
const change = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(named(name)!, { target: { value } });
  });
};

// kind chip, the profile's template, the table's words, whether the second
// part has a picture of its own.
const KINDS = [
  { chip: /^Split/, template: "split", kind: "split", ownArt: true },
  { chip: /^Aftermath/, template: "aftermath", kind: "aftermath", ownArt: true },
  { chip: /^Adventure/, template: "adventure", kind: "adventure", ownArt: false },
  { chip: /^Flip/, template: "flip", kind: "flip", ownArt: false },
] as const;
const wordsOf = (kind: (typeof KINDS)[number]["kind"]) => SECOND_PART_WORDS[kind]!;
/** What the second part's tab offers, per kind: everything the old panel
 *  showed. An adventure's spell has no flavour, stats, artist or art. */
const IDENTITY_FIELDS = (kind: string) =>
  kind === "adventure"
    ? ["back_face.title", "back_face.subtypes_text"]
    : ["back_face.title", "back_face.subtypes_text", "back_face.art_url", "back_face.artist_credit"];
const TEXT_FIELDS = (kind: string) =>
  kind === "adventure"
    ? ["back_face.rules_text"]
    : ["back_face.rules_text", "back_face.flavor_text", "back_face.power", "back_face.toughness", "back_face.loyalty", "back_face.defense"];

describe("the pure part", () => {
  it("a half's fields are on the step of their twin — its card type on Identity, a new card and an edit alike", () => {
    const create = visibleSteps({ template: "split", cardType: "instant", hasBackFace: true, kind: "split", revise: false });
    const edit = visibleSteps({ template: "split", cardType: "instant", hasBackFace: true, kind: "split", revise: true });
    const keyAt = (steps: typeof create, field: string) => steps[faceFieldStepIndex(field, steps, true, PART_FIELD_STEP)]?.key;
    for (const steps of [create, edit]) {
      expect(keyAt(steps, "back_face.card_type")).toBe("identity");
      expect(keyAt(steps, "back_face.title")).toBe("identity");
      expect(keyAt(steps, "back_face.art_url")).toBe("identity");
      for (const field of ["cost", "rules_text", "flavor_text", "power", "toughness", "loyalty", "defense"]) {
        expect(keyAt(steps, `back_face.${field}`), field).toBe("text");
      }
      expect(keyAt(steps, "back_face")).toBe("identity");
    }
    // The same fields as a double-faced back's table: only the type moved.
    expect(Object.keys(PART_FIELD_STEP).sort()).toEqual(Object.keys(BACK_FIELD_STEP).sort());
    expect(Object.entries(PART_FIELD_STEP).filter(([key, step]) => BACK_FIELD_STEP[key] !== step).map(([key]) => key).sort()).toEqual(
      ["card_type", "color_identity", "frame_style"],
    );
  });

  it("a part with no picture of its own is never asked for artwork", () => {
    expect(faceStatusOf({ title: "", art_url: "" }, { artwork: false }).text).toBe("needs a name");
    expect(faceStatusOf({ title: "Stomp", art_url: "" }, { artwork: false })).toEqual({ complete: true, text: "complete" });
    expect(faceStatusOf({ title: "Ice", art_url: "" }, { artwork: true }).text).toBe("needs artwork");
    // The default is part 1's rule.
    expect(faceStatusOf({ title: "Ice", art_url: "" }).text).toBe("needs artwork");
  });

  it("split and aftermath give the second part its own picture; adventure and flip do not", () => {
    expect(KINDS.map((k) => [k.template, secondPartHasOwnArt(getFrameProfile(k.template))])).toEqual([
      ["split", true],
      ["aftermath", true],
      ["adventure", false],
      ["flip", false],
    ]);
  });

  it("each part's box is on the card, from the profile's own rects, and the two say different places", () => {
    const right = (r: { leftPct: number; widthPct: number }) => r.leftPct + r.widthPct;
    const bottom = (r: { topPct: number; heightPct: number }) => r.topPct + r.heightPct;
    for (const { template } of KINDS) {
      const rects = partOutlineRects(getFrameProfile(template))!;
      for (const rect of [rects.front, rects.back]) {
        expect(rect.leftPct, template).toBeGreaterThanOrEqual(0);
        expect(rect.topPct, template).toBeGreaterThanOrEqual(0);
        expect(right(rect), template).toBeLessThanOrEqual(100);
        expect(bottom(rect), template).toBeLessThanOrEqual(100);
        expect(rect.widthPct, template).toBeGreaterThan(10);
        expect(rect.heightPct, template).toBeGreaterThan(10);
      }
    }
    // Split: left of the middle | right of it.
    const split = partOutlineRects(getFrameProfile("split"))!;
    expect(right(split.front)).toBeLessThan(51.5);
    expect(split.back.leftPct).toBeGreaterThan(48.5);
    // Aftermath: the top half over the sideways half — whose turned slots
    // (wide boxes before the quarter turn) land in the lower part.
    const aftermath = partOutlineRects(getFrameProfile("aftermath"))!;
    expect(bottom(aftermath.front)).toBeLessThan(aftermath.back.topPct + 1.5);
    expect(aftermath.back.topPct).toBeGreaterThan(50);
    expect(aftermath.back.heightPct).toBeGreaterThan(30);
    // Flip: the top side above the shared picture, the other side below it;
    // the picture belongs to neither.
    const flipProfile = getFrameProfile("flip");
    const flip = partOutlineRects(flipProfile)!;
    expect(bottom(flip.front)).toBeLessThan(flipProfile.artSlot.topPct + 2);
    expect(flip.back.topPct).toBeGreaterThan(flipProfile.artSlot.topPct + flipProfile.artSlot.heightPct - 2);
    // Adventure: the spell is its page, inside the creature's card.
    const adventure = partOutlineRects(getFrameProfile("adventure"))!;
    expect(right(adventure.back)).toBeLessThan(52);
    expect(adventure.back.topPct).toBeGreaterThan(adventure.front.topPct);
    expect(adventure.back.heightPct).toBeLessThan(adventure.front.heightPct / 2);
    // A frame with one part has none.
    expect(partOutlineRects(getFrameProfile("m15"))).toBeNull();
    expect(partOutlineRects(getFrameProfile("m15dfcfront"))).toBeNull();
  });

  it("the ring is creator chrome: hidden from assistive tech, takes no pointer, stills under reduced motion", () => {
    const rects = partOutlineRects(getFrameProfile("split"))!;
    render(<PartOutline rects={rects} face="back" />);
    const ring = screen.getByTestId("part-outline");
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(ring.dataset.face).toBe("back");
    expect(ring.className).toMatch(/(^| )pointer-events-none( |$)/);
    expect(ring.className).toMatch(/motion-reduce:transition-none/);
    expect(ring.style.left).toBe(`${rects.back.leftPct}%`);
    expect(ring.style.width).toBe(`${rects.back.widthPct}%`);
    expect(ring.textContent).toBe("");
  });
});

describe.each(KINDS)("$kind in the creator", ({ chip, kind, ownArt }) => {
  const words = wordsOf(kind);

  it("one switch in the kind's own words above every step; the step is the selected tab's panel; shared steps say so and the switch still works", async () => {
    renderForm();
    expect(screen.queryByTestId("face-switch")).toBeNull();
    await pickKind(chip);
    const steps = stepButtons().length;
    expect(steps).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < steps; i++) {
      await click(stepButtons()[i]);
      expect(screen.getAllByRole("tablist"), `step ${i}`).toHaveLength(1);
      const panel = screen.getByRole("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab(words.first).id);
      expect(tab(words.first).getAttribute("aria-controls")).toBe(panel.id);
      expect(tab(words.second).getAttribute("aria-disabled")).toBeNull();
      expect(screen.getByTestId("face-switch-note").textContent, `step ${i}`).toContain(`shared by ${words.both}`);
      // Never a double-faced card's words on a one-picture card.
      if (kind !== "adventure") expect(screen.queryByRole("tab", { name: /face/i })).toBeNull();
    }
    await goTo(/^card/i);
    expect(screen.getByTestId("face-switch-note").textContent).toBe(
      `Everything on this step is shared by ${words.both}. The switch still chooses which part the preview outlines.`,
    );
    await click(tab(words.second));
    expect(selected()).toBe("back");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab(words.second).id);
    // The card's own choices stay on both tabs of the Card step.
    expect(screen.getByRole("radiogroup", { name: "Card type" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Color identity" })).toBeTruthy();
  });

  it("each tab says what its part still needs — artwork only of a part that has a picture of its own", async () => {
    renderForm();
    await pickKind(chip);
    expect(tab(words.first).textContent).toBe(`${words.first}needs a name and artwork`);
    expect(tab(words.second).textContent).toBe(`${words.second}${ownArt ? "needs a name and artwork" : "needs a name"}`);
    await goTo(/^identity/i);
    await click(tab(words.second));
    await change("back_face.title", "Second Name");
    expect(tab(words.second).textContent).toBe(
      ownArt ? `${words.second}needs artwork` : `${words.second}Second Name· complete`,
    );
    // The tab's picture: the part's artwork in a card-shaped box, or — for
    // a part that never has one — a plain glyph.
    const thumbs = within(screen.getByRole("tablist")).getAllByTestId("face-thumb");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].dataset.faceThumb).toBeUndefined();
    expect(thumbs[1].dataset.faceThumb).toBe(ownArt ? undefined : "glyph");
    expect(thumbs.every((thumb) => thumb.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("the second part's fields are out of the fold: each on the step of its twin, on its own tab only", async () => {
    renderForm();
    await pickKind(chip);
    const identity = IDENTITY_FIELDS(kind);
    const text = TEXT_FIELDS(kind);
    const costShown = () => new RegExp(`${words.second} — Cost`).test(screen.getByRole("tabpanel").textContent ?? "");
    const steps = stepButtons().length;
    for (let i = 0; i < steps; i++) {
      await click(stepButtons()[i]);
      const here = activeStep();
      await click(tab(words.first));
      for (const field of [...identity, ...text]) expect(named(field), `${field} on ${here} / first`).toBeNull();
      expect(costShown(), `cost on ${here} / first`).toBe(false);
      expect(screen.queryByRole("radiogroup", { name: `${words.second} card type` })).toBeNull();
      await click(tab(words.second));
      for (const field of identity) expect(Boolean(named(field)), `${field} on ${here} / second`).toBe(/Identity/.test(here));
      for (const field of text) expect(Boolean(named(field)), `${field} on ${here} / second`).toBe(/Text/.test(here));
      expect(costShown(), `cost on ${here} / second`).toBe(/Text/.test(here));
      expect(Boolean(screen.queryByRole("radiogroup", { name: `${words.second} card type` })), `type on ${here}`).toBe(/Identity/.test(here));
      // The first part's own fields are not on the second part's tab.
      for (const field of ["title", "subtypes_text", "art_url", "rules_text"]) expect(named(field), `${field} on ${here} / second`).toBeNull();
    }
    // No fold holds the part any more; the name is in plain view.
    await goTo(/^identity/i);
    expect(screen.queryByText(new RegExp(`More options — artist credit & `))).toBeNull();
    expect(named("back_face.title")!.closest("details")).toBeNull();
    expect(named("back_face.subtypes_text")!.closest("details")).toBeNull();
    // The Types field (one per part) and the nine type chips, as before.
    expect(screen.getByTestId("types-field-input-back")).toBeTruthy();
    expect(within(screen.getByRole("radiogroup", { name: `${words.second} card type` })).getAllByRole("radio")).toHaveLength(9);
    expect(screen.getByRole("button", { name: `Clear ${words.phrase}` })).toBeTruthy();
    // An adventure's spell shares the creature's picture: no art box, no
    // artist, no flavour, no stats — as before.
    if (kind === "adventure") {
      expect(named("back_face.art_url")).toBeNull();
      expect(named("back_face.artist_credit")).toBeNull();
      await goTo(/^text/i);
      expect(named("back_face.flavor_text")).toBeNull();
      expect(named("back_face.power")).toBeNull();
    }
  });

  it("the same order on both tabs", async () => {
    renderForm();
    await pickKind(chip);
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
    await click(tab(words.second));
    const secondIdentity = ["back_face.title", `${words.second} card type`, "types-field-input-back", "back_face.subtypes_text", "back_face.art_url", "back_face.artist_credit"];
    expect(order(secondIdentity)).toEqual(secondIdentity.filter((n) => kind !== "adventure" || !/art/.test(n)));
    await goTo(/^text/i);
    const secondText = ["Rarity", "back_face.rules_text", "back_face.flavor_text", "back_face.power", "back_face.toughness", "back_face.loyalty", "back_face.defense"];
    expect(order(secondText)).toEqual(kind === "adventure" ? ["Rarity", "back_face.rules_text"] : secondText);
    // The cost is first, as the first part's is.
    const costGroup = screen.getByRole("group", { name: `${words.second} — Cost` });
    expect(costGroup.compareDocumentPosition(screen.getByRole("radiogroup", { name: "Rarity" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a moved field writes the form path it always wrote", async () => {
    renderForm();
    await pickKind(chip);
    await goTo(/^identity/i);
    await click(tab(words.second));
    await change("back_face.title", "Second Name");
    await change("back_face.subtypes_text", "Arcane, Trap");
    const sorcery = Array.from(
      screen.getByRole("radiogroup", { name: `${words.second} card type` }).querySelectorAll("[role='radio']"),
    ).find((el) => /^Sorcery/.test(el.textContent ?? ""))!;
    await click(sorcery);
    if (kind !== "adventure") await change("back_face.artist_credit", "Bo Marsh");
    await goTo(/^text/i);
    if (kind !== "adventure") {
      await change("back_face.flavor_text", "It hums.");
      await change("back_face.power", "3");
      await change("back_face.toughness", "2");
      await change("back_face.loyalty", "4");
      await change("back_face.defense", "5");
    }
    expect(previews()[0].backFace).toMatchObject({
      title: "Second Name",
      subtypes: ["Arcane", "Trap"],
      card_type: "sorcery",
      ...(kind !== "adventure"
        ? { artist_credit: "Bo Marsh", flavor_text: "It hums.", power: "3", toughness: "2", loyalty: "4", defense: "5" }
        : {}),
    });
    // "Clear" empties the part and keeps the kind's own type, as before.
    await goTo(/^identity/i);
    await click(screen.getByRole("button", { name: `Clear ${words.phrase}` }));
    expect(previews()[0].backFace).toMatchObject({ title: "" });
    expect(String(previews()[0].backFace?.card_type)).toBe(words.blankCardType ?? (kind === "aftermath" ? "sorcery" : kind === "flip" ? "creature" : "instant"));
  });

  it("a field is heard with its part; what is the card's is not", async () => {
    renderForm();
    await pickKind(chip);
    await goTo(/^identity/i);
    expect(screen.getByLabelText(new RegExp(`^${words.first} — Title`))).toBe(named("title"));
    expect(screen.getByText(`${words.first} — Artwork`)).toBeTruthy();
    await click(tab(words.second));
    expect(screen.getByLabelText(new RegExp(`^${words.second} — Title`))).toBe(named("back_face.title"));
    expect(screen.getByLabelText(new RegExp(`^${words.second} — Subtypes`))).toBe(named("back_face.subtypes_text"));
    expect(Boolean(screen.queryByText(`${words.second} — Artwork`))).toBe(kind !== "adventure");
    // A picture the frame never draws is said so, where it is offered.
    expect(Boolean(screen.queryByTestId("second-part-art-not-drawn"))).toBe(kind === "flip");
    if (kind === "flip") expect(screen.getByTestId("second-part-art-not-drawn").textContent).toBe(secondPartArtNotDrawnNote(words));
    await goTo(/^text/i);
    expect(screen.getByLabelText(`${words.second} rules text`)).toBeTruthy();
    expect(screen.getByRole("group", { name: `${words.second} — Rules text` })).toBeTruthy();
    expect(screen.queryByLabelText("Back face rules text")).toBeNull();
    const rarityGroup = screen.getByRole("radiogroup", { name: "Rarity" }).closest("[role='group']")!;
    expect(screen.getByRole("group", { name: "Rarity" })).toBe(rarityGroup);
  });

  it("ONE preview: no two-face preview; the part being edited is outlined and named — beside the card, never in it", async () => {
    renderForm();
    await pickKind(chip);
    expect(screen.queryByTestId("face-preview")).toBeNull();
    expect(screen.queryByTestId("face-preview-other")).toBeNull();
    const rings = () => screen.getAllByTestId("part-outline");
    // The phone's block and the desktop column: one ring on each preview.
    expect(rings()).toHaveLength(screen.getAllByTestId("card-preview").length);
    expect(rings().every((ring) => ring.dataset.face === "front")).toBe(true);
    for (const label of screen.getAllByTestId("part-editing-label")) expect(label.textContent).toMatch(new RegExp(`^Editing: ${words.first}`));
    const before = previews().map((props) => JSON.stringify({ ...props, face: undefined }));
    const frontBox = rings()[0].getAttribute("style");

    await click(tab(words.second));
    expect(rings().every((ring) => ring.dataset.face === "back")).toBe(true);
    expect(rings()[0].getAttribute("style")).not.toBe(frontBox);
    for (const label of screen.getAllByTestId("part-editing-label")) expect(label.textContent).toMatch(new RegExp(`^Editing: ${words.second}`));
    // Nothing of the ring is the card's: it is a sibling of the preview,
    // and the renderer is handed the same props whichever tab is selected.
    for (const ring of rings()) {
      expect(ring.closest("[data-testid='card-preview']")).toBeNull();
      expect(ring.parentElement!.querySelector(":scope > [data-testid='card-preview']")).toBeTruthy();
      expect(ring.getAttribute("aria-hidden")).toBe("true");
    }
    expect(previews().map((props) => JSON.stringify({ ...props, face: undefined }))).toEqual(before);
    // The single preview keeps the props it always had (no Face tabs chrome).
    expect(previews().every((props) => props.hideFlipControl === undefined)).toBe(true);
    expect(JSON.stringify(previews())).not.toMatch(/outline/i);
    // The tab — and its ring — stay through a step change.
    await goTo(/^text/i);
    expect(selected()).toBe("back");
    expect(rings().every((ring) => ring.dataset.face === "back")).toBe(true);
  });

  it("still needed, per part: each link selects the tab and the step and focuses the field", async () => {
    renderForm();
    await pickKind(chip);
    const line = () => screen.getByTestId("save-needs");
    const need = (id: string) => line().querySelector<HTMLButtonElement>(`button[data-need='${id}']`)!;
    expect(line().textContent).toBe(
      `Still needed to save: ${words.first} — a title and artwork · ${words.second} — a name.`,
    );
    // The Save rule is unchanged: its own sentence is the button's hover
    // text, and a half's artwork is never one of its items.
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).title).toBe(
      `Add a title, artwork and ${words.phrase}'s name to enable Save.`,
    );
    expect(need("second-art")).toBeNull();
    await goTo(/^publish/i);
    await click(need("second-name"));
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("back");
    expect(document.activeElement).toBe(named("back_face.title"));
    expect(need("second-name").getAttribute("aria-label")).toBe(
      `${words.second}: a name — go to this field on the ${words.second} tab of the Identity step`,
    );
    await goTo(/^text/i);
    await click(need("title"));
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("front");
    expect(document.activeElement).toBe(named("title"));
  });

  it("a server error on a second-part field opens ITS step on the part's tab", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.rules_text": "That part's rules are too long." },
    });
    renderForm();
    await pickKind(chip);
    await goTo(/^identity/i);
    await change("title", "First Name");
    await goTo(/^publish/i);
    await click(screen.getByTestId("save-as-draft"));
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(activeStep()).toMatch(/Text/));
    expect(selected()).toBe("back");
    expect(screen.getByText("That part's rules are too long.")).toBeTruthy();
  });
});

describe("between kinds, and on a stored card", () => {
  it("the tab stays between two one-picture kinds; a change to or from a double-faced card starts on the front", async () => {
    renderForm();
    await pickKind(/^Split/);
    await click(tab("Right half"));
    await pickKind(/^Aftermath/);
    expect(selected()).toBe("back");
    expect(tab("Aftermath half").getAttribute("aria-selected")).toBe("true");
    await pickKind(/^Transform/);
    expect(selected()).toBe("front");
    await click(tab("Back face"));
    await pickKind(/^Flip/);
    expect(selected()).toBe("front");
    expect(screen.queryByTestId("face-preview")).toBeNull();
    // …and a one-part card has no switch, no ring, no label.
    await click(tab("Flipped side"));
    // (An empty part is dropped without a question.)
    await pickKind(/^Creature/);
    expect(screen.queryByTestId("face-switch")).toBeNull();
    expect(screen.queryByTestId("part-outline")).toBeNull();
    expect(screen.queryByTestId("part-editing-label")).toBeNull();
  });

  it("an edit: the half's fields — its card type too — are on its tab of the Identity step, editable as before", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "fire" });
    renderForm({ mode: "edit", card: storedSplit() });
    expect(activeStep()).toMatch(/Identity/);
    expect(selected()).toBe("front");
    expect(tab("Right half").textContent).toBe("Right halfneeds artwork");
    expect(named("back_face.title")).toBeNull();
    await click(tab("Right half"));
    expect((named("back_face.title") as HTMLInputElement).value).toBe("Ice");
    const types = screen.getByRole("radiogroup", { name: "Right half card type" });
    expect(types.querySelector("[aria-checked='true']")?.textContent).toMatch(/^Instant/);
    expect(Array.from(types.querySelectorAll("[role='radio']")).every((el) => !(el as HTMLButtonElement).disabled)).toBe(true);
    await click(Array.from(types.querySelectorAll("[role='radio']")).find((el) => /^Sorcery/.test(el.textContent ?? ""))!);
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.updateCardAction.mock.calls[0][1] as { back_face?: { card_type?: string; title?: string } };
    expect(payload.back_face).toMatchObject({ card_type: "sorcery", title: "Ice" });
  });

  it("a legacy back on a one-part frame keeps its art strip and gets no switch", async () => {
    renderForm({
      mode: "edit",
      card: storedSplit({
        card_type: "creature",
        frame_style: { finish: "regular", template: "m15" },
        back_face: { title: "Insectile Aberration", card_type: "creature", subtypes: [] },
      }),
    });
    expect(screen.queryByTestId("face-switch")).toBeNull();
    expect(screen.queryByTestId("part-outline")).toBeNull();
    expect(screen.getByTestId("back-face-art")).toBeTruthy();
  });
});

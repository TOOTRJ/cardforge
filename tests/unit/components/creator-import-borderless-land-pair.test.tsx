// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { json, namedBody } from "./scryfall-import-stubs";

// ---------------------------------------------------------------------------
// TODO 4.56 through the REAL import chooser and the REAL creator form (the
// skeptic pass, 2026-10-07): a two-colour borderless land printing imported
// with "Borderless Land" picked keeps its pair and the two-colour switch —
// it fell back to plain Multicolor and the gold master before the frame
// drew pairs — and the chooser's tiles show the master each pick paints (a
// two-colour printing's land tiles were gold whichever frame was picked).
// The pair rides the gold `m` tick: without it Borderless Land is not
// listed, and a stale pick lands on the bordered land frame. The import
// dialog is a stub that hands the form a payload built by the real mapper
// (harness: creator-import-frame-choice.test.tsx).
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
const actions = vi.hoisted(() => ({ createCardAction: vi.fn(), updateCardAction: vi.fn(), recordFrameRequestAction: vi.fn() }));
vi.mock("@/lib/cards/actions", () => ({ createCardAction: actions.createCardAction, updateCardAction: actions.updateCardAction }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
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
  CardPreview: (props: { frameStyle?: unknown; colorIdentity?: string[] }) => (
    <div data-testid="card-preview" data-frame-style={JSON.stringify(props.frameStyle ?? null)} data-colors={(props.colorIdentity ?? []).join(",")} />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { ImportFrameChooser } from "@/components/creator/import/frame-chooser";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { importedAnatomy, importedFormAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { importFramePlan } from "@/lib/creator/import-frame-choice";
import type { ColorIdentity, FrameStyle, FrameTemplate } from "@/types/card";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const all = (...templates: string[]) => templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k)));
const VERIFIED = all("m15", "m15land", "m15artifact", "m15borderless", "m15borderlessland");
const WITHOUT_M = VERIFIED.filter((key) => key !== frameComboKey("m15borderlessland", "m"));

function renderForm(verified: string[] = VERIFIED) {
  return render(
    <CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={verified} />,
  );
}
const style = () => JSON.parse(screen.getAllByTestId("card-preview")[0]!.dataset.frameStyle ?? "null") as FrameStyle;
const colors = () => (screen.getAllByTestId("card-preview")[0]!.dataset.colors ?? "").split(",").filter(Boolean) as ColorIdentity[];
/** The master both renderers paint for what the form holds (a land). */
const master = () => frameMasterKey(getFrameProfile(style().template), colors(), { cardType: "land", cost: "" }, style());

async function importKey(key: string, extra: Record<string, unknown> = {}, verified: string[] = VERIFIED) {
  const named = namedBody(key, new Set(verified));
  importer.payload = { patch: named.patch, importedArtUrl: null, source: { name: named.card.name, scryfallUri: null }, ...extra };
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "test: import" }));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
  importer.payload = null;
});

describe("the import chooser's tiles paint what each pick gives (ImportFrameChooser)", () => {
  /** Each chip's label and the master its tile paints. */
  function tiles(key: string, verified: string[] = VERIFIED, current: FrameTemplate = "m15land") {
    const patch = namedBody(key, new Set(verified)).patch;
    const plan = importFramePlan(patch, new Set(verified), current);
    if (plan.mode !== "choose") throw new Error(`${key}: ${plan.mode}`);
    const picked: unknown[] = [];
    const { container } = render(
      <ImportFrameChooser
        plan={plan}
        value={plan.preselected}
        onChange={(choice) => picked.push(choice)}
        colorIdentity={patch.color_identity}
        type={{ cardType: patch.card_type, supertype: patch.supertype, cost: patch.cost }}
        printing={patch}
      />,
    );
    const radios = [...container.querySelectorAll<HTMLElement>("[role='radio']")];
    const out = radios.map((radio) => ({
      label: (radio.textContent ?? "").replace(/(Nearest to this printing|This printing's frame.*|Art reaches the card edge|M15 \(2015\) (Land|Standard)$)/, "").trim() || (radio.textContent ?? ""),
      text: radio.textContent ?? "",
      tile: radio.querySelector("[data-frame-key]")?.getAttribute("data-frame-key") ?? null,
    }));
    return { plan, patch, out, radios, picked };
  }
  const tileOf = (rows: { text: string; tile: string | null }[], label: RegExp) => rows.find((row) => label.test(row.text))?.tile;

  it("Deserted Beach MID #281 (W|U): both land frames show the white | blue pair — and picking Borderless Land is the pick", () => {
    const { plan, out, radios, picked } = tiles("mid-281");
    expect(plan.match).toMatchObject({ status: "exact", template: "m15borderlessland", landOn: "m15land" });
    expect(plan.preselected).toEqual({ template: "m15land" });
    expect(tileOf(out, /^M15 \(2015\) Land/)).toBe("wu");
    expect(tileOf(out, /Borderless Land/)).toBe("wu");
    expect(tileOf(out, /Keep my current frame/)).toBe("wu");
    fireEvent.click(radios.find((radio) => /Borderless Land/.test(radio.textContent ?? ""))!);
    expect(picked).toEqual([{ template: "m15borderlessland" }]);
  });

  it.each([
    ["otj-304", "ur", "exact"],
    // A pinned dark print: nearest, and still its own pair on the frame.
    ["woe-303", "rw", "nearest"],
  ] as const)("%s: the pair %s on both land tiles (%s)", (key, pair, status) => {
    const { plan, out } = tiles(key);
    expect(plan.match.status).toBe(status);
    expect(tileOf(out, /^M15 \(2015\) Land/)).toBe(pair);
    expect(tileOf(out, /Borderless Land/)).toBe(pair);
  });

  it("a mono land (Arena of Glory MH3 #351) and a five-colour one (Command Tower CMM #659) keep their own masters", () => {
    for (const [key, master] of [["mh3-351", "r"], ["cmm-659", "m"]] as const) {
      const { out } = tiles(key);
      expect(tileOf(out, /^M15 \(2015\) Land/), key).toBe(master);
      expect(tileOf(out, /Borderless Land/), key).toBe(master);
      cleanup();
    }
  });

  it("every tile is the master the card paints on that frame once the pick is applied (the creator's own rule)", () => {
    for (const key of ["mid-281", "otj-304", "woe-303", "mh3-351", "cmm-659", "spg-109", "mh3-353"]) {
      const { plan, patch, out } = tiles(key);
      const options = [...plan.options, ...plan.moreOptions];
      expect(options.length, key).toBeGreaterThan(0);
      options.forEach((option, index) => {
        const imported = importedAnatomy(patch, option.template);
        const painted = frameMasterKey(
          getFrameProfile(option.template),
          imported.colorIdentity ?? patch.color_identity ?? [],
          { cardType: patch.card_type, supertype: patch.supertype, cost: patch.cost },
          importedFormAnatomy(imported.style),
        );
        expect(out[index]!.tile, `${key} on ${option.template}`).toBe(painted);
      });
      cleanup();
    }
  });

  it("the same rule on the spells' frames: a crowned borderless legend's tile is the crowned twin its pick paints (Sheoldred DMU #435)", () => {
    const { plan, out } = tiles("dmu-435", VERIFIED, "m15");
    expect(plan.options.map((option) => option.template)).toEqual(["m15", "m15borderless"]);
    // m15 draws its crown as a band over the plain master; the borderless
    // frame bakes it into the `-legendary` twin (4.6f, wave 2a).
    expect(out.slice(0, 2).map((row) => row.tile)).toEqual(["b", "b-legendary"]);
  });

  it("without the `m` tick Borderless Land is not listed for a pair (it rides that tick)", () => {
    const { plan, out } = tiles("mid-281", WITHOUT_M);
    expect(plan.match).toMatchObject({ status: "nearest", reason: "not yet verified in multicolor" });
    expect([...plan.options, ...plan.moreOptions].map((option) => option.template)).toEqual(["m15land"]);
    expect(tileOf(out, /Borderless Land/)).toBeUndefined();
    expect(tileOf(out, /^M15 \(2015\) Land/)).toBe("wu");
  });
});

describe("the creator form after the pick (CardCreatorForm)", () => {
  it.each([
    ["mid-281", ["white", "blue"], "wu"],
    ["otj-304", ["blue", "red"], "ur"],
    // The 2024 fetch land: an empty identity, the two colours it searches for.
    ["mh3-353", ["white", "blue"], "wu"],
    // Pinned prints land on the frame's nearest look: their own pair.
    ["woe-303", ["red", "white"], "rw"],
    ["spg-109", ["red", "white"], "rw"],
  ] as const)("%s with Borderless Land picked: the pair %s and the switch on", async (key, pair, pairMaster) => {
    renderForm();
    await importKey(key, { frameChoice: { template: "m15borderlessland" } });
    expect(style()).toMatchObject({ template: "m15borderlessland", twoColor: true });
    expect(colors()).toEqual(pair);
    expect(master()).toBe(pairMaster);
    // What a save stores: the frame, its finish and the one switch it draws.
    expect(newCardFrameStyle(style(), "land")).toEqual({ template: "m15borderlessland", finish: "regular", twoColor: true });
  });

  it("a mono land keeps its colour; the default landing (no pick) stays the bordered land frame with its pair", async () => {
    renderForm();
    await importKey("mh3-351", { frameChoice: { template: "m15borderlessland" } });
    expect(style().template).toBe("m15borderlessland");
    expect(colors()).toEqual(["red"]);
    expect(master()).toBe("r");
    cleanup();
    renderForm();
    await importKey("mid-281");
    expect(style()).toMatchObject({ template: "m15land", twoColor: true });
    expect(colors()).toEqual(["white", "blue"]);
    expect(master()).toBe("wu");
  });

  it("a stale Borderless Land pick on a database without the `m` tick falls back to the bordered land frame", async () => {
    renderForm(WITHOUT_M);
    await importKey("mid-281", { frameChoice: { template: "m15borderlessland" } }, WITHOUT_M);
    expect(style().template).toBe("m15land");
    expect(colors()).toEqual(["white", "blue"]);
  });

  it("offers the two-colour switch there and nothing the frame doesn't draw (no crown, collector line or stamp)", async () => {
    renderForm();
    await importKey("mid-281", { frameChoice: { template: "m15borderlessland" } });
    const switches = new Set<string>();
    for (const name of [/^Card$/, /Identity/, /Text & stats/, /Set & collector info/, /Subscriber/, /Publish/]) {
      const buttons = screen.queryAllByRole("button", { name });
      if (buttons.length === 0) continue;
      await act(async () => {
        fireEvent.click(buttons[0]!);
      });
      for (const el of screen.queryAllByRole("switch")) switches.add(`${el.getAttribute("aria-label")}=${el.getAttribute("aria-checked")}`);
    }
    expect([...switches]).toEqual(["Two-colour frame=true"]);
  });
});

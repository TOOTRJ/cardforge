// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ColorIdentity, FrameStyle, GameSystem } from "@/types/card";
import fixture from "../scryfall/fixtures/part-colour-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.26, N1 — the first half's own frame colour (M2:
// frame_style.firstPartColor) survives a SECOND split / aftermath import in
// the same creator session (Fire // Ice, then Cut // Ribbons: the second
// import's own first half, red, never cleared by the colour change the
// import itself makes), and is dropped when the maker then picks the card's
// colour by hand (that colour IS the first half's). Through the REAL
// creator form with a stub import dialog handing it the real mapper's
// finalized patch, and through the hook alone.
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
import { useSecondPartColorFollow } from "@/components/creator/panels/anatomy-panel";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { ScryfallCard } from "@/lib/scryfall/client";
import type { FormValues } from "@/lib/creator/form-types";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["split", "aftermath", "m15"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => `${t}/${k}`));
const PRINTINGS = (fixture as { printings: Record<string, ScryfallCard> }).printings;

const style = () => JSON.parse(screen.getAllByTestId("card-preview")[0]!.dataset.frameStyle ?? "null") as FrameStyle;

async function importKey(key: string) {
  const card = PRINTINGS[key]!;
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card), new Set(VERIFIED));
  importer.payload = { patch, importedArtUrl: null, source: { name: card.name, scryfallUri: null } };
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "test: import" }));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
  importer.payload = null;
});

describe("two split / aftermath imports in one creator session (N1)", () => {
  it("each keeps its own first half's colour", async () => {
    render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
    await importKey("dmr-215"); // Fire // Ice: Fire red
    expect(style()).toMatchObject({ template: "split", firstPartColor: ["red"] });
    await importKey("akh-223"); // Cut // Ribbons: Cut red
    expect(style()).toMatchObject({ template: "aftermath", firstPartColor: ["red"] });
    await importKey("akh-216"); // Reduce // Rubble: Reduce blue
    expect(style()).toMatchObject({ template: "aftermath", firstPartColor: ["blue"] });
    await importKey("dmr-215"); // back to Fire // Ice
    expect(style()).toMatchObject({ template: "split", firstPartColor: ["red"] });
    // A one-colour split (Insult // Injury): no first half of its own.
    await importKey("akh-213");
    expect(style().firstPartColor).toBeUndefined();
  });
});

describe("useSecondPartColorFollow — the first half's colour and the card's", () => {
  function harness() {
    return renderHook(() => {
      const form = useForm<FormValues>({
        defaultValues: {
          color_identity: ["multicolor"],
          frame_style: { template: "split", finish: "regular", partColor: true },
          back_face: { cost: "", color_identity: [] },
        } as unknown as FormValues,
      });
      const follow = useSecondPartColorFollow(form, true, new Set(VERIFIED));
      return { form, follow };
    });
  }
  const first = (h: ReturnType<typeof harness>) => h.result.current.form.getValues("frame_style.firstPartColor");

  it("an import's colour change never clears the first half the import set; a later hand pick does", () => {
    const h = harness();
    const imports = (colors: ColorIdentity[], firstPart: ColorIdentity[] | undefined) =>
      act(() => {
        h.result.current.follow.noteImport();
        h.result.current.form.setValue("color_identity", colors);
        h.result.current.form.setValue("frame_style.firstPartColor", firstPart);
      });
    imports(["multicolor"], ["red"]);
    expect(first(h)).toEqual(["red"]);
    // A second import whose card's colour differs (Assault // Battery, say,
    // stored gold — any colour), its own first half: kept.
    imports(["green", "red"], ["red"]);
    expect(first(h)).toEqual(["red"]);
    imports(["multicolor"], ["blue"]);
    expect(first(h)).toEqual(["blue"]);
    // The maker picks the card's colour by hand: that IS the first half's.
    act(() => {
      h.result.current.form.setValue("color_identity", ["white"]);
    });
    expect(first(h)).toBeUndefined();
  });
});

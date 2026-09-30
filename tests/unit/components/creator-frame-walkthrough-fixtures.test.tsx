// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import walkPrintings from "../creator/fixtures/walkthrough-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import {
  FRAME_COLOR_KEYS,
  frameComboKey,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// "Walk the stepper" (TODO 2.2) on REAL printings: the seed comes from the
// compare view's own payload (buildFrameComparePayload → the import mapper,
// second face included) and lands in the real CardCreatorForm through the
// user's import handler. Every layout frame the spec names — battle,
// adventure, saga, split, flip, aftermath — walks its registry reference and
// must land on the frame AND colour under test with its second face, on the
// Card step, without a "wrong colour" toast.
//
// Fixtures are real Scryfall payloads (/cards/:id, captured once on
// 2026-09-28 for the references the import fixtures lack — TKLD #2 on
// 2026-09-29, after TODO 4.49's token re-pin, and TDOM #2 / TXLN #7 (with
// their rules text) for 4.49 (b)'s text-box tokens, the six full-art
// token references of 4.48 / 4.50 (2026-09-29, with their text), and M21
// #280 / #281 for 4.33's borderless planeswalkers (2026-09-29); the rest reuse
// tests/unit/scryfall/fixtures/import-printings.json), trimmed like those to
// identity + the frame fields (no rules or flavour text) and parsed through
// the routes' zod schema. No network. The walk's skins/treatments ride the
// same path; the five whose registry default is already a fixture are here.
// ---------------------------------------------------------------------------

const fixtures = vi.hoisted(() => ({ byId: new Map<string, unknown>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getFrameReviews: async () => new Map(),
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    getCardById: async (id: string) => {
      const raw = fixtures.byId.get(id);
      return raw ? actual.scryfallCardSchema.parse(raw) : null;
    },
  };
});

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
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
vi.mock("@/components/billing/upgrade-modal-provider", () => ({
  useUpgradeModal: () => ({ open: vi.fn() }),
}));
vi.mock("@/components/billing/credit-confirm-provider", () => ({
  useCreditConfirm: () => async () => true,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: {
    title?: string;
    frameStyle?: { template?: string };
    colorIdentity?: string[];
    backFace?: { title?: string } | null;
  }) => (
    <div
      data-testid="card-preview"
      data-title={props.title ?? ""}
      data-template={props.frameStyle?.template ?? ""}
      data-colors={(props.colorIdentity ?? []).join(",")}
      data-back-title={props.backFace?.title ?? ""}
    />
  ),
}));

import { buildFrameWalkthrough } from "@/lib/creator/frame-walkthrough";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { ColorIdentity, GameSystem } from "@/types/card";

for (const raw of [...Object.values(walkPrintings), ...Object.values(importPrintings)]) {
  fixtures.byId.set((raw as { id: string }).id, raw);
}

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const ALL_KEYS = FRAME_TEMPLATE_VALUES.flatMap((t) =>
  FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
);
// Only the M15 standard is "verified" — every layout walk is a preview.
const PUBLISHED = FRAME_COLOR_KEYS.map((k) => frameComboKey("m15", k));

function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    title: el.dataset.title ?? "",
    template: el.dataset.template ?? "",
    colors: (el.dataset.colors ?? "").split(",").filter(Boolean) as ColorIdentity[],
    backTitle: el.dataset.backTitle ?? "",
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(toast)) fn.mockReset();
});

// template, colour, the registry reference's front name, its second face.
const CASES: Array<[FrameTemplate, FrameColorKey, string, string]> = [
  ["adventure", "g", "Lovestruck Beast", "Heart's Desire"],
  ["adventure", "r", "Bonecrusher Giant", "Stomp"],
  ["battle", "r", "Invasion of Mercadia", "Kyren Flamewright"],
  ["battle", "c", "Invasion of Ravnica", "Guildpact Paragon"],
  ["split", "m", "Expansion", "Explosion"],
  ["aftermath", "r", "Insult", "Injury"],
  ["aftermath", "m", "Driven", "Despair"],
  ["flip", "g", "Budoka Gardener", "Dokai, Weaver of Life"],
  ["saga", "m", "The Kami War", "O-Kagachi Made Manifest"],
  ["saga", "c", "Urza's Saga", ""],
  // Skins and treatments whose registry default is in the import fixtures.
  ["m15artifact", "c", "Solemn Simulacrum", ""],
  ["m15land", "m", "Command Tower", ""],
  ["m15snowland", "u", "Snow-Covered Island", ""],
  ["m15devoid", "w", "Eldrazi Displacer", ""],
  // TKLD #2 since TODO 4.49's re-pin (the TMSH Treasure is an M20+ print).
  ["m15tokenartifact", "c", "Construct", ""],
  // TODO 4.49 (b)'s unverified text-box tokens: the walk reaches them
  // (TDOM #2 Knight, TXLN #7 Treasure — captured with their rules text, so
  // the registry names the text-box frame too).
  ["m15tokentext", "w", "Knight", ""],
  ["m15tokenartifacttext", "c", "Treasure", ""],
  // TODO 4.33's unverified borderless planeswalkers (M21 #280 / #281,
  // captured with their rules text): the walk lands on the frame under
  // test, the tall one included — the row follow never moves it.
  ["m15borderlesspw", "w", "Basri Ket", ""],
  ["m15borderlesspwtall", "u", "Teferi, Master of Time", ""],
  // TODO 4.48 / 4.50's unverified full-art tokens: every height and its
  // artifact template, from their measured references (TFDN #6 Soldier,
  // TFDN #27 Cat, TBLB #5 Warren Warleader; TDSK #7 Toy, TFDN #23 Treasure,
  // TLCI #17 Map) — captured with their text, so the registry's height rule
  // names the height they print.
  ["m20token", "w", "Soldier", ""],
  ["m20tokentext", "w", "Cat", ""],
  ["m20tokentall", "w", "Warren Warleader", ""],
  ["m20tokenartifact", "w", "Toy", ""],
  ["m20tokenartifacttext", "c", "Treasure", ""],
  ["m20tokenartifacttall", "c", "Map", ""],
];

describe("walking a layout frame from its real reference printing", () => {
  it.each(CASES)("%s/%s → %s", async (template, colorKey, front, back) => {
    const walkthrough = await buildFrameWalkthrough({
      template,
      color: colorKey,
      seed: "reference",
    });
    expect(walkthrough?.seed?.fromReference).toBe(true);

    render(
      <CardCreatorForm
        mode="create"
        userId={USER}
        ownerUsername="tester"
        gameSystems={[{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem]}
        aiConfigured
        verifiedFrameKeys={ALL_KEYS}
        framePreview={{ param: "all", publishedKeys: PUBLISHED, walkthrough }}
      />,
    );

    await waitFor(() => expect(preview().title).toBe(front));
    const shown = preview();
    expect(shown.template).toBe(template);
    expect(pickFrameColorKey(shown.colors)).toBe(colorKey);
    expect(shown.backTitle).toBe(back);
    // The walk starts on the Card step and never announces another colour
    // or a substituted frame.
    expect(document.querySelector('[aria-current="step"]')?.textContent?.trim()).toBe("Card");
    expect(toast.info).not.toHaveBeenCalled();
    // The save is a frame preview (the walk's rule).
    expect(screen.getByTestId("frame-preview-save")).toBeTruthy();
  });
});

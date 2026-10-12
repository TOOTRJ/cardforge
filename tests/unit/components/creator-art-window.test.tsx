// @vitest-environment happy-dom
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 3b.13 through the real CardCreatorForm (the harness of
// creator-form-reliability.test.tsx): the art positioner on the Art step is
// sized from the frame the form is on — the same props the live preview is
// handed — and follows a change of kind (frame) and of colour. The upload
// itself is stubbed; the server actions, the router, the billing providers
// and the heavy dialogs too.
// ---------------------------------------------------------------------------

const ART_URL = "https://project.supabase.co/storage/v1/object/public/card-art/u/grid.png";
vi.mock("@/lib/cards/art-upload-client", () => ({
  uploadCardArtFile: vi.fn(async () => ({ ok: true, publicUrl: ART_URL })),
}));

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/create",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
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

const actions = vi.hoisted(() => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: actions.linkDeckCardAction,
}));
vi.mock("@/lib/frames/frame-request-actions", () => ({
  recordFrameRequestAction: actions.recordFrameRequestAction,
}));

// The dialogs the tests don't drive render nothing; the Ideas dialog is a
// button that applies whatever patch the test put in `ideas.patch`.
const ideas = vi.hoisted(() => ({ patch: {} as Record<string, unknown> }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
  // The deck pre-fill toasts the printing's treatment notice through it.
  toastImportNotice: () => {},
}));
// The AI fill dialog reports the fields the form hides from it.
const fill = vi.hoisted(() => ({ hidden: undefined as readonly string[] | undefined }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: (props: { hiddenFields?: readonly string[] }) => {
    fill.hidden = props.hiddenFields;
    return null;
  },
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({
  CardIdeasDialog: ({ onApply }: { onApply: (patch: unknown) => void }) => (
    <button type="button" onClick={() => onApply(ideas.patch)}>
      test: apply idea
    </button>
  ),
}));
// The live preview is covered by its own tests; here it reports the watched
// form values it was handed, which is what the assertions read.
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: {
    title?: string;
    cardType?: string | null;
    supertype?: string | null;
    power?: string | null;
    rarity?: string | null;
    rulesText?: string;
    frameStyle?: { template?: string };
    faceContent?: unknown;
    backFace?: { title?: string; card_type?: string } | null;
  }) => (
    <div
      data-testid="card-preview"
      data-title={props.title ?? ""}
      data-card-type={props.cardType ?? ""}
      data-supertype={props.supertype ?? ""}
      data-power={props.power ?? ""}
      data-rarity={props.rarity ?? ""}
      data-template={props.frameStyle?.template ?? ""}
      data-rules={props.rulesText ?? ""}
      data-face-content={JSON.stringify(props.faceContent ?? null)}
      data-back-face={JSON.stringify(props.backFace ?? null)}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [
  { id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem,
];
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
].flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k)));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p data-testid="error-boundary">{this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

type FormProps = Parameters<typeof CardCreatorForm>[0];

function renderForm(props: Partial<FormProps> = {}) {
  const all: FormProps = {
    mode: "create",
    userId: USER,
    ownerUsername: "tester",
    gameSystems: GAME_SYSTEMS,
    aiConfigured: true,
    verifiedFrameKeys: VERIFIED,
    ...props,
  };
  const view = render(
    <Boundary>
      <CardCreatorForm {...all} />
    </Boundary>,
  );
  return {
    ...view,
    rerenderWith: (next: Partial<FormProps>) =>
      view.rerender(
        <Boundary>
          <CardCreatorForm {...all} {...next} />
        </Boundary>,
      ),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
  );
  // A server action always returns a promise; a bare vi.fn() returns
  // undefined, and the form's fire-and-forget `.catch` on it would throw
  // mid-import for any inexact printing (Beck // Call DGM #123 in 1.21 is a
  // nearest split) — the frame request tests override this per test.
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
  ideas.patch = {};
});

/** What the live preview was last handed (desktop and mobile get the same). */
function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    title: el.dataset.title,
    cardType: el.dataset.cardType,
    supertype: el.dataset.supertype,
    power: el.dataset.power,
    rarity: el.dataset.rarity,
    template: el.dataset.template,
    rules: el.dataset.rules,
    faceContent: JSON.parse(el.dataset.faceContent ?? "null"),
    backFace: JSON.parse(el.dataset.backFace ?? "null"),
  };
}

function chipIn(group: string, label: RegExp) {
  const radiogroup = screen.getByRole("radiogroup", { name: group });
  const chip = Array.from(radiogroup.querySelectorAll("[role='radio']")).find(
    (el) => label.test(el.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
  if (!chip) throw new Error(`no ${group} chip ${label}`);
  return chip;
}

async function clickChip(group: string, label: RegExp) {
  const chip = chipIn(group, label);
  await act(async () => {
    fireEvent.click(chip);
  });
}

const pickKind = (label: RegExp) => clickChip("Card type", label);

async function clickNext(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}



async function clickBack() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
  });
}

const surface = () => document.querySelector("[data-art-uploader]") as HTMLDivElement;

const surfaces = () => Array.from(document.querySelectorAll<HTMLDivElement>("[data-art-uploader]"));

/** Upload into the n-th mounted uploader (0 = the front's). */
async function uploadArt(index = 0) {
  const input = screen.getAllByLabelText("Upload card art")[index] as HTMLInputElement;
  const file = new File([new Uint8Array([137, 80, 78, 71])], "grid.png", { type: "image/png" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await waitFor(() => expect(surfaces()[index].dataset.artWindowAspect).toBeTruthy());
}

describe("3b.13 the Art step's positioner is the frame's art window", () => {
  it("a new card: the M15 window; the empty dropzone names its size", async () => {
    renderForm();
    await clickNext();
    expect(screen.getByTestId("art-best-size").textContent).toBe("Best results: 1271 × 931 px or larger");
    await uploadArt();
    expect(surface().dataset.artWindowAspect).toBe("1.3657");
    expect(preview().template).toBe("m15");
  });

  it("follows the frame: creature → saga → planeswalker → battle, with the same art", async () => {
    renderForm();
    await clickNext();
    await uploadArt();
    expect(surface().dataset.artWindowAspect).toBe("1.3657");

    await clickBack();
    await pickKind(/^Saga/);
    expect(preview().template).toBe("saga");
    await clickNext();
    expect(surface().dataset.artWindowAspect).toBe("0.4167");

    await clickBack();
    await pickKind(/^Planeswalker/);
    expect(preview().template).toBe("m15pw");
    await clickNext();
    // A new card is colourless: the see-through walker's ONE picture under
    // the whole frame (0.709), not the coloured masters' window (0.755).
    expect(surface().dataset.artWindowAspect).toBe("0.7089");

    await clickBack();
    await pickKind(/^Battle/);
    expect(preview().template).toBe("battle");
    await clickNext();
    expect(surface().dataset.artWindowAspect).toBe("1.3598");
  });

  it("a split card: each half's positioner is its own window", async () => {
    renderForm();
    await pickKind(/^Split/);
    expect(preview().template).toBe("split");
    await clickNext();
    await uploadArt(0);
    await uploadArt(1);
    // Left half 817 × 559, right half 816 × 559 on the 2100 × 1500 card.
    expect(surfaces().map((el) => el.dataset.artWindowAspect)).toEqual(["1.4618", "1.4600"]);
  });
});

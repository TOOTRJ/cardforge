// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { sampleWalkthroughPatch } from "@/lib/creator/frame-walkthrough-seed";
import type { CreatorFramePreview } from "@/lib/creator/frame-preview";

// ---------------------------------------------------------------------------
// The admin's walk through the stepper (TODO 2.1–2.3), driven through the
// real CardCreatorForm: the walk is prefilled through the import handler
// (second face included), lands on the frame + colour under test and starts
// on the Card step; its save is a frame preview (private, asks the server
// for the flag, title-only like a draft) and keeps preview mode across the
// create → edit hop; the AI dialog only ever sees the verified set.
// ---------------------------------------------------------------------------

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

const actions = vi.hoisted(() => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));

const aiDialog = vi.hoisted(() => ({ keys: null as readonly string[] | null }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ verifiedFrameKeys }: { verifiedFrameKeys: readonly string[] }) => {
    aiDialog.keys = verifiedFrameKeys;
    return null;
  },
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: {
    title?: string;
    frameStyle?: { template?: string };
    colorIdentity?: string[];
    backFace?: { title?: string } | null;
    supertype?: string | null;
    power?: string | null;
    toughness?: string | null;
  }) => (
    <div
      data-testid="card-preview"
      data-title={props.title ?? ""}
      data-template={props.frameStyle?.template ?? ""}
      data-colors={(props.colorIdentity ?? []).join(",")}
      data-back-title={props.backFace?.title ?? ""}
      data-supertype={props.supertype ?? ""}
      data-pt={props.power || props.toughness ? `${props.power ?? ""}/${props.toughness ?? ""}` : ""}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const PUBLISHED = ["m15", "m15land", "m15pw", "saga"].flatMap((t) =>
  EVERY_COLOUR.map((k) => frameComboKey(t, k)),
);
const ALL_KEYS = [
  ...PUBLISHED,
  ...["adventure", "battle", "split", "flip", "aftermath", "m15artifact", "m15token", "m15tokenartifact"].flatMap((t) =>
    EVERY_COLOUR.map((k) => frameComboKey(t, k)),
  ),
];

type FormProps = Parameters<typeof CardCreatorForm>[0];

function renderForm(framePreview: CreatorFramePreview | null, props: Partial<FormProps> = {}) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={framePreview ? ALL_KEYS : PUBLISHED}
      framePreview={framePreview}
      {...props}
    />,
  );
}

function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    title: el.dataset.title,
    template: el.dataset.template,
    colors: el.dataset.colors,
    backTitle: el.dataset.backTitle,
    supertype: el.dataset.supertype,
    pt: el.dataset.pt,
  };
}

const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;

const adventureWalk = (): CreatorFramePreview => ({
  param: "all",
  publishedKeys: PUBLISHED,
  walkthrough: {
    template: "adventure",
    colorKey: "g",
    kind: "adventure",
    note: "Walking adventure/g",
    seed: {
      patch: {
        title: "Beanstalk Giant",
        kind: "adventure",
        frame_template: "adventure",
        card_type: "creature",
        subtypes_text: "Giant",
        cost: "{6}{G}",
        color_identity: ["green"],
        power: "7",
        toughness: "7",
        rules_text: "Beanstalk Giant's power and toughness are each equal to the number of lands you control.",
        back_face: {
          title: "Fertile Footsteps",
          cost: "{2}{G}",
          card_type: "sorcery",
          subtypes_text: "Adventure",
          rules_text: "Search your library for a basic land card.",
        },
      },
      source: { name: "Beanstalk Giant", scryfallUri: null },
      fromReference: true,
    },
  },
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
  );
  aiDialog.keys = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
});

describe("walking the stepper (TODO 2.2)", () => {
  it("prefills from the seed — second face included — on the frame and colour under test", async () => {
    renderForm(adventureWalk());
    await waitFor(() => expect(preview().title).toBe("Beanstalk Giant"));
    expect(preview().template).toBe("adventure");
    expect(preview().colors).toBe("green");
    expect(preview().backTitle).toBe("Fertile Footsteps");
    // The walk starts on the Card step, like a user's.
    // (The rail marks the active step; the Card step's chips sit inside
    // collapsed sections once a kind is set, so they aren't the signal.)
    expect(document.querySelector('[aria-current="step"]')?.textContent?.trim()).toBe("Card");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("sample content for a combo with no printing goes through the same path", async () => {
    renderForm({
      param: "all",
      publishedKeys: PUBLISHED,
      walkthrough: {
        template: "battle",
        colorKey: "r",
        kind: "battle",
        note: "sample",
        seed: {
          patch: sampleWalkthroughPatch("battle", "r", "battle"),
          source: { name: "Sample content (no real printing)", scryfallUri: null },
          fromReference: false,
        },
      },
    });
    await waitFor(() => expect(preview().template).toBe("battle"));
    expect(preview().title).toBe("Sample Card");
    expect(preview().colors).toBe("red");
  });

  // TODO 4.49 resets the token ticks (owner decision 7): every colour is
  // re-verified in this walk, most of them on sample content (m15token/m and
  // m15tokenartifact w/b/r/g/m have no printing). The sample must be a
  // creature token of the frame's own type words, or the walk shows no P/T
  // plate (a word-less token has no P/T inputs) and the frame-follows-type
  // rule (3b.15) swaps m15tokenartifact for m15token under the admin.
  it.each([
    ["m15tokenartifact", "w", "Artifact Creature"],
    ["m15tokenartifact", "g", "Artifact Creature"],
    ["m15token", "m", "Creature"],
  ] as const)("a token sample walk stays on %s/%s and prints its P/T", async (template, colorKey, words) => {
    renderForm({
      param: "all",
      publishedKeys: PUBLISHED,
      walkthrough: {
        template,
        colorKey,
        kind: "token",
        note: "sample",
        seed: {
          patch: sampleWalkthroughPatch(template, colorKey, "token"),
          source: { name: "Sample content (no real printing)", scryfallUri: null },
          fromReference: false,
        },
      },
    });
    await waitFor(() => expect(preview().title).toBe("Sample Card"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(preview().template).toBe(template);
    expect(preview().supertype).toBe(words);
    expect(preview().pt).toBe("3/3");
  });

  it("the walk's save is a frame preview: title-only, private, asks for the flag, keeps the mode", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: "c1", slug: "beanstalk-giant" });
    renderForm(adventureWalk());
    await waitFor(() => expect(preview().title).toBe("Beanstalk Giant"));
    // No artwork, no draft tick: a preview is judged as a draft.
    expect(screen.getByTestId("frame-preview-save")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0];
    expect(payload.frame_preview).toBe(true);
    expect(payload.visibility).toBe("private");
    expect(payload.frame_style.template).toBe("adventure");
    expect(payload.back_face.title).toBe("Fertile Footsteps");
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const target = String(router.replace.mock.calls[0][0]);
    expect(target).toMatch(/^\/card\/beanstalk-giant\/edit\?/);
    expect(new URL(target, "https://x.test").searchParams.get("previewFrames")).toBe("all");
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/frame preview \(private\)/));
  });
});

describe("preview mode without a walk (TODO 2.1)", () => {
  it("the AI dialog keeps the verified set, never the previewed frames", () => {
    renderForm({ param: "all", publishedKeys: PUBLISHED, walkthrough: null });
    expect(aiDialog.keys).toEqual(PUBLISHED);
  });

  it("a save on a verified frame is an ordinary save — no flag asked", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: "c2", slug: "plain" });
    renderForm({ param: "all", publishedKeys: ALL_KEYS, walkthrough: null });
    expect(screen.queryByTestId("frame-preview-save")).toBeNull();
    // Title on Identity, then a draft save.
    const rail = screen.getByRole("navigation", { name: /card editor steps/i });
    await act(async () => {
      fireEvent.click(Array.from(rail.querySelectorAll("button")).find((b) => /identity/i.test(b.textContent ?? ""))!);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Emberbound Wyrm"), { target: { value: "Plain" } });
    });
    await act(async () => {
      fireEvent.click(Array.from(rail.querySelectorAll("button")).find((b) => /publish/i.test(b.textContent ?? ""))!);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect("frame_preview" in actions.createCardAction.mock.calls[0][0]).toBe(false);
  });

  it("outside preview mode nothing changes", () => {
    renderForm(null);
    expect(aiDialog.keys).toEqual(PUBLISHED);
    expect(screen.queryByTestId("frame-preview-save")).toBeNull();
  });

  it("editing a flagged preview card saves it as a draft (title is enough)", () => {
    const card = {
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: USER,
      title: "Walked",
      slug: "walked",
      game_system_id: GAME,
      cost: null,
      color_identity: ["red"],
      supertype: null,
      card_type: "battle",
      subtypes: ["Siege"],
      tags: [],
      rarity: "rare",
      rules_text: "When this enters, draw a card.",
      flavor_text: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: "5",
      artist_credit: null,
      art_url: null,
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: { finish: "regular", template: "battle" },
      visibility: "private",
      back_face: null,
      back_card_id: null,
      source_scryfall_id: null,
      set_icon_url: null,
      set_icon_code: null,
      face_content: null,
      watermark: null,
      footer_text: null,
      frame_preview: true,
      updated_at: "2026-09-28T10:00:00.000Z",
    } as unknown as Card;
    renderForm(null, { mode: "edit", card });
    expect(screen.getByTestId("frame-preview-save")).toBeTruthy();
  });
});

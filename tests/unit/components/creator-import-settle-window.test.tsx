// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FRAME_TEMPLATE_VALUES, type GameSystem } from "@/types/card";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";

// ---------------------------------------------------------------------------
// The creator's import settle window (TODO DK2.5, the review of #664): the
// baseline follows the import's OWN automatic steps, and nothing the maker
// does is ever absorbed into it — "Edited" is any change (owner 2026-10-29).
//
//   F1  a change that never passes through the form's own click / input /
//       change / keydown: a drag-pan of the art (pointer events, the click
//       only after), a Shift+wheel zoom with the focus outside the form, a
//       dropped picture, a pasted one (the uploader's window listener), the
//       "finished while you were away" AI fill toast's Apply and the import
//       notice's frame offer (both toasts, outside the form). The window
//       shuts on any user gesture anywhere on the page and in every writer
//       the maker sets off; a quiet spell shuts it too.
//   F2  a value set BEFORE an import that the import doesn't write (a
//       footer typed first) — the card isn't the import's; a paid maker's
//       own default footer is.
//   F3  "Fill from the printing" after an import that came without its
//       collector line: the printing's own line, so still the import's.
//
// Real CardCreatorForm, the deck pre-fill of Llanowar Elves DOM #168
// (harness: creator-import-unchanged-printings.test.tsx).
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() }));
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
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: actions.linkDeckCardAction }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
const notices = vi.hoisted(() => ({ list: [] as unknown[], onImport: null as null | ((p: unknown) => unknown) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: (props: { onImport: (p: unknown) => unknown }) => {
    notices.onImport = props.onImport;
    return null;
  },
  toastImportNotice: (notice: unknown) => {
    notices.list.push(notice);
  },
}));
const upload = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/cards/art-upload-client", () => ({ uploadCardArtFile: upload.fn }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { title?: string }) => <div data-testid="card-preview" data-title={props.title ?? ""} />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const ART = "https://example.supabase.co/storage/v1/object/public/card-art/u/imported.png";
const MINE = "https://example.supabase.co/storage/v1/object/public/card-art/u/mine.png";
const NARROW = ["m15", "m15artifact", "m15land", "m15pw", "m15token", "saga", "battle", "split", "aftermath", "adventure", "flip"].flatMap(
  (t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
);
const EVERYTHING = FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)));
const PRINTINGS = importPrintings as unknown as Record<string, unknown>;
const printing = (key: string): ScryfallCard => scryfallCardSchema.parse(structuredClone(PRINTINGS[key]));
const elves = () => printing("dom-168");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  notices.list = [];
  notices.onImport = null;
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions), upload.fn]) fn.mockReset();
});

type Patch = ReturnType<typeof mapScryfallToFormPatch>;

function patchOf(card: ScryfallCard, verified: readonly string[], edit?: (patch: Patch) => Patch): Patch {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card), new Set(verified));
  return JSON.parse(JSON.stringify(edit ? edit(patch) : patch));
}

function stubFetch(
  card: ScryfallCard,
  verified: readonly string[],
  options: { extra?: (url: string) => Response | null; edit?: (patch: Patch) => Patch } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const extra = options.extra?.(url);
      if (extra) return extra;
      if (url.startsWith("/api/scryfall/named")) {
        return new Response(JSON.stringify({ ok: true, card: { name: card.name, scryfall_uri: null }, patch: patchOf(card, verified, options.edit) }), {
          status: 200,
        });
      }
      if (url.startsWith("/api/scryfall/import-art")) return new Response(JSON.stringify({ ok: true, publicUrl: ART }), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "imported" });
  actions.linkDeckCardAction.mockResolvedValue({ ok: true });
}

function prefill(card: ScryfallCard, verified: readonly string[], options: Parameters<typeof stubFetch>[2] = {}) {
  stubFetch(card, verified, options);
  render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={[...verified]}
      deckRemix={{
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      }}
    />,
  );
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function landed() {
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  await settle();
}

async function saveAsDraft() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId("save-as-draft"));
  });
  await act(async () => {
    fireEvent.submit(screen.getByTestId("save-as-draft").closest("form")!);
  });
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
}

const artZone = () => {
  const zone = document.querySelector("[data-art-uploader]") as HTMLElement | null;
  expect(zone).toBeTruthy();
  return zone!;
};

describe("F1 — a change outside the form's own events reads Edited", () => {
  it("a drag-pan of the art (pointer events; the click only after)", { timeout: 30_000 }, async () => {
    const proto = window.HTMLImageElement.prototype;
    const restore = [
      ["naturalWidth", Object.getOwnPropertyDescriptor(proto, "naturalWidth")],
      ["naturalHeight", Object.getOwnPropertyDescriptor(proto, "naturalHeight")],
      ["complete", Object.getOwnPropertyDescriptor(proto, "complete")],
    ] as const;
    const el = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    const elRestore = [
      ["clientWidth", Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "clientWidth")],
      ["clientHeight", Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "clientHeight")],
    ] as const;
    Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(proto, "naturalHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
    Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 220 });
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    try {
      prefill(elves(), EVERYTHING);
      await landed();
      const zone = artZone();
      for (const img of Array.from(zone.querySelectorAll("img"))) {
        await act(async () => {
          fireEvent.load(img);
        });
      }
      await act(async () => {
        fireEvent.pointerDown(zone, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
        fireEvent.pointerMove(zone, { clientX: 140, clientY: 100, pointerId: 1 });
        fireEvent.pointerMove(zone, { clientX: 180, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(zone, { clientX: 180, clientY: 100, pointerId: 1 });
        fireEvent.click(zone);
      });
      const payload = await saveAsDraft();
      expect((payload.art_position as { focalX: number }).focalX).not.toBe(0.5);
      expect(payload.import_unchanged).toBe(false);
    } finally {
      for (const [key, descriptor] of restore) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[key];
      }
      for (const [key, descriptor] of elRestore) {
        if (descriptor) Object.defineProperty(window.HTMLElement.prototype, key, descriptor);
        else delete el[key];
      }
      delete el.setPointerCapture;
      delete el.releasePointerCapture;
    }
  });

  it("a Shift+wheel zoom, the focus outside the form", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    const zone = artZone();
    expect(document.activeElement?.closest("form")).toBeNull();
    await act(async () => {
      const wheel = new Event("wheel", { bubbles: true, cancelable: true });
      Object.defineProperties(wheel, { shiftKey: { value: true }, deltaY: { value: -100 }, deltaX: { value: 0 } });
      zone.dispatchEvent(wheel);
    });
    const payload = await saveAsDraft();
    expect((payload.art_position as { scale: number }).scale).toBeGreaterThan(1);
    expect(payload.import_unchanged).toBe(false);
  });

  it("a dropped picture", { timeout: 30_000 }, async () => {
    upload.fn.mockResolvedValue({ ok: true, publicUrl: MINE });
    prefill(elves(), EVERYTHING);
    await landed();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "mine.png", { type: "image/png" });
    await act(async () => {
      fireEvent.drop(artZone(), { dataTransfer: { files: [file], types: ["Files"] } });
    });
    await settle();
    const payload = await saveAsDraft();
    expect(payload.art_url).toBe(MINE);
    expect(payload.import_unchanged).toBe(false);
  });

  it("a pasted picture (the uploader's window listener, the focus outside the form)", { timeout: 30_000 }, async () => {
    upload.fn.mockResolvedValue({ ok: true, publicUrl: MINE });
    prefill(elves(), EVERYTHING);
    await landed();
    expect(document.activeElement?.closest("form")).toBeNull();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "mine.png", { type: "image/png" });
    await act(async () => {
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { items: [{ type: "image/png", getAsFile: () => file }] } });
      document.body.dispatchEvent(paste);
    });
    await settle();
    const payload = await saveAsDraft();
    expect(upload.fn).toHaveBeenCalled();
    expect(payload.art_url).toBe(MINE);
    expect(payload.import_unchanged).toBe(false);
  });

  it("the 'finished while you were away' AI fill toast's Apply (outside the form)", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING, {
      extra: (url) =>
        url.startsWith("/api/ai/card-fill?scope=")
          ? new Response(
              JSON.stringify({
                ok: true,
                fill: {
                  jobId: "77777777-7777-4777-8777-777777777777",
                  createdAt: "2026-10-29T00:00:00Z",
                  result: { title: "Elvish Hacker", flavor_text: "Hacked." },
                },
              }),
              { status: 200 },
            )
          : null,
    });
    await landed();
    const offer = toast.info.mock.calls.find((call) => String(call[0]).includes("while you were away"));
    expect(offer).toBeTruthy();
    await act(async () => {
      (offer![1] as { action: { onClick: () => void } }).action.onClick();
    });
    await settle();
    const payload = await saveAsDraft();
    expect(payload.title).toBe("Elvish Hacker");
    expect(payload.import_unchanged).toBe(false);
  });

  it("the import notice's frame offer (a toast action, outside the form)", { timeout: 30_000 }, async () => {
    // Sheoldred DMU #435 (borderless; Scryfall's art is cropped to the
    // bordered window): the deck pre-fill lands it on M15 and offers the
    // Borderless frame, published in black (creator-import-frame-choice).
    const sheoldred = scryfallCardSchema.parse(structuredClone((treatmentPrintings as Record<string, unknown>)["dmu-435"]));
    const verified = [...NARROW, ...FRAME_COLOR_KEYS.map((k) => frameComboKey("m15borderless", k))];
    prefill(sheoldred, verified);
    await landed();
    const notice = toast.info.mock.calls
      .map((call) => call[1] as { action?: { label: string; onClick: () => void } } | undefined)
      .find((options) => options?.action);
    expect(notice?.action?.label).toMatch(/Borderless/);
    await act(async () => {
      notice!.action!.onClick();
    });
    await settle();
    const payload = await saveAsDraft();
    expect((payload.frame_style as { template: string }).template).toBe("m15borderless");
    expect(payload.import_unchanged).toBe(false);
  });

  it("…while an untouched import, saved after the window's quiet spell, stays the import's", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING);
    await landed();
    await settle(700);
    const payload = await saveAsDraft();
    expect(payload.import_unchanged).toBe(true);
  });
});

describe("F2 — a value set before the import that the import doesn't write", () => {
  function renderPaid(footerText?: string) {
    render(
      <CardCreatorForm
        mode="create"
        userId={USER}
        ownerUsername="tester"
        gameSystems={GAME_SYSTEMS}
        aiConfigured
        isPaid
        defaultFooterText={footerText}
        verifiedFrameKeys={[...EVERYTHING]}
      />,
    );
  }

  async function dialogImport(card: ScryfallCard) {
    await act(async () => {
      notices.onImport!({ patch: patchOf(card, EVERYTHING), importedArtUrl: ART, source: { name: card.name, scryfallUri: null } });
    });
    await settle();
  }

  it("a footer typed first: not the import's", { timeout: 30_000 }, async () => {
    const card = elves();
    stubFetch(card, EVERYTHING);
    renderPaid();
    await act(async () => {
      fireEvent.click(screen.getAllByTitle("Go to Subscriber")[0]!);
    });
    const footer = screen.getByRole("textbox", { name: /Footer mark/ });
    await act(async () => {
      fireEvent.input(footer, { target: { value: "mine.art" } });
      fireEvent.change(footer, { target: { value: "mine.art" } });
    });
    await dialogImport(card);
    const payload = await saveAsDraft();
    expect(payload.footer_text).toBe("mine.art");
    expect(payload.import_unchanged).toBe(false);
  });

  it("a paid maker's OWN default footer (the prefill a new card starts with): still the import's", { timeout: 30_000 }, async () => {
    const card = elves();
    stubFetch(card, EVERYTHING);
    renderPaid("tester.art");
    await dialogImport(card);
    const payload = await saveAsDraft();
    expect(payload.footer_text).toBe("tester.art");
    expect(payload.import_unchanged).toBe(true);
  });

  it("an import over an untouched new card, and a second import over the first: the import's", { timeout: 30_000 }, async () => {
    const card = elves();
    stubFetch(card, EVERYTHING);
    renderPaid();
    await dialogImport(printing("m21-239"));
    await dialogImport(card);
    const payload = await saveAsDraft();
    expect(payload.source_scryfall_id).toBe(card.id);
    expect(payload.import_unchanged).toBe(true);
  });
});

describe("F3 — Fill from the printing after an import with no collector line", () => {
  // The route names the line only when it read the printing's set: this
  // import came without it.
  const withoutCollector = (patch: Patch): Patch => ({ ...patch, collector: undefined }) as Patch;

  async function fillFromPrinting() {
    await act(async () => {
      fireEvent.click(screen.getAllByTitle("Go to Set & collector info")[0]!);
    });
    // The button looks the same printing up again — this time with its line.
    stubFetch(elves(), EVERYTHING, {
      extra: (url) =>
        url.startsWith("/api/scryfall/named")
          ? new Response(JSON.stringify({ ok: true, patch: { collector: { set_code: "DOM", collector_number: "168", lang: "en" } } }), {
              status: 200,
            })
          : null,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fill from the printing" }));
    });
    await waitFor(() => expect((document.querySelector('[name="collector_number"]') as HTMLInputElement).value).not.toBe(""));
  }

  it("the printing's own line on an untouched import: still the import's", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING, { edit: withoutCollector });
    await landed();
    await fillFromPrinting();
    const payload = await saveAsDraft();
    expect(payload.collector_number).toBeTruthy();
    expect(payload.import_unchanged).toBe(true);
  });

  it("an import changed first stays changed", { timeout: 30_000 }, async () => {
    prefill(elves(), EVERYTHING, { edit: withoutCollector });
    await landed();
    const title = screen.getByPlaceholderText("Emberbound Wyrm") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(title, { target: { value: "Llanowar Elder" } });
    });
    await fillFromPrinting();
    const payload = await saveAsDraft();
    expect(payload.import_unchanged).toBe(false);
  });
});

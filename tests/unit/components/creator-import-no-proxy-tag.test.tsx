// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { json, namedBody } from "./scryfall-import-stubs";

// ---------------------------------------------------------------------------
// TODO DK2.4 (owner 2026-10-28): an import no longer tags the card "proxy".
// Every card made on PipGlyph is a proxy (components/creator/card-glossary
// .tsx), and the tag was never taken off when the card changed, so it said
// nothing. The maker's own tags stay exactly as they are. Driven through the
// real CardCreatorForm with the import dialog stubbed, as in
// creator-import-frame-choice.test.tsx.
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
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));

const importer = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: ({ onImport }: { onImport: (payload: unknown) => unknown }) => (
    <button type="button" onClick={() => onImport(importer.payload)}>
      test: import
    </button>
  ),
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15artifact", "m15land", "m15pw", "m15token", "m15borderless"].flatMap((t) =>
  ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)),
);

function renderForm() {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
    />,
  );
}

/** Sheoldred, the Apocalypse (DMU #435), as the dialog hands it over. */
async function importSheoldred() {
  const named = namedBody("dmu-435", new Set(VERIFIED));
  importer.payload = {
    patch: named.patch,
    importedArtUrl: null,
    source: { name: named.card.name, scryfallUri: null },
    frameChoice: { template: "m15" },
  };
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "test: import" }));
  });
}

async function goToPublish() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}

const tagsInput = () => document.querySelector<HTMLInputElement>('input[name="tags_text"]')!;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ok: false })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router)]) fn.mockReset();
  importer.payload = null;
});

describe("an import adds no tag (TODO DK2.4)", () => {
  it("a card started from a real card is not tagged “proxy”", async () => {
    renderForm();
    await importSheoldred();
    await goToPublish();
    // Only what the card's own words suggest (lib/cards/auto-tags.ts, owner
    // 2026-10-30: the stub's Phyrexian Praetor) — never "proxy".
    expect(tagsInput().value).toBe("phyrexians");
  });

  it("the maker's own tags stay as they are, “proxy” included", async () => {
    renderForm();
    await goToPublish();
    await act(async () => {
      fireEvent.change(tagsInput(), { target: { value: "dragons, proxy" } });
    });
    await importSheoldred();
    await goToPublish();
    expect(tagsInput().value).toBe("dragons, proxy");
  });
});

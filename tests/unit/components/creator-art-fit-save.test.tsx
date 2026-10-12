// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 3b.18's promise to stored cards, through the REAL CardCreatorForm and
// the REAL updateCardAction (only the database is a stub): opening an old
// card and saving it without touching the art writes the art numbers it
// had — a hand-set position, a centred one, and a row stored with no
// position at all. The automatic fit never re-frames a stored card.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({ existing: null as unknown, client: null as unknown }));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/card/kesh/edit",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
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
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

// The real action's surroundings (as tests/unit/cards/rebake-pending-save.test.ts).
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: false, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn(async () => null) }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "saga"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)));

function stored(art_position: unknown, frame = "saga"): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "The Long Night",
    slug: "the-long-night",
    game_system_id: GAME,
    cost: "{2}{W}",
    color_identity: ["white"],
    supertype: null,
    card_type: frame === "saga" ? "enchantment" : "creature",
    subtypes: frame === "saga" ? ["Saga"] : [],
    tags: [],
    rarity: "rare",
    rules_text: "I — Draw a card.",
    flavor_text: null,
    power: frame === "saga" ? null : "2",
    toughness: frame === "saga" ? null : "2",
    loyalty: null,
    defense: null,
    artist_credit: "A. Painter",
    art_url: "https://example.com/panorama.png",
    art_position,
    frame_style: { finish: "regular", template: frame },
    visibility: "private",
    back_face: null,
    back_card_id: null,
    frame_preview: false,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    rendered_image_url: null,
    rendered_thumb_url: null,
    rendered_back_image_url: null,
    rendered_back_thumb_url: null,
    rendered_at: null,
    layout_version: null,
    updated_at: "2026-09-29T10:00:00.000Z",
  } as unknown as Card;
}

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) return { data: { id: CARD_ID, slug: "the-long-night" }, error: null };
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}
const writesOf = (stub: ReturnType<typeof db>) =>
  stub
    .forTable("cards")
    .filter((e) => called(e.calls, "update"))
    .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);

async function openEditAndSave(card: Card) {
  state.existing = card;
  const stub = db();
  render(
    <CardCreatorForm
      mode="edit"
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
    />,
  );
  // An ordinary edit that is not the art: the title.
  await act(async () => {
    fireEvent.change(screen.getByDisplayValue("The Long Night"), { target: { value: "The Longer Night" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  });
  await waitFor(() => expect(writesOf(stub).length).toBe(1));
  return writesOf(stub)[0];
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saving an old card without touching the art", () => {
  it.each([
    ["a hand-set position on a saga", { focalX: 0.2143, focalY: 0.8312, scale: 1.35 }, "saga"],
    ["a hand-set zoom under 100 %", { focalX: 0.5, focalY: 0.5, scale: 0.7 }, "saga"],
    ["a hand-set position on m15", { focalX: 0, focalY: 1, scale: 4 }, "m15"],
    ["the centred default", { focalX: 0.5, focalY: 0.5, scale: 1 }, "saga"],
    ["a row stored with no position", {}, "m15"],
  ])("%s is written back exactly as stored", async (_name, position, frame) => {
    const write = await openEditAndSave(stored(position, frame as string));
    expect(write.title).toBe("The Longer Night");
    expect(write.art_position).toEqual(position);
  });
});

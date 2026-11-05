// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { guestAuthHref, type GuestDraft } from "@/lib/creator/guest-draft";

// ---------------------------------------------------------------------------
// TODO HM3 through the REAL CardCreatorForm: a signed-out visitor edits the
// card (no inert panels, no gate over them), the card is written to the
// browser as it changes, Save and the AI buttons open the sign-up dialog
// (never the save action), and the signed-in creator puts the card back —
// its kept picture uploaded through the normal art upload — and saves it
// through the same createCardAction, which then forgets the draft. A remix
// or an edit never restores one.
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
const funnel = vi.hoisted(() => ({ trackFunnelEvent: vi.fn(), postFunnelEvent: vi.fn() }));
vi.mock("@/lib/analytics/funnel-client", () => funnel);
const uploads = vi.hoisted(() => ({ uploadCardArtFile: vi.fn() }));
vi.mock("@/lib/cards/art-upload-client", () => uploads);
vi.mock("@/lib/cards/upload-watermark-server", () => ({ uploadWatermarkServerAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="ai-fill-dialog" /> : null),
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
const preview = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: Record<string, unknown>) => {
    preview.last = props;
    return <div data-testid="card-preview" />;
  },
}));
// The kept card, as the browser would hand it back: a stand-in store (the
// storage itself is tests/unit/creator/guest-draft.test.ts).
const kept = vi.hoisted(() => ({
  draft: null as GuestDraft | null,
  writes: [] as GuestDraft[],
  cleared: 0,
}));
vi.mock("@/lib/creator/guest-draft", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/creator/guest-draft")>();
  return {
    ...real,
    createGuestDraftStore: () => ({
      read: async () => kept.draft,
      write: async (draft: GuestDraft) => {
        kept.writes.push(draft);
        kept.draft = draft;
        return "kept" as const;
      },
      clear: async () => {
        kept.cleared += 1;
        kept.draft = null;
      },
    }),
  };
});

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey("m15", k));
const STORED_ART = `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/kept.png`;

beforeEach(() => {
  window.history.replaceState({}, "", "/create?step=identity");
  kept.draft = null;
  kept.writes = [];
  kept.cleared = 0;
  preview.last = null;
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "card-1", slug: "ember-wyrm" });
  // The signed-in creator's own reads (capacity, pips…) answer nothing.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions), ...Object.values(funnel), ...Object.values(uploads)]) {
    fn.mockReset();
  }
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const title = () => screen.getByLabelText("Title", { exact: false, selector: "input" }) as HTMLInputElement;

function guest() {
  return render(
    <CardCreatorForm mode="create" userId={null} gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} guestDraft="guest" />,
  );
}

function signedIn(role: "restore" | null = "restore") {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      guestDraft={role}
    />,
  );
}

describe("the guest creator (HM3)", () => {
  it("is editable: no sign-up gate over the panels, nothing inert", async () => {
    const { container } = guest();
    expect(screen.queryByTestId("guest-gate")).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
    });
    expect(title().value).toBe("Ember Wyrm");
  });

  it("writes the card to the browser as it changes", async () => {
    guest();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
    });
    await waitFor(() => expect(kept.writes.at(-1)?.values.title).toBe("Ember Wyrm"), { timeout: 3000 });
  });

  it("Save asks for an account, never saves, and the card is written first", async () => {
    guest();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
    });
    await click(screen.getByTestId("guest-save"));
    const gate = await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "save" });
    expect(kept.writes.at(-1)?.values.title).toBe("Ember Wyrm");
    const signup = Array.from(gate.querySelectorAll("a")).find((a) => a.textContent?.includes("Create a free account"));
    expect(signup?.getAttribute("href")).toBe(guestAuthHref("signup"));
    const login = Array.from(gate.querySelectorAll("a")).find((a) => a.textContent?.includes("Sign in"));
    expect(login?.getAttribute("href")).toBe(guestAuthHref("login"));
    expect(actions.createCardAction).not.toHaveBeenCalled();
  });

  it("an AI button opens the same dialog, never the AI", async () => {
    guest();
    await click(screen.getByRole("button", { name: /Generate AI artwork and title/ }));
    await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "ai" });
    expect(screen.queryByTestId("ai-fill-dialog")).toBeNull();
  });

  it("keeps a picked picture in the browser — the preview draws it, nothing uploads", async () => {
    const createObjectURL = vi.fn(() => "blob:https://pipglyph.test/picked");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const { container } = guest();
    const input = container.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement;
    const file = new File(["png-bytes"], "wyrm.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(preview.last?.artUrl).toBe("blob:https://pipglyph.test/picked"));
    expect(preview.last?.localPictureUrls).toEqual(["blob:https://pipglyph.test/picked"]);
    expect(uploads.uploadCardArtFile).not.toHaveBeenCalled();
    await waitFor(() => expect(kept.writes.at(-1)?.pictures.map((p) => p.path)).toEqual(["art_url"]), { timeout: 3000 });
  });
});

// A draft as this version of the guest creator writes it: the form's own values.
async function guestWrittenDraft(): Promise<GuestDraft> {
  guest();
  await act(async () => {
    fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
  });
  await waitFor(() => expect(kept.writes.at(-1)?.values.title).toBe("Ember Wyrm"), { timeout: 3000 });
  cleanup();
  kept.writes = [];
  return kept.draft!;
}

describe("the signed-in creator puts a guest's card back (HM3)", () => {
  const draft = (extra: Partial<GuestDraft> = {}): GuestDraft => ({
    values: {
      ...({} as GuestDraft["values"]),
      title: "Ember Wyrm",
      card_type: "creature",
      cost: "{3}{R}",
      color_identity: ["red"],
      rules_text: "Flying",
      power: "4",
      toughness: "4",
      rarity: "rare",
      artist_credit: "A. Guest",
      art_url: STORED_ART,
      art_position: { x: 0.5, y: 0.5, scale: 1 },
      tags_text: "dragons",
      visibility: "public",
      frame_style: { template: "m15", finish: "regular" },
    } as GuestDraft["values"],
    pictures: [],
    tags: { following: false, base: [] },
    ...extra,
  });

  it("restores it, says so, and saves it through createCardAction — then forgets it", async () => {
    // A draft written by this version of the creator: the guest form's own values.
    guest();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
    });
    await waitFor(() => expect(kept.writes.at(-1)?.values.title).toBe("Ember Wyrm"), { timeout: 3000 });
    cleanup();
    kept.draft = { ...kept.writes.at(-1)!, values: { ...kept.writes.at(-1)!.values, art_url: STORED_ART } };

    signedIn();
    await waitFor(() => expect(title().value).toBe("Ember Wyrm"));
    expect(screen.getByTestId("guest-draft-restored").textContent).toMatch(/Your card is back/);
    const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    await waitFor(() => expect(save().disabled).toBe(false));
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const [payload, options] = actions.createCardAction.mock.calls[0]!;
    expect((payload as { title: string }).title).toBe("Ember Wyrm");
    expect(options).toEqual({ guestDraft: true });
    await waitFor(() => expect(kept.cleared).toBeGreaterThan(0));
  });

  it("uploads a kept picture through the normal art upload before Save can run", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:https://pipglyph.test/restored") }));
    let finish: (value: unknown) => void = () => {};
    uploads.uploadCardArtFile.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const written = await guestWrittenDraft();
    kept.draft = draft({
      values: { ...written.values, art_url: "blob:https://pipglyph.test/old-page" },
      pictures: [{ path: "art_url", blob: new Blob(["png"], { type: "image/png" }), name: "wyrm.png" }],
    });
    signedIn();
    await waitFor(() => expect(uploads.uploadCardArtFile).toHaveBeenCalledTimes(1));
    const sent = uploads.uploadCardArtFile.mock.calls[0]![0] as File;
    expect(sent.name).toBe("wyrm.png");
    expect(sent.type).toBe("image/png");
    // Waiting for the upload: Save says why and stays off.
    const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/Your picture is uploading to your account/)).toBeTruthy();
    await act(async () => {
      finish({ ok: true, publicUrl: STORED_ART });
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect((actions.createCardAction.mock.calls[0]![0] as { art_url: string }).art_url).toBe(STORED_ART);
  });

  it("a failed upload keeps the picture and offers a retry", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:https://pipglyph.test/restored") }));
    uploads.uploadCardArtFile.mockResolvedValue({ ok: false, error: "You're uploading too fast." });
    const written = await guestWrittenDraft();
    kept.draft = draft({
      values: { ...written.values, art_url: "blob:https://pipglyph.test/old-page" },
      pictures: [{ path: "art_url", blob: new Blob(["png"], { type: "image/png" }), name: "wyrm.png" }],
    });
    signedIn();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You're uploading too fast."));
    expect(screen.getByRole("button", { name: /Retry the upload/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);
    uploads.uploadCardArtFile.mockResolvedValue({ ok: true, publicUrl: STORED_ART });
    await click(screen.getByRole("button", { name: /Retry the upload/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("never restores outside a plain new card", async () => {
    kept.draft = draft();
    signedIn(null);
    await act(async () => {});
    expect(title().value).toBe("");
    expect(screen.queryByTestId("guest-draft-restored")).toBeNull();
    expect(kept.cleared).toBe(0);
  });
});

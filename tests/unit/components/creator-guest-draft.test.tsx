// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
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
// The kept card, as the browser would hand it back: the REAL store over one
// in-memory record (the storage itself is tests/unit/creator/guest-draft.test.ts),
// so its rules hold here — a claimed draft is offered to no one else, and a
// guarded write or clear goes over the record a tab expects only.
// `kept.draft` is the stored draft (a test may seed it), `kept.writes` the
// drafts written (a claim is not a write), `kept.cleared` the removals.
const kept = vi.hoisted(() => ({
  draft: null as GuestDraft | null,
  rev: null as string | null,
  writes: [] as GuestDraft[],
  cleared: 0,
  // The same browser's store, as another tab would open it.
  otherTab: null as null | (() => import("@/lib/creator/guest-draft").GuestDraftStore),
}));
vi.mock("@/lib/creator/guest-draft", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/creator/guest-draft")>();
  const backend: import("@/lib/creator/guest-draft").GuestDraftBackend = {
    keepsPictures: true,
    get: async () =>
      kept.draft ? { ...kept.draft, v: real.GUEST_DRAFT_VERSION, savedAt: Date.now() - 1, rev: kept.rev } : null,
    put: async (record) => {
      const { rev, ...rest } = record;
      const draft: GuestDraft = { values: rest.values, pictures: rest.pictures, tags: rest.tags, base: rest.base, claimedBy: rest.claimedBy };
      if (!(kept.draft && draft.claimedBy && rev === kept.rev)) kept.writes.push(draft);
      kept.draft = draft;
      kept.rev = rev ?? null;
    },
    delete: async () => {
      kept.cleared += 1;
      kept.draft = null;
      kept.rev = null;
    },
  };
  const store = () => real.createGuestDraftStore({ backends: () => [backend] });
  kept.otherTab = store;
  return { ...real, createGuestDraftStore: store };
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
  kept.rev = null;
  kept.writes = [];
  kept.cleared = 0;
  preview.last = null;
  try {
    window.sessionStorage.clear();
  } catch {
    // no session storage here
  }
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
async function guestWrittenDraft(name = "Ember Wyrm"): Promise<GuestDraft> {
  guest();
  await act(async () => {
    fireEvent.change(title(), { target: { value: name } });
  });
  await waitFor(() => expect(kept.writes.at(-1)?.values.title).toBe(name), { timeout: 3000 });
  cleanup();
  kept.writes = [];
  return kept.draft!;
}

const picture = () => ({ path: "art_url", blob: new Blob(["png"], { type: "image/png" }), name: "wyrm.png" });
const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;

// A guest's card with its picture kept, written by the guest creator.
async function draftWithPicture(): Promise<GuestDraft> {
  const written = await guestWrittenDraft();
  return {
    ...written,
    values: { ...written.values, art_url: "blob:https://pipglyph.test/old-page" },
    pictures: [picture()],
  };
}

describe("the signed-in creator puts a guest's card back (HM3)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:https://pipglyph.test/restored"), revokeObjectURL: vi.fn() }));
    uploads.uploadCardArtFile.mockResolvedValue({ ok: true, publicUrl: STORED_ART });
  });

  it("restores it, claims it, saves it through createCardAction — then forgets it", async () => {
    kept.draft = await draftWithPicture();
    signedIn();
    await waitFor(() => expect(title().value).toBe("Ember Wyrm"));
    expect(kept.draft?.claimedBy).toBe(USER);
    await waitFor(() => expect(screen.getByTestId("guest-draft-restored").textContent).toMatch(/Your card is back/));
    await waitFor(() => expect(save().disabled).toBe(false));
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const [payload, options] = actions.createCardAction.mock.calls[0]!;
    expect((payload as { title: string }).title).toBe("Ember Wyrm");
    expect((payload as { art_url: string }).art_url).toBe(STORED_ART);
    expect(options).toEqual({ guestDraft: true });
    await waitFor(() => expect(kept.cleared).toBeGreaterThan(0));
    // Saved: no longer "a guest's card" — a second save carries no guestDraft.
    await waitFor(() => expect(screen.queryByTestId("guest-draft-restored")).toBeNull());
  });

  it("never writes the draft once signed in — not the account's URLs, not a deck", async () => {
    kept.draft = await draftWithPicture();
    signedIn();
    await waitFor(() => expect(uploads.uploadCardArtFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save().disabled).toBe(false));
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm, Renamed" } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(kept.writes).toEqual([]);
    // The stored draft still holds the guest's picture, never the upload.
    expect(kept.draft?.values.art_url).toBe("blob:https://pipglyph.test/old-page");
  });

  it("puts back no storage URL and no deck a draft names", async () => {
    const written = await guestWrittenDraft();
    // A record written before the rules, or by hand: another account's art and deck.
    kept.draft = {
      ...written,
      values: { ...written.values, art_url: "https://x.supabase.co/storage/v1/object/public/card-art/user-a/a.png", deck_id: "deck-a" },
    };
    signedIn();
    await waitFor(() => expect(title().value).toBe("Ember Wyrm"));
    expect(preview.last?.artUrl ?? null).toBeNull();
    expect(uploads.uploadCardArtFile).not.toHaveBeenCalled();
  });

  it("a field the guest never set takes this viewer's default; a challenge's tag survives", async () => {
    const written = await draftWithPicture();
    // The guest's own tags, and tags still following the card's text.
    const cases = [
      { tags: { following: false, base: [] }, tags_text: "dragons", want: ["dragons", "weekly-challenge"] },
      { tags: { following: true, base: [] }, tags_text: "", want: ["weekly-challenge"] },
    ];
    for (const c of cases) {
      kept.draft = { ...written, tags: c.tags, values: { ...written.values, tags_text: c.tags_text } };
      actions.createCardAction.mockClear();
      window.history.replaceState({}, "", "/create?step=identity");
      render(
        <CardCreatorForm
          mode="create"
          userId={USER}
          ownerUsername="tester"
          gameSystems={GAME_SYSTEMS}
          aiConfigured
          verifiedFrameKeys={VERIFIED}
          guestDraft="restore"
          isPaid
          defaultFooterText="Made by Kesh"
          defaultArtistCredit="Kesh"
          initialTag="weekly-challenge"
        />,
      );
      await waitFor(() => expect(title().value).toBe("Ember Wyrm"));
      // The save's payload: the paid viewer's footer (never the guest's ""),
      // their artist credit, the challenge's tag.
      await waitFor(() => expect(save().disabled).toBe(false));
      await click(save());
      await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
      const payload = actions.createCardAction.mock.calls[0]![0] as { footer_text: string; artist_credit: string; tags: string[] };
      expect(payload.footer_text).toBe("Made by Kesh");
      expect(payload.artist_credit).toBe("Kesh");
      expect(payload.tags).toEqual(expect.arrayContaining(c.want));
      cleanup();
    }
  });

  it("a refused save keeps the card waiting — a failure, and the card limit", async () => {
    kept.draft = await draftWithPicture();
    actions.createCardAction.mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    signedIn();
    await waitFor(() => expect(save().disabled).toBe(false));
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    actions.createCardAction.mockResolvedValueOnce({ ok: false, error: "You've reached your card limit.", code: "CARD_CAPACITY" });
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(2));
    expect(actions.createCardAction.mock.calls[1]![1]).toEqual({ guestDraft: true });
    expect(kept.cleared).toBe(0);
    expect(kept.draft?.values.title).toBe("Ember Wyrm");
    expect(screen.getByTestId("guest-draft-restored")).toBeTruthy();
  });

  it("uploads a kept picture through the normal art upload before Save can run", async () => {
    let finish: (value: unknown) => void = () => {};
    uploads.uploadCardArtFile.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    kept.draft = await draftWithPicture();
    signedIn();
    await waitFor(() => expect(uploads.uploadCardArtFile).toHaveBeenCalledTimes(1));
    const sent = uploads.uploadCardArtFile.mock.calls[0]![0] as File;
    expect(sent.name).toBe("wyrm.png");
    expect(sent.type).toBe("image/png");
    // Waiting for the upload: Save says why and stays off.
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/Your picture is uploading to your account/)).toBeTruthy();
    await act(async () => {
      finish({ ok: true, publicUrl: STORED_ART });
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    // The page's copy of the picture is freed once it is uploaded.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://pipglyph.test/restored");
    await click(save());
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect((actions.createCardAction.mock.calls[0]![0] as { art_url: string }).art_url).toBe(STORED_ART);
  });

  it("a failed upload keeps the picture and offers a retry", async () => {
    uploads.uploadCardArtFile.mockResolvedValue({ ok: false, error: "You're uploading too fast." });
    kept.draft = await draftWithPicture();
    signedIn();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You're uploading too fast."));
    await screen.findByRole("button", { name: /Retry the upload/ });
    expect(save().disabled).toBe(true);
    uploads.uploadCardArtFile.mockResolvedValue({ ok: true, publicUrl: STORED_ART });
    await click(screen.getByRole("button", { name: /Retry the upload/ }));
    await waitFor(() => expect(save().disabled).toBe(false));
    expect(uploads.uploadCardArtFile).toHaveBeenCalledTimes(2);
  });
});

describe("a guest's card follows the person, not the browser (HM3)", () => {
  it("another account is never offered a claimed card, and it is removed", async () => {
    const written = await guestWrittenDraft();
    kept.draft = { ...written, claimedBy: "someone-else" };
    signedIn();
    await act(async () => {});
    await act(async () => {});
    expect(title().value).toBe("");
    expect(screen.queryByTestId("guest-draft-restored")).toBeNull();
    expect(kept.draft).toBeNull();
  });

  it("a later guest on this browser is never offered it", async () => {
    const written = await guestWrittenDraft();
    kept.draft = { ...written, claimedBy: USER };
    guest();
    await act(async () => {});
    await act(async () => {});
    expect(title().value).toBe("");
    expect(screen.queryByTestId("guest-draft-restored")).toBeNull();
  });

  it("an edit and a remix never restore one, nor touch it", async () => {
    const written = await guestWrittenDraft();
    kept.draft = written;
    const card = {
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: USER,
      title: "Kesh, Emberforge Warden",
      slug: "kesh",
      game_system_id: GAME,
      cost: "{2}{R}{R}",
      color_identity: ["red"],
      supertype: "Legendary",
      card_type: "creature",
      subtypes: ["Dwarf"],
      tags: [],
      rarity: "rare",
      rules_text: "Haste",
      flavor_text: null,
      power: "3",
      toughness: "4",
      loyalty: null,
      defense: null,
      artist_credit: null,
      art_url: "https://example.com/art.png",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: { finish: "regular", template: "m15" },
      visibility: "public",
      back_face: null,
      back_card_id: null,
      source_scryfall_id: null,
      set_icon_url: null,
      set_icon_code: null,
      face_content: null,
      watermark: null,
      footer_text: null,
      updated_at: "2026-09-29T10:00:00.000Z",
    } as unknown as Card;
    for (const mode of ["edit", "remix"] as const) {
      window.history.replaceState({}, "", "/create?step=identity");
      render(
        <CardCreatorForm
          mode={mode}
          card={card}
          userId={USER}
          ownerUsername="tester"
          gameSystems={GAME_SYSTEMS}
          aiConfigured
          verifiedFrameKeys={VERIFIED}
          guestDraft="restore"
        />,
      );
      await act(async () => {});
      await act(async () => {});
      expect(title().value).toMatch(/^Kesh, Emberforge Warden/);
      expect(screen.queryByTestId("guest-draft-restored")).toBeNull();
      cleanup();
    }
    expect(kept.draft).toBe(written);
    expect(kept.cleared).toBe(0);
  });
});

// Leaving the page or switching away flushes the guest's card at once.
async function leaveTab() {
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else delete (document as { visibilityState?: unknown }).visibilityState;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const rest = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 700));
  });

describe("a guest tab left open never brings the card back (HM3)", () => {
  // The guest's tab (A) wrote the card; the maker signed up in another tab.
  async function guestTab() {
    guest();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm" } });
    });
    await waitFor(() => expect(kept.writes.at(-1)?.values.title).toBe("Ember Wyrm"), { timeout: 3000 });
  }

  it("the card was saved in the other tab: switching back, closing, even typing writes nothing", async () => {
    await guestTab();
    const writes = kept.writes.length;
    // Tab B, signed in: puts it back (claims it) and saves it (clears it).
    const other = kept.otherTab!();
    expect((await other.read(USER))?.values.title).toBe("Ember Wyrm");
    await other.claim(USER);
    await other.clear();
    expect(kept.draft).toBeNull();
    // Back in tab A.
    await leaveTab();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm II" } });
    });
    await rest();
    cleanup();
    expect(kept.writes.length).toBe(writes);
    expect(kept.draft).toBeNull();
    // The next /create — a guest, or another account — finds nothing.
    expect(await kept.otherTab!().read(null)).toBeNull();
    expect(await kept.otherTab!().read("another-user")).toBeNull();
  });

  it("the card was claimed in the other tab: the guest tab never takes it back unclaimed", async () => {
    await guestTab();
    const other = kept.otherTab!();
    await other.read(USER);
    await other.claim(USER);
    await leaveTab();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm II" } });
    });
    await rest();
    cleanup();
    expect(kept.draft?.claimedBy).toBe(USER);
    expect(kept.draft?.values.title).toBe("Ember Wyrm");
    expect(await kept.otherTab!().read(null)).toBeNull();
  });

  it("another guest tab wrote a newer card: the old tab never replaces it", async () => {
    await guestTab();
    const newer = { ...kept.draft!, values: { ...kept.draft!.values, title: "Newer Wyrm" } };
    await kept.otherTab!().write(newer);
    await leaveTab();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm II" } });
    });
    await rest();
    cleanup();
    expect(kept.draft?.values.title).toBe("Newer Wyrm");
  });

  it("leaving the page with nothing changed writes nothing", async () => {
    await guestTab();
    await rest();
    const writes = kept.writes.length;
    await leaveTab();
    cleanup();
    expect(kept.writes.length).toBe(writes);
  });

  it("the card's own tab carries on writing — Start over clears only its own card", async () => {
    await guestTab();
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm II" } });
    });
    await waitFor(() => expect(kept.draft?.values.title).toBe("Ember Wyrm II"), { timeout: 3000 });
    cleanup();
    // Reloaded: "Welcome back", and it carries on over the card it put back.
    guest();
    await waitFor(() => expect(title().value).toBe("Ember Wyrm II"));
    await act(async () => {
      fireEvent.change(title(), { target: { value: "Ember Wyrm III" } });
    });
    await waitFor(() => expect(kept.draft?.values.title).toBe("Ember Wyrm III"), { timeout: 3000 });
  });
});

describe("a guest's pictures (HM3)", () => {
  it("a replaced picture is let go at once", async () => {
    let n = 0;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => `blob:https://pipglyph.test/p${++n}`), revokeObjectURL }));
    const { container } = guest();
    const input = () => container.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement;
    for (const name of ["one.png", "two.png"]) {
      await act(async () => {
        fireEvent.change(input(), { target: { files: [new File(["png"], name, { type: "image/png" })] } });
      });
      await waitFor(() => expect(preview.last?.artUrl).toBe(`blob:https://pipglyph.test/p${n}`));
    }
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://pipglyph.test/p1"), { timeout: 3000 });
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:https://pipglyph.test/p2");
  });

  it("a restored picture uploads once: a second visit before Save reuses it", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:https://pipglyph.test/restored"), revokeObjectURL: vi.fn() }));
    uploads.uploadCardArtFile.mockResolvedValue({ ok: true, publicUrl: STORED_ART });
    kept.draft = await draftWithPicture();
    for (let visit = 0; visit < 2; visit += 1) {
      signedIn();
      await waitFor(() => expect(save().disabled).toBe(false));
      expect(preview.last?.artUrl).toBe(STORED_ART);
      cleanup();
    }
    expect(uploads.uploadCardArtFile).toHaveBeenCalledTimes(1);
  });
});

describe("the guest creator's account-only controls open the sign-up dialog (HM3)", () => {
  it("real-card art", async () => {
    guest();
    const button = screen.getByTestId("real-card-art-front");
    expect(button.hasAttribute("disabled")).toBe(false);
    await click(button);
    await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "real-card-art" });
  });

  it("custom pips", async () => {
    window.history.replaceState({}, "", "/create?step=text");
    guest();
    await click(screen.getByRole("button", { name: "Customize pips" }));
    await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "pips" });
  });

  it("a set icon upload", async () => {
    window.history.replaceState({}, "", "/create?step=seticon");
    guest();
    const button = screen.getByRole("button", { name: "Upload your own" });
    expect(button.hasAttribute("disabled")).toBe(false);
    await click(button);
    await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "set-icon" });
  });

  it("a Scryfall import (the command palette's event)", async () => {
    guest();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("cardforge:open-scryfall"));
    });
    await screen.findByTestId("guest-save-gate");
    expect(funnel.trackFunnelEvent).toHaveBeenCalledWith("guest_save_gate", { reason: "import" });
  });
});

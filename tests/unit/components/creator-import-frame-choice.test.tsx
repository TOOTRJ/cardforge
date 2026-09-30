// @vitest-environment happy-dom
import type { ReactNode } from "react";
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
import { card, json, namedBody } from "./scryfall-import-stubs";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import anatomyPrintings from "../scryfall/fixtures/anatomy-printings.json";

// ---------------------------------------------------------------------------
// The creator's side of TODO 1.5 / 1.18, through the real CardCreatorForm:
// the dialog's frame choice lands after the kind change (re-checked; a stale
// pick falls back to the usual resolution), the Card step shows "Frame
// substituted (imported …)" while the card sits on a frame that isn't the
// printing's own (cleared by a frame or kind pick), the Identity step notes
// Scryfall's cropped art, and the deck-remix pre-fill (no dialog) toasts ONE
// substitution notice. The import dialog is a stub that hands the form a
// payload built by the real mapper.
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

// The import dialog: a button that hands the form the payload the test set,
// and a record of what the form passed it.
const importer = vi.hoisted(() => ({
  payload: null as unknown,
  currentFrameTemplate: undefined as string | null | undefined,
}));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: ({
    onImport,
    currentFrameTemplate,
  }: {
    onImport: (payload: unknown) => unknown;
    currentFrameTemplate?: string | null;
  }) => {
    importer.currentFrameTemplate = currentFrameTemplate;
    return (
      <button type="button" onClick={() => onImport(importer.payload)}>
        test: import
      </button>
    );
  },
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { frameStyle?: { template?: string; crown?: boolean; twoColor?: boolean } }) => (
    <div
      data-testid="card-preview"
      data-template={props.frameStyle?.template ?? ""}
      data-crown={String(props.frameStyle?.crown ?? "")}
      data-two-color={String(props.frameStyle?.twoColor ?? "")}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const all = (...templates: string[]) =>
  templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k)));
const STANDARD = all("m15", "m15artifact", "m15land", "m15pw", "m15token", "saga", "m15snow");
const WITH_BORDERLESS = [...STANDARD, ...all("m15borderless", "m15fullartland")];

type FormProps = Parameters<typeof CardCreatorForm>[0];

function renderForm(props: Partial<FormProps> = {}) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={WITH_BORDERLESS}
      {...props}
    />,
  );
}

const template = () => screen.getAllByTestId("card-preview")[0]!.dataset.template;
const chip = () => screen.queryByTestId("frame-substituted");

function payload(
  key: string,
  extra: Record<string, unknown> = {},
  serverVerified: readonly string[] = WITH_BORDERLESS,
) {
  const named = namedBody(key, new Set(serverVerified));
  return {
    patch: named.patch,
    importedArtUrl: null,
    source: { name: named.card.name, scryfallUri: null },
    ...extra,
  };
}

async function importPayload(p: unknown) {
  importer.payload = p;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "test: import" }));
  });
}

async function toCardStep() {
  // The import lands on Identity; the Card step is one Back away.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
  });
}

async function clickChip(group: string, label: RegExp) {
  const radiogroup = screen.getByRole("radiogroup", { name: group });
  const target = Array.from(radiogroup.querySelectorAll("[role='radio']")).find((el) =>
    label.test(el.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
  if (!target) throw new Error(`no ${group} chip ${label}`);
  await act(async () => {
    fireEvent.click(target);
  });
}

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

describe("the dialog's frame choice (TODO 1.5)", () => {
  it("hands the dialog the frame the card is on, for 'Keep my current frame'", () => {
    renderForm();
    expect(importer.currentFrameTemplate).toBe("m15");
  });

  it("lands the picked frame — Borderless for Sheoldred DMU #435 — and chips the Card step", async () => {
    renderForm();
    await importPayload(payload("dmu-435", { frameChoice: { template: "m15borderless" } }));
    expect(template()).toBe("m15borderless");
    expect(toast.info).not.toHaveBeenCalled();

    await toCardStep();
    // The printing's own frame, short of the crown: nearest, not swapped.
    expect(chip()?.textContent).toBe("Nearest frame (imported Borderless frame)");
    // Borderless draws no crown yet (its floating crown is 4.6f).
    expect(chip()?.getAttribute("title")).toBe("PipGlyph doesn't draw the legendary crown on this frame yet");

    // Any frame pick clears it, for good: back on Borderless it stays gone.
    await clickChip("Frame variations", /^Standard/);
    expect(template()).toBe("m15");
    expect(chip()).toBeNull();
    await clickChip("Frame variations", /^Borderless/);
    expect(template()).toBe("m15borderless");
    expect(chip()).toBeNull();
  });

  it("the preselected bordered M15 lands with the chip; a kind change clears it", async () => {
    renderForm();
    await importPayload(payload("dmu-435", { frameChoice: { template: "m15" } }));
    expect(template()).toBe("m15");
    await toCardStep();
    expect(chip()?.textContent).toBe("Frame substituted (imported Borderless frame)");
    await clickChip("Card type", /^Artifact/);
    expect(chip()).toBeNull();
  });

  it("'Keep my current frame' keeps the frame from before the import", async () => {
    renderForm();
    await clickChip("Frame variations", /^Snow/);
    expect(template()).toBe("m15snow");
    await importPayload(payload("dmu-435", { frameChoice: { keepCurrent: true } }));
    expect(template()).toBe("m15snow");
  });

  it("a stale pick falls back to the usual resolution (keep-current on a land import → the land frame)", async () => {
    renderForm();
    await importPayload(payload("one-262", { frameChoice: { keepCurrent: true } }));
    // m15 can't dress a land; the import resolves as it always did: its
    // full-art basic, verified in white.
    expect(template()).toBe("m15fullartland");
  });

  it("an exact borderless printing picked onto Borderless itself (FDN #311) has no chip", async () => {
    renderForm();
    await importPayload(payload("fdn-311", { frameChoice: { template: "m15borderless" } }));
    expect(template()).toBe("m15borderless");
    await toCardStep();
    expect(chip()).toBeNull();
  });

  it("an exact import (no choice) lands with no chip", async () => {
    renderForm();
    await importPayload(payload("tdom-3"));
    expect(template()).toBe("m15token");
    await toCardStep();
    expect(chip()).toBeNull();
  });

  it("a crowned printing on the standard frame (DMU #107) lands exact with the crown switched on (4.6a): no chip", async () => {
    renderForm();
    await importPayload(payload("dmu-107"));
    expect(template()).toBe("m15");
    // Imports follow the printing: Sheoldred prints the crown.
    expect(screen.getAllByTestId("card-preview")[0]!.dataset.crown).toBe("true");
    expect(toast.info).not.toHaveBeenCalled();
    await toCardStep();
    expect(chip()).toBeNull();
  });
});

describe("the Art step's note on Scryfall's art (TODO 1.18, UI half)", () => {
  const ART = "https://project.supabase.co/storage/v1/object/public/card-art/u/scryfall.jpg";

  it("on an edge-to-edge frame: the art is only the classic window", async () => {
    renderForm();
    await importPayload(
      payload("dmu-435", { frameChoice: { template: "m15borderless" }, importedArtUrl: ART }),
    );
    expect(screen.getByTestId("imported-art-note").textContent).toBe(
      "Scryfall only has this art cropped to the classic window — upload the full illustration for a sharp borderless card.",
    );
  });

  it("on the bordered frame, nothing for a plain crop", async () => {
    renderForm();
    await importPayload(payload("dmu-435", { frameChoice: { template: "m15" }, importedArtUrl: ART }));
    expect(screen.queryByTestId("imported-art-note")).toBeNull();
  });

  it("a full-art printing's crop includes parts of the printed frame (warn only)", async () => {
    renderForm();
    await importPayload(payload("one-262", { importedArtUrl: ART }));
    expect(screen.getByTestId("imported-art-note").textContent).toBe(
      "Scryfall's art for this full-art printing includes parts of the printed frame — check its edges, or upload the full illustration.",
    );
  });

  it("no note without imported art", async () => {
    renderForm();
    await importPayload(payload("dmu-435", { frameChoice: { template: "m15borderless" } }));
    expect(screen.queryByTestId("imported-art-note")).toBeNull();
  });
});

describe("the deck-remix pre-fill (/create?deckCard=): no dialog, ONE toast", () => {
  it("keeps the auto-resolution and names the substitution once", async () => {
    const sheoldred = card("dmu-435");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/scryfall/named")) return json(namedBody("dmu-435", new Set(STANDARD)));
        return json({ ok: false, error: "no art" });
      }),
    );
    renderForm({
      verifiedFrameKeys: STANDARD,
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: sheoldred.id,
        deckSlug: "tester/grixis",
        deckTitle: "Grixis",
        entryName: sheoldred.name,
      },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(template()).toBe("m15");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "PipGlyph doesn't have the Borderless frame yet — using M15 (2015) Standard.",
      { duration: 8000 },
    );
    // After the "Pre-filled …" toast, so it sits in front.
    expect(toast.success.mock.invocationCallOrder[0]).toBeLessThan(
      toast.info.mock.invocationCallOrder[0]!,
    );
  });

  it("with Borderless published in black, names the cropped art (not a missing frame) and offers Borderless", async () => {
    const sheoldred = card("dmu-435");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/scryfall/named")) {
          return json(namedBody("dmu-435", new Set(WITH_BORDERLESS)));
        }
        return json({ ok: false, error: "no art" });
      }),
    );
    renderForm({
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: sheoldred.id,
        deckSlug: "tester/grixis",
        deckTitle: "Grixis",
        entryName: sheoldred.name,
      },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(template()).toBe("m15");
    expect(toast.info).toHaveBeenCalledTimes(1);
    const [message, options] = toast.info.mock.calls[0]! as [
      string,
      { action?: { label: string } },
    ];
    expect(message).toBe(
      "Scryfall's art for this printing is cropped to the bordered window — using M15 (2015) Standard instead of the Borderless frame.",
    );
    expect(options.action?.label).toMatch(/Borderless/);
  });

  it("C3: stays quiet for a crown-only printing on its own frame (DMU #107): no substitution happened", async () => {
    const sheoldred = card("dmu-107");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/scryfall/named")) return json(namedBody("dmu-107", new Set(STANDARD)));
        return json({ ok: false, error: "no art" });
      }),
    );
    renderForm({
      verifiedFrameKeys: STANDARD,
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: sheoldred.id,
        deckSlug: "tester/grixis",
        deckTitle: "Grixis",
        entryName: sheoldred.name,
      },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(template()).toBe("m15");
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("imports = printing-only (owner round 17, 2026-09-30)", () => {
  /** A real printing of anatomy-printings.json through the /named route's
   *  own mapper + finalize, as the dialog hands it over. */
  function printing(key: keyof typeof anatomyPrintings) {
    const c = scryfallCardSchema.parse(anatomyPrintings[key]);
    const patch = finalizeImportMatch(mapScryfallToFormPatch(c), new Set(WITH_BORDERLESS));
    return {
      patch: JSON.parse(JSON.stringify(patch)),
      importedArtUrl: null,
      source: { name: c.name, scryfallUri: null },
    };
  }
  const preview = () => screen.getAllByTestId("card-preview")[0]!.dataset;

  it("a switch the printing names none for takes the new-card default, whatever an earlier import left", async () => {
    renderForm();
    // M15 #3 Avacyn: a Legendary card printed without the crown — OFF.
    await importPayload(printing("m15-3"));
    expect(preview().template).toBe("m15");
    expect(preview().crown).toBe("false");
    expect(preview().twoColor).toBe("true");
    // STX #175 Daemogoth Woe-Eater isn't Legendary: its printing says
    // nothing about the crown, so the form holds the new-card default (on),
    // not the off the previous import left — as the AI deck remix stores.
    await importPayload(printing("stx-175"));
    expect(preview().crown).toBe("true");
    expect(preview().twoColor).toBe("true");
    // LTR #302 Boromir, a showcase: OFF again, explicitly.
    await importPayload(printing("ltr-302"));
    expect(preview().crown).toBe("false");
  });
});

describe("a double-faced token or a Role card (TODO 1.23)", () => {
  it("a double-faced token imports its front face and the creator says so", async () => {
    renderForm();
    // A single-faced token says nothing about faces…
    await importPayload(payload("tdom-3"));
    expect(toast.info).not.toHaveBeenCalled();
    // …a double-faced one names the face that came in.
    await importPayload(payload("tmom-16"));
    expect(toast.info).toHaveBeenCalledWith(
      "Incubator // Phyrexian is a double-faced token — PipGlyph imported its front face, Incubator. Two-sided tokens aren't supported yet.",
      { duration: 8000 },
    );
    expect((screen.getByPlaceholderText("Emberbound Wyrm") as HTMLInputElement).value).toBe("Incubator");
  });

  it("a Role card imports the front Role on the token kind and says so", async () => {
    renderForm();
    await importPayload(payload("twoe-15"));
    expect(toast.info).toHaveBeenCalledWith(
      "Monster // Sorcerer holds two Roles — PipGlyph imported the front one, Monster.",
      { duration: 8000 },
    );
    expect(template()).toBe("m15token");
  });
});

// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The word a borrowed frame wrote comes out again after a step change (owner
// decision 3, Round 56, 2026-10-13 — the follow-up of #542).
//
// Picking the Artifact frame on a creature writes "Artifact" into its type
// words; picking Nyx on a creature or an artifact writes "Enchantment". Going
// back to Standard takes the word out again — on `origin/main` only on the
// SAME visit to the Card step: the panel kept that memory in a ref and lost
// it when a step change unmounted it. The memory is the creator form's now
// (components/creator/borrowed-words.tsx).
//
// Two halves:
//   1. BEHAVIOUR — through the real CardCreatorForm: the word goes after a
//      step change (both borrows), a word the maker typed or kept by hand
//      stays, an edit and a remix are untouched.
//   2. PAYLOADS — what a save sends in every flow `origin/main` already got
//      right must not move by a byte. `fixtures/borrowed-word-main-
//      payloads.json` is what THIS FILE recorded on `origin/main` (7293a0fa,
//      #542 merged) from a checkout of that commit:
//        BORROWED_WORD_CAPTURE=<path/to/out.json> npx vitest run <this file>
//      (the capture run records the scenarios only: the behaviour half is
//      what main does not do).
// (Edited by hand 2026-10-30, one deliberate change: a NEW card's — and a
// key-less parent's remix's — `frame_style.collector` reads "off" where it
// read "2023", the collector line's new-card default (NEW_CARD_ANATOMY);
// a stored card's own "2023" is unchanged. And a NEW card's `tags` holds
// what its name, rules text and subtypes suggest (lib/cards/auto-tags.ts,
// the creator's tag follow) where it was []. Nothing else moved.)
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
vi.mock("@/lib/cards/dfc-adopt-actions", () => ({ adoptDfcBodiesAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({
  recordFrameRequestAction: vi.fn(async () => ({ ok: true })),
}));
// The import dialog needs Scryfall: a stand-in with ONE button that hands the
// form the payload the test set, through the same `onImport`.
const importer = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: ({ onImport }: { onImport: (payload: unknown) => unknown }) => (
    <button type="button" data-testid="import-apply" onClick={() => onImport(importer.payload)}>
      import
    </button>
  ),
  toastImportNotice: () => {},
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
// The ideas dialog needs the AI: a stand-in with ONE button that hands the
// form an idea's type words through the same `onApply` the real one calls.
vi.mock("@/components/creator/card-ideas-dialog", () => ({
  CardIdeasDialog: (props: { onApply: (patch: { supertype: string }) => void }) => (
    <button type="button" data-testid="idea-apply" onClick={() => props.onApply({ supertype: "Legendary Artifact" })}>
      apply idea
    </button>
  ),
}));
vi.mock("@/components/creator/art-uploader", () => ({
  ArtUploader: (props: {
    fieldAnchor?: string;
    onArtChange: (next: { artUrl: string | null; artPosition: { focalX: number; focalY: number; scale: number } }) => void;
  }) => (
    <button
      type="button"
      data-field-anchor={props.fieldAnchor}
      data-art-stub={props.fieldAnchor}
      onClick={() =>
        props.onArtChange({ artUrl: "https://example.com/front.png", artPosition: { focalX: 0.31, focalY: 0.62, scale: 1.4 } })
      }
    >
      set art
    </button>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: Record<string, unknown>) => (
    <div
      data-testid="card-preview"
      data-props={JSON.stringify(props, (key, value) =>
        typeof value === "function" || ["face", "flipOnClick", "hideFlipControl"].includes(key) ? undefined : value,
      )}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
// The Nyx frame counted as verified (production has not ticked it yet): the
// one way the borrow can be picked.
const VERIFIED = ["m15", "m15artifact", "m15nyx"].flatMap((template) =>
  EVERY_COLOUR.map((key) => frameComboKey(template as never, key)),
);

type FormProps = Parameters<typeof CardCreatorForm>[0];
function renderForm(props: Partial<FormProps> = {}) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={VERIFIED}
      {...props}
    />,
  );
}

/** A stored card on a frame its kind borrows, the word in its supertype. */
function storedCard(template: "m15artifact" | "m15nyx", supertype: string): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Brass Sentinel",
    slug: "brass-sentinel",
    game_system_id: GAME,
    cost: "{2}{W}",
    color_identity: ["white"],
    supertype,
    printed_types: null,
    card_type: "creature",
    subtypes: ["Golem"],
    tags: ["test"],
    rarity: "rare",
    rules_text: "Vigilance",
    flavor_text: "It never sleeps.",
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.31, focalY: 0.62, scale: 1.4 },
    frame_style: { finish: "regular", template, collector: "2023" },
    visibility: "private",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    set_code: null,
    collector_number: null,
    lang: "en",
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-02T10:00:00.000Z",
  } as unknown as Card;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
/** Open a step by its rail button — a real step change: the open step's
 *  panel unmounts. */
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (!button) throw new Error(`no step ${step}`);
  await click(button);
}
const CARD = /^card/i;
const IDENTITY = /^identity/i;
async function reach<T extends Element>(find: () => T | null, what: string): Promise<T> {
  if (find()) return find()!;
  for (const step of [CARD, IDENTITY, /^text/i, /^publish/i]) {
    const rail = screen.getByRole("navigation", { name: /card editor steps/i });
    const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
    if (button) await click(button);
    if (find()) return find()!;
  }
  throw new Error(`not found anywhere: ${what}`);
}
async function type(name: string, value: string) {
  const el = await reach(() => document.querySelector<HTMLInputElement>(`[name='${name}']`), name);
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
const typesInput = () => document.querySelector<HTMLInputElement>("[data-testid='types-field-input-front']");
/** Type the front face's Types field by hand. */
async function typeTypes(value: string) {
  const el = await reach(typesInput, "types field");
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
/** What the Types field shows (the Identity step). */
async function typesText() {
  return (await reach(typesInput, "types field")).value;
}
async function chip(group: string, label: RegExp) {
  const el = await reach(() => {
    const radiogroup = Array.from(document.querySelectorAll("[role='radiogroup']")).find(
      (g) => g.getAttribute("aria-label") === group,
    );
    return (
      (Array.from(radiogroup?.querySelectorAll("[role='radio']") ?? []).find((c) => label.test(c.textContent ?? "")) as
        | HTMLElement
        | undefined) ?? null
    );
  }, `${group} ${label}`);
  await click(el);
}
/** A Variations pick on the Card step. */
const variation = (label: RegExp) => chip("Frame variations", label);
async function setArt() {
  await click(await reach(() => document.querySelector("[data-art-stub='art_url']"), "art"));
}
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function save(action: "createCardAction" | "updateCardAction" = "createCardAction") {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await click(saveButton());
  await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
  const call = actions[action].mock.calls[0];
  return JSON.parse(JSON.stringify(action === "createCardAction" ? call[0] : call[1])) as Record<string, unknown> & {
    supertype?: string | null;
    printed_types?: string | null;
    card_type?: string;
    frame_style?: { template?: string };
  };
}
const previewProps = () => JSON.parse(screen.getAllByTestId("card-preview")[0].dataset.props ?? "{}") as unknown;

/** A new card of the kind, in a colour, with what a public save needs. */
async function newCard(kind: RegExp | null, colour: RegExp = /^white/i) {
  renderForm();
  if (kind) await chip("Card type", kind);
  await chip("Color identity", colour);
  await type("title", "Brass Sentinel");
  await setArt();
  await goTo(CARD);
}
const words = (payload: { supertype?: string | null; printed_types?: string | null; card_type?: string; frame_style?: { template?: string } }) => ({
  card_type: payload.card_type,
  supertype: payload.supertype ?? "",
  printed_types: payload.printed_types ?? null,
  template: payload.frame_style?.template,
});

// ---------------------------------------------------------------------------
// 2. Payloads `origin/main` already sends: unchanged.
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, () => Promise<unknown>> = {
  "new creature — no borrowed frame, steps walked back and forth": async () => {
    await newCard(null);
    await goTo(IDENTITY);
    await type("subtypes_text", "Golem");
    await goTo(CARD);
    await goTo(IDENTITY);
    await type("power", "2");
    await type("toughness", "3");
    return save();
  },
  "new creature — \"Artifact Creature\" typed by hand, on the Standard frame": async () => {
    await newCard(null);
    await typeTypes("Artifact Creature");
    await goTo(CARD);
    return save();
  },
  "new creature — \"Legendary Enchantment Creature\" typed by hand: the frame follows onto Nyx": async () => {
    await newCard(null);
    await typeTypes("legendary enchantment creature");
    await goTo(CARD);
    return save();
  },
  "new creature — the word typed by hand, then Standard picked: the word stays": async () => {
    await newCard(null);
    await typeTypes("Enchantment Creature");
    await goTo(CARD);
    await variation(/Standard/);
    return save();
  },
  "new artifact — its own frame, no borrow": async () => {
    await newCard(/^Artifact/);
    await type("subtypes_text", "Equipment");
    return save();
  },
  "new enchantment — the kind's own Nyx skin": async () => {
    await newCard(/^Enchantment/);
    await type("subtypes_text", "Aura");
    return save();
  },
  "new enchantment — back to Standard by hand": async () => {
    await newCard(/^Enchantment/);
    await variation(/Standard/);
    await goTo(IDENTITY);
    await goTo(CARD);
    return save();
  },
  "new instant — no Variations of its own": async () => {
    await newCard(/^Instant/);
    return save();
  },
  "new creature — the Artifact frame picked and kept": async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    await type("subtypes_text", "Golem");
    return save();
  },
  "new creature — Nyx picked and kept": async () => {
    await newCard(null);
    await variation(/^Nyx/);
    await goTo(IDENTITY);
    await type("subtypes_text", "Spirit");
    return save();
  },
  "new artifact — Nyx picked and kept": async () => {
    await newCard(/^Artifact/);
    await variation(/^Nyx/);
    return save();
  },
  "new creature — the Artifact frame picked, Standard on the SAME visit": async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await variation(/Standard/);
    return save();
  },
  "new creature — Nyx picked, Standard on the SAME visit": async () => {
    await newCard(null);
    await variation(/^Nyx/);
    await variation(/Standard/);
    return save();
  },
  "new creature — Artifact then Nyx on the SAME visit": async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await variation(/^Nyx/);
    return save();
  },
  "stored Artifact Creature on the artifact frame — opened for an edit: the values the form holds": async () => {
    renderForm({ mode: "edit", card: storedCard("m15artifact", "Legendary Artifact") });
    return previewProps();
  },
  "stored Artifact Creature on the artifact frame — an edit of one field": async () => {
    renderForm({ mode: "edit", card: storedCard("m15artifact", "Legendary Artifact") });
    await type("flavor_text", "It never slept.");
    return save("updateCardAction");
  },
  "stored Enchantment Creature on Nyx — an edit of the printed type line": async () => {
    renderForm({ mode: "edit", card: storedCard("m15nyx", "Enchantment") });
    await typeTypes("Creature Enchantment");
    return save("updateCardAction");
  },
  "stored Enchantment Creature on Nyx — a remix saves the source's words and frame": async () => {
    renderForm({ mode: "remix", card: storedCard("m15nyx", "Enchantment") });
    await type("title", "Brass Sentinel, Remade");
    return save();
  },
};

const FIXTURE = path.join(__dirname, "fixtures", "borrowed-word-main-payloads.json");
const capturePath = process.env.BORROWED_WORD_CAPTURE;

describe("a borrowed frame's word: what origin/main already sends is unchanged", () => {
  if (capturePath) {
    it("records every scenario (run on origin/main)", async () => {
      const out: Record<string, unknown> = {};
      for (const [name, run] of Object.entries(SCENARIOS)) {
        try {
          out[name] = await run();
        } catch (error) {
          throw new Error(`${name}: ${(error as Error).message.slice(0, 400)}`);
        }
        cleanup();
        for (const fn of Object.values(actions)) fn.mockClear();
      }
      fs.writeFileSync(capturePath, `${JSON.stringify(out, null, 2)}\n`);
    }, 240_000);
    return;
  }
  const recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  it("the fixture holds every scenario", () => {
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
  it.each(Object.keys(SCENARIOS))("%s: identical to origin/main", async (name) => {
    const got = await SCENARIOS[name]();
    // Byte for byte, key order included.
    expect(JSON.stringify(got, null, 2)).toBe(JSON.stringify(recorded[name], null, 2));
  }, 30_000);
  it("the recorded scenarios say what they are named for", () => {
    const of = (name: string) => words(recorded[name] as never);
    expect(of("new creature — the Artifact frame picked and kept")).toEqual({ card_type: "creature", supertype: "Artifact", printed_types: null, template: "m15artifact" });
    expect(of("new creature — Nyx picked and kept")).toEqual({ card_type: "creature", supertype: "Enchantment", printed_types: null, template: "m15nyx" });
    expect(of("new artifact — Nyx picked and kept")).toEqual({ card_type: "artifact", supertype: "Enchantment", printed_types: null, template: "m15nyx" });
    expect(of("new creature — the Artifact frame picked, Standard on the SAME visit")).toEqual({ card_type: "creature", supertype: "", printed_types: null, template: "m15" });
    expect(of("new creature — Nyx picked, Standard on the SAME visit")).toEqual({ card_type: "creature", supertype: "", printed_types: null, template: "m15" });
    expect(of("new creature — Artifact then Nyx on the SAME visit")).toEqual({ card_type: "creature", supertype: "Enchantment", printed_types: null, template: "m15nyx" });
    expect(of("new creature — the word typed by hand, then Standard picked: the word stays")).toEqual({ card_type: "creature", supertype: "Enchantment", printed_types: "Enchantment Creature", template: "m15" });
  });
});

// ---------------------------------------------------------------------------
// 1. Behaviour.
// ---------------------------------------------------------------------------

describe.skipIf(Boolean(capturePath))("a borrowed frame's word comes out again after a step change", () => {
  it("Nyx on a creature: seeded, a step change, back to Standard — the word is gone", async () => {
    await newCard(null);
    await variation(/^Nyx/);
    expect(await typesText()).toBe("Enchantment Creature"); // the Identity step: the Card step's panel is gone
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Creature");
    expect(words(await save())).toEqual({ card_type: "creature", supertype: "", printed_types: null, template: "m15" });
  });

  it("the Artifact frame on a creature: seeded, a step change, back to Standard — the word is gone", async () => {
    await newCard(null);
    await variation(/^Artifact/);
    expect(await typesText()).toBe("Artifact Creature");
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Creature");
    expect(words(await save())).toEqual({ card_type: "creature", supertype: "", printed_types: null, template: "m15" });
  });

  it("Nyx on an artifact: the same, and several step changes later", async () => {
    await newCard(/^Artifact/);
    await variation(/^Nyx/);
    expect(await typesText()).toBe("Enchantment Artifact");
    await goTo(/^text/i);
    await goTo(/^publish/i);
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Artifact");
    expect(words(await save())).toEqual({ card_type: "artifact", supertype: "", printed_types: null, template: "m15artifact" });
  });

  it("only the frame's word goes: every other word, and a typed line's order, stay", async () => {
    await newCard(null);
    await typeTypes("Snow Legendary Creature");
    await goTo(CARD);
    await variation(/^Artifact/);
    // The pick wrote the word into the typed line too (useTypesFieldSync).
    expect(await typesText()).toMatch(/Artifact/);
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Snow Legendary Creature");
    expect(words(await save())).toEqual({ card_type: "creature", supertype: "Snow Legendary", printed_types: "Snow Legendary Creature", template: "m15" });
  });

  it("Artifact, a step change, then Nyx: \"Artifact\" out and \"Enchantment\" in; a step change, Standard: nothing left", async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    await goTo(CARD);
    await variation(/^Nyx/);
    expect(await typesText()).toBe("Enchantment Creature");
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Creature");
    expect(words(await save())).toEqual({ card_type: "creature", supertype: "", printed_types: null, template: "m15" });
  });

  it("the kind changed after a step change: the word is not doubled (an Artifact Creature turned Artifact)", async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    await goTo(CARD);
    await chip("Card type", /^Artifact/);
    expect(await typesText()).toBe("Artifact");
    expect(words(await save())).toMatchObject({ card_type: "artifact", supertype: "" });
  });
});

describe.skipIf(Boolean(capturePath))("a word the maker typed or kept by hand stays", () => {
  it("seeded, then the Types field edited by hand with the word kept: Standard leaves it", async () => {
    await newCard(null);
    await variation(/^Nyx/);
    await typeTypes("Legendary Enchantment Creature");
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Legendary Enchantment Creature");
    expect(words(await save())).toEqual({
      card_type: "creature",
      supertype: "Legendary Enchantment",
      printed_types: "Legendary Enchantment Creature",
      template: "m15",
    });
  });

  it("seeded, the word deleted by hand and typed again: it is the maker's", async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await typeTypes("Creature");
    await typeTypes("Artifact Creature");
    await goTo(CARD);
    await variation(/^Artifact/); // the word is there: nothing is written, nothing remembered
    await goTo(IDENTITY);
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Artifact Creature");
    expect(words(await save())).toMatchObject({ supertype: "Artifact", template: "m15" });
  });

  it("the word typed BEFORE the pick was never the frame's: Standard leaves it, after a step change too", async () => {
    await newCard(null);
    await typeTypes("Artifact Creature");
    await goTo(CARD);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Artifact Creature");
    expect(words(await save())).toEqual({ card_type: "creature", supertype: "Artifact", printed_types: "Artifact Creature", template: "m15" });
  });

  it("an idea that writes the type words makes them the idea's: a word seeded before it is not taken out of them", async () => {
    await newCard(null);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    await click(screen.getByTestId("idea-apply")); // supertype "Legendary Artifact"
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Legendary Artifact Creature");
    expect(words(await save())).toMatchObject({ supertype: "Legendary Artifact", template: "m15" });
  });

  it("an import is another card: its own Artifact word is not taken out by a memory made before it", async () => {
    await newCard(null, /^colorless/i);
    await variation(/^Artifact/);
    await goTo(IDENTITY);
    // A colourless Artifact Creature on the plain 2015 frame (a made-up
    // printing), as the route would hand it over: the real mapper,
    // finalized against VERIFIED.
    const printing = scryfallCardSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Brass Sentinel",
      layout: "normal",
      set: "tst",
      set_name: "Test",
      set_type: "expansion",
      collector_number: "1",
      frame: "2015",
      frame_effects: [],
      border_color: "black",
      full_art: false,
      textless: false,
      promo_types: [],
      keywords: [],
      type_line: "Artifact Creature — Golem",
      mana_cost: "{3}",
      colors: [],
      color_identity: [],
    });
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing), new Set(VERIFIED));
    expect({ supertype: patch.supertype, template: patch.frame_template }).toEqual({ supertype: "Artifact", template: "m15artifact" });
    importer.payload = { patch: JSON.parse(JSON.stringify(patch)), importedArtUrl: null, source: { name: printing.name, scryfallUri: null } };
    await click(screen.getByTestId("import-apply"));
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Artifact Creature");
    await setArt();
    expect(words(await save())).toMatchObject({ card_type: "creature", supertype: "Artifact", template: "m15" });
  });

  it("Start over forgets: the next card's pick and its way back work from nothing", async () => {
    await newCard(null);
    await variation(/^Nyx/);
    await goTo(IDENTITY);
    await click(screen.getByRole("button", { name: /Start over/ }));
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: /Start over/ }));
    expect(await typesText()).toBe("Creature");
    await chip("Color identity", /^white/i);
    await type("title", "Brass Sentinel");
    await setArt();
    await typeTypes("Enchantment Creature"); // by hand, on the new card
    await goTo(CARD);
    await variation(/Standard/);
    expect(await typesText()).toBe("Enchantment Creature");
    expect(words(await save())).toMatchObject({ supertype: "Enchantment", template: "m15" });
  });
});

describe.skipIf(Boolean(capturePath))("an edit and a remix are untouched", () => {
  it("a stored Artifact Creature opened for an edit has no Card step, and an edit sends neither its type words nor its frame", async () => {
    renderForm({ mode: "edit", card: storedCard("m15artifact", "Legendary Artifact") });
    const rail = screen.getByRole("navigation", { name: /card editor steps/i });
    expect(Array.from(rail.querySelectorAll("button")).some((b) => CARD.test(b.textContent ?? ""))).toBe(false);
    expect(screen.queryByRole("radiogroup", { name: "Frame variations" })).toBeNull();
    await type("flavor_text", "It never slept.");
    for (const step of [IDENTITY, /^text/i, /^publish/i, IDENTITY]) await goTo(step);
    const payload = await save("updateCardAction");
    expect(payload).not.toHaveProperty("supertype");
    expect(payload).not.toHaveProperty("card_type");
    expect(payload).not.toHaveProperty("frame_style");
    expect(payload.flavor_text).toBe("It never slept.");
  });

  it("an edit of the printed line of a stored Enchantment Creature on Nyx changes the printed words only", async () => {
    renderForm({ mode: "edit", card: storedCard("m15nyx", "Enchantment") });
    await typeTypes("Creature"); // the word typed away from the printed line
    for (const step of [/^text/i, IDENTITY]) await goTo(step);
    const payload = await save("updateCardAction");
    expect(payload.printed_types).toBe("Creature");
    expect(payload).not.toHaveProperty("supertype");
    expect(payload).not.toHaveProperty("frame_style");
  });

  it("a remix keeps the source's words and frame", async () => {
    renderForm({ mode: "remix", card: storedCard("m15artifact", "Legendary Artifact") });
    await type("title", "Brass Sentinel, Remade");
    for (const step of [/^text/i, IDENTITY]) await goTo(step);
    expect(words(await save())).toMatchObject({ card_type: "creature", supertype: "Legendary Artifact", template: "m15artifact" });
  });
});

describe.skipIf(Boolean(capturePath))("the memory itself (createBorrowedWordSeeds)", () => {
  // Imported here, not at the top: the capture run on origin/main, where the
  // module does not exist, must still load this file.
  const modulePath = "@/components/creator/borrowed-words";
  const load = async () =>
    ((await import(/* @vite-ignore */ modulePath)) as typeof import("@/components/creator/borrowed-words")).createBorrowedWordSeeds;
  it("returns a word once, when the card no longer wears a frame that borrows it", async () => {
    const seeds = (await load())();
    expect(seeds.leave("creature", "m15")).toEqual([]);
    seeds.seed("Artifact");
    expect(seeds.leave("creature", "m15artifact")).toEqual([]);
    expect(seeds.leave("creature", "m15borderlessartifact")).toEqual([]); // the other artifact dress: still "Artifact"
    expect(seeds.words()).toEqual(["Artifact"]);
    expect(seeds.leave("creature", "m15")).toEqual(["Artifact"]);
    expect(seeds.leave("creature", "m15")).toEqual([]);
    expect(seeds.words()).toEqual([]);
  });

  it("one borrow for another: the old word leaves, the new one stays", async () => {
    const seeds = (await load())();
    seeds.seed("Artifact");
    seeds.seed("Enchantment");
    expect(seeds.leave("creature", "m15nyx")).toEqual(["Artifact"]);
    expect(seeds.words()).toEqual(["Enchantment"]);
    // The Enchantment kind wears Nyx as its own skin: the word is the card type's there.
    expect(seeds.leave("enchantment", "m15nyx")).toEqual(["Enchantment"]);
  });

  it("forget leaves nothing to take out", async () => {
    const seeds = (await load())();
    seeds.seed("Enchantment");
    seeds.forget();
    expect(seeds.leave("creature", "m15")).toEqual([]);
  });
});

// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { partColorFromCost } from "@/lib/cards/part-color";

// ---------------------------------------------------------------------------
// Face tabs, part 1 (TODO 5.14): the back's fields MOVED — nothing about
// what a save sends may have.
//
// Each scenario builds a double-faced card through the real CardCreatorForm
// with fixed inputs (front + back; a land back; the back's own colour;
// printed type lines; art and art positions) and records the payload the
// save hands to the server action — or, for the stored card, the payload of
// an edit and the values the form opened with.
//
// The fixture `fixtures/face-tabs-main-payloads.json` is what THIS FILE
// recorded on `origin/main` (8a805a8e, the commit before Face tabs), where
// the back was one panel on the Identity step: the driver below finds every
// field by its form path wherever the creator puts it (`reach` walks the
// steps and, where there is a switch, the tabs), so the same file runs
// unchanged on both. To re-record on a checkout of that commit:
//   FACE_TABS_CAPTURE=<path/to/out.json> npx vitest run <this file>
// (Edited by hand 2026-10-30, one deliberate change: a NEW card's — and a
// key-less parent's remix's — `frame_style.collector` reads "off" where it
// read "2023", the collector line's new-card default (NEW_CARD_ANATOMY);
// a stored card's own "2023" is unchanged. And a NEW card's `tags` holds
// what its rules text and subtypes suggest (lib/cards/auto-tags.ts,
// the creator's tag follow) where it was [] — the back face's too, so the
// two new double-faced cards carry their back's tags. Nothing else moved.)
//
// Part 2 (split, aftermath, adventure, flip — the second part left the
// Identity step's "More options" fold for a tab of its own): the scenarios
// under PART_SCENARIOS were recorded by THIS FILE on `origin/main` 73661d13
// (part 1 merged, part 2 not) from a `git archive` of that commit, and
// added to the same fixture. Each kind: a new card with both parts filled —
// the fields a half never prints included (its loyalty, its defense, a flip
// side's own picture) — a stored card as the form opens it, and an edit of
// one part only, then of the other.
//
// Round 52 (2026-10-13 — a field the card never draws for the second part is
// hidden while it is empty): a NEW card's second part is filled through the
// fields its tab offers on a new card — a split or aftermath half's picture,
// a flip side's power / toughness; no loyalty, defense, flavour or artist,
// no picture on a flip side — and each stored split / aftermath / flip card
// gained an edit of two fields its second part never prints (they hold a
// value there, so they are on screen). Every PART scenario was recorded
// again by THIS FILE on `origin/main` 1a4d4f69 (part 2 merged, the hide rule
// not) from a `git archive` of that commit; part 1's seven came out equal to
// the fixture.
//
// Amended by hand since (creator-footer-and-create-clears.test.tsx): every
// EDIT payload lost its `footer_text: ""` when an edit stopped resending a
// footer mark its maker didn't touch — part 1's two transform edits, and
// part 2's eight (two each for split, aftermath, adventure and flip).
// Nothing else in the fixture was changed: recording this file on main
// before that fix and on the branch with it differs by those ten lines
// alone. A re-record on a commit from before the fix puts them back.
// (Round 52's three added edits lost the same line when that fix was folded
// in — thirteen in all: THIS FILE recorded on `origin/main` 37beda45, the
// fix merged and the hide rule not, gives the fixture byte for byte.)
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
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
  toastImportNotice: () => {},
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
// The uploader needs a browser and a bucket: a stand-in with ONE button per
// art field that hands the form a fixed picture and a hand-set position,
// through the same `onArtChange` the real one calls.
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
        props.onArtChange(
          props.fieldAnchor === "art_url"
            ? { artUrl: "https://example.com/front.png", artPosition: { focalX: 0.31, focalY: 0.62, scale: 1.4 } }
            : { artUrl: "https://example.com/back.png", artPosition: { focalX: 0.7, focalY: 0.25, scale: 1.15 } },
        )
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
        // The face shown and the turn controls are the creator's chrome —
        // everything else is the card.
        typeof value === "function" || ["face", "flipOnClick", "hideFlipControl"].includes(key) ? undefined : value,
      )}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  "m15",
  "m15artifact",
  "m15land",
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
  "m15mdfcfront",
  "m15mdfcback",
  "m15mdfclandfront",
  "m15mdfclandback",
  "split",
  "aftermath",
  "adventure",
  "flip",
].flatMap((template) => EVERY_COLOUR.map((key) => frameComboKey(template, key)));

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

function storedCard(): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Dusk Ferryman",
    slug: "dusk-ferryman",
    game_system_id: GAME,
    cost: "{1}{U}",
    color_identity: ["blue"],
    supertype: "Legendary",
    printed_types: "Legendary Creature",
    card_type: "creature",
    subtypes: ["Human", "Rogue"],
    tags: ["test"],
    rarity: "rare",
    rules_text: "Vigilance\nWhen Dusk Ferryman dies, transform it.",
    flavor_text: "“One coin. Both ways.”",
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.31, focalY: 0.62, scale: 1.4 },
    frame_style: { finish: "regular", template: "m15dfcfront", dfcIcon: "sunmoon", collector: "2023", crown: true },
    visibility: "private",
    back_face: {
      title: "Ferryman of the Drowned",
      card_type: "creature",
      supertype: "Legendary",
      printed_types: "Legendary Creature",
      subtypes: ["Spirit", "Horror"],
      rules_text: "Flying\n{T}: Each opponent mills two cards.",
      flavor_text: "The river keeps what it is paid.",
      power: "4",
      toughness: "4",
      artist_credit: "Bo Marsh",
      art_url: "https://example.com/back.png",
      art_position: { focalX: 0.7, focalY: 0.25, scale: 1.15 },
      frame_style: { template: "m15dfcbackleft" },
      color_identity: ["green"],
    },
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: "mid",
    set_code: "MID",
    collector_number: "44",
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
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (button) await click(button);
}
/** Find something wherever the creator puts it: on the step that is open,
 *  else step by step — and, where a step has the face switch, tab by tab. */
async function reach<T extends Element>(find: () => T | null, what: string): Promise<T> {
  const tryTabs = async () => {
    if (find()) return true;
    const tabs = screen.queryAllByRole("tab").filter((tab) => tab.getAttribute("aria-disabled") !== "true");
    for (const tab of tabs) {
      await click(tab);
      if (find()) return true;
    }
    return false;
  };
  if (await tryTabs()) return find()!;
  for (const step of [/^card/i, /^identity/i, /^text/i, /^publish/i]) {
    await goTo(step);
    if (await tryTabs()) return find()!;
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
/** The Types field is found by its test id (one per face). */
async function typeTestId(testId: string, value: string) {
  const el = await reach(() => document.querySelector<HTMLInputElement>(`[data-testid='${testId}']`), testId);
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
async function chip(group: string, label: RegExp) {
  const el = await reach(() => {
    const radiogroup = Array.from(document.querySelectorAll("[role='radiogroup']")).find(
      (g) => g.getAttribute("aria-label") === group,
    );
    return (
      (Array.from(radiogroup?.querySelectorAll("[role='radio']") ?? []).find((c) =>
        label.test(c.textContent ?? ""),
      ) as HTMLElement | undefined) ?? null
    );
  }, `${group} ${label}`);
  await click(el);
}
async function setArt(fieldAnchor: string) {
  await click(await reach(() => document.querySelector(`[data-art-stub='${fieldAnchor}']`), fieldAnchor));
}
async function addPips(fieldPath: "cost" | "back_face.cost", labels: string[]) {
  for (const label of labels) {
    const button = await reach(() => {
      // The picker of THIS cost: the one whose FieldGroup has no other
      // face's cost in it. Both pickers are never on screen together on
      // either layout's step except main's Identity step, where the only
      // picker is the back's.
      const pickers = Array.from(document.querySelectorAll(`button[aria-label='Add ${label}']`));
      if (pickers.length === 0) return null;
      const wantBack = fieldPath === "back_face.cost";
      const hit = pickers.find((b) => {
        const inBack =
          Boolean(b.closest("[data-testid='dfc-face-panel']")) ||
          // The fold a half's whole editor was in before Face tabs part 2.
          Boolean(b.closest("details")?.querySelector("[name='back_face.title']")) ||
          // The switch's second tab, whatever the kind calls it.
          screen.queryByTestId("face-switch")?.querySelectorAll("[role='tab']")[1]?.getAttribute("aria-selected") === "true";
        return inBack === wantBack;
      });
      return (hit as HTMLElement | undefined) ?? null;
    }, `${fieldPath} pip ${label}`);
    await click(button);
  }
}
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function save(action: "createCardAction" | "updateCardAction") {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await click(saveButton());
  await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
  const call = actions[action].mock.calls[0];
  return JSON.parse(JSON.stringify(action === "createCardAction" ? call[0] : call[1])) as Record<string, unknown>;
}
const previewProps = () => JSON.parse(screen.getAllByTestId("card-preview")[0].dataset.props ?? "{}") as unknown;

/** The front every scenario shares. */
async function fillFront(colour: RegExp) {
  await chip("Color identity", colour);
  await type("title", "Dusk Ferryman");
  await typeTestId("types-field-input-front", "Legendary Creature");
  await type("subtypes_text", "Human, Rogue");
  await setArt("art_url");
  await type("artist_credit", "Anya Vale");
  await addPips("cost", ["Blue"]);
  await typeRules("rules_text", "Vigilance\nWhen Dusk Ferryman dies, transform it.");
  await type("flavor_text", "\"One coin. Both ways.\"");
  await type("power", "2");
  await type("toughness", "3");
}
async function typeRules(name: string, value: string) {
  const el = await reach(
    () => document.querySelector<HTMLElement>(`[name='${name}'], [data-field='${name}']`),
    name,
  );
  await act(async () => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      fireEvent.change(el, { target: { value } });
    } else {
      el.textContent = value;
      fireEvent.input(el);
    }
    fireEvent.blur(el);
  });
}

const SCENARIOS: Record<string, () => Promise<unknown>> = {
  "new transform card — a creature back with its own colour": async () => {
    renderForm();
    await chip("Card type", /^Transform/);
    await chip("Transform icon family", /Sun \/ moon/);
    await fillFront(/^blue/i);
    await chip("Back face color", /^green/i);
    await type("back_face.title", "Ferryman of the Drowned");
    await typeTestId("types-field-input-back", "Legendary Creature");
    await type("back_face.subtypes_text", "Spirit, Horror");
    await typeRules("back_face.rules_text", "Flying\n{T}: Each opponent mills two cards.");
    await type("back_face.flavor_text", "The river keeps what it is paid.");
    await type("back_face.power", "4");
    await type("back_face.toughness", "4");
    await type("back_face.artist_credit", "Bo Marsh");
    await setArt("back_face.art_url");
    return save("createCardAction");
  },
  "new transform card — a land back (colourless), saved as a draft with no back art": async () => {
    renderForm();
    await chip("Card type", /^Transform/);
    await fillFront(/^green/i);
    await chip("Back face type", /^Land/);
    await type("back_face.title", "Drowned Landing");
    await type("back_face.subtypes_text", "Island");
    await typeRules("back_face.rules_text", "{T}: Add {U}.");
    await click(await reach(() => document.querySelector("[data-testid='save-as-draft']"), "save-as-draft"));
    return save("createCardAction");
  },
  "new modal card — a sorcery back with a cost": async () => {
    renderForm();
    await chip("Card type", /Modal double-faced/);
    await fillFront(/^red/i);
    await chip("Back face type", /^Sorcery/);
    await type("back_face.title", "Ferryman's Toll");
    await addPips("back_face.cost", ["Red", "Red"]);
    await typeRules("back_face.rules_text", "Ferryman's Toll deals 3 damage to any target.");
    await type("back_face.flavor_text", "Paid in full.");
    await setArt("back_face.art_url");
    await type("back_face.artist_credit", "Bo Marsh");
    return save("createCardAction");
  },
  "new modal card — a land back following the front's colour": async () => {
    renderForm();
    await chip("Card type", /Modal double-faced/);
    await fillFront(/^white/i);
    await chip("Back face type", /^Land/);
    await type("back_face.title", "Ferry Landing");
    await typeTestId("types-field-input-back", "Legendary Land");
    await typeRules("back_face.rules_text", "{T}: Add {W}.");
    await setArt("back_face.art_url");
    return save("createCardAction");
  },
  "stored transform card — opened for an edit: the values the form holds": async () => {
    renderForm({ mode: "edit", card: storedCard() });
    return previewProps();
  },
  "stored transform card — an edit of one front field sends only that": async () => {
    renderForm({ mode: "edit", card: storedCard() });
    await type("flavor_text", "One coin.");
    return save("updateCardAction");
  },
  "stored transform card — an edit of one back field keeps the rest of the back as stored": async () => {
    renderForm({ mode: "edit", card: storedCard() });
    await type("back_face.power", "5");
    return save("updateCardAction");
  },
};

// ---------------------------------------------------------------------------
// Part 2: the one-picture two-part kinds.
// ---------------------------------------------------------------------------

type PartKind = "split" | "aftermath" | "adventure" | "flip";
const PART_KINDS: Record<PartKind, { chip: RegExp; second: string; cardType: string; backType: string; creature: boolean }> = {
  split: { chip: /^Split/, second: "Right half", cardType: "instant", backType: "sorcery", creature: false },
  aftermath: { chip: /^Aftermath/, second: "Aftermath half", cardType: "sorcery", backType: "instant", creature: false },
  adventure: { chip: /^Adventure/, second: "Adventure spell", cardType: "creature", backType: "sorcery", creature: true },
  flip: { chip: /^Flip/, second: "Flipped side", cardType: "creature", backType: "creature", creature: true },
};

/** A stored card of `kind` with every second-part field the form can hold
 *  — the ones the frame never prints included. */
function storedPartCard(kind: PartKind): Card {
  const def = PART_KINDS[kind];
  return {
    ...storedCard(),
    title: "Fire",
    slug: "fire",
    cost: "{1}{R}",
    color_identity: ["red"],
    supertype: null,
    printed_types: null,
    card_type: def.cardType,
    subtypes: def.creature ? ["Giant"] : [],
    rarity: "uncommon",
    rules_text: "Fire deals 2 damage to any target.",
    flavor_text: "It was never going to be a quiet evening.",
    power: def.creature ? "4" : null,
    toughness: def.creature ? "3" : null,
    frame_style: { finish: "regular", template: kind },
    visibility: "public",
    back_face: {
      title: "Ice",
      card_type: def.backType,
      cost: "{1}{U}",
      supertype: "Legendary",
      subtypes: ["Arcane"],
      rules_text: "Tap target permanent.\nDraw a card.",
      flavor_text: "Cold comfort.",
      power: "1",
      toughness: "2",
      loyalty: "3",
      defense: "4",
      artist_credit: "Bo Marsh",
      art_url: "https://example.com/back.png",
      art_position: { focalX: 0.7, focalY: 0.25, scale: 1.15 },
    },
    set_icon_code: null,
    set_code: null,
    collector_number: null,
  } as unknown as Card;
}

/** A new card of `kind`, both parts filled through whatever the creator
 *  offers for them. */
async function newPartCard(kind: PartKind) {
  const def = PART_KINDS[kind];
  renderForm();
  await chip("Card type", def.chip);
  await chip("Color identity", /^red/i);
  await type("title", "Fire");
  await type("subtypes_text", def.creature ? "Giant" : "Arcane");
  await setArt("art_url");
  await type("artist_credit", "Anya Vale");
  await addPips("cost", ["Red"]);
  await typeRules("rules_text", "Fire deals 2 damage to any target.");
  await type("flavor_text", "\"A quiet evening\" - never.");
  if (def.creature) {
    await type("power", "4");
    await type("toughness", "3");
  }
  // The second part.
  await type("back_face.title", "Ice");
  await chip(`${def.second} card type`, new RegExp(`^${def.backType}`, "i"));
  await typeTestId("types-field-input-back", kind === "flip" ? "Legendary Creature" : "Legendary Sorcery");
  await type("back_face.subtypes_text", "Arcane, Trap");
  await addPips("back_face.cost", ["Blue", "Blue"]);
  await typeRules("back_face.rules_text", "Tap target permanent.\nDraw a card.");
  // What a NEW card's second part is offered (owner round 52): the fields
  // its frame draws — a flip side's power / toughness, a split or aftermath
  // half's own picture. Loyalty, defense, flavour, the artist credit, a
  // half's power / toughness and a flip side's picture are never drawn, so
  // they are hidden while empty (creator-second-part-hide.test.tsx).
  if (kind === "flip") {
    await type("back_face.power", "1");
    await type("back_face.toughness", "2");
  }
  if (kind === "split" || kind === "aftermath") await setArt("back_face.art_url");
  return save("createCardAction");
}

const PART_SCENARIOS: Record<string, () => Promise<unknown>> = Object.fromEntries(
  (Object.keys(PART_KINDS) as PartKind[]).flatMap((kind) => [
    [`new ${kind} card — both parts filled, every field the second part is offered`, () => newPartCard(kind)],
    [
      `stored ${kind} card — opened for an edit: the values the form holds`,
      async () => {
        renderForm({ mode: "edit", card: storedPartCard(kind) });
        return previewProps();
      },
    ],
    [
      `stored ${kind} card — an edit of the first part only keeps the second part as stored`,
      async () => {
        renderForm({ mode: "edit", card: storedPartCard(kind) });
        await typeRules("rules_text", "Fire deals 3 damage to any target.");
        return save("updateCardAction");
      },
    ],
    [
      `stored ${kind} card — an edit of the second part only keeps the rest of it as stored`,
      async () => {
        renderForm({ mode: "edit", card: storedPartCard(kind) });
        await typeRules("back_face.rules_text", "Tap up to two target permanents.");
        return save("updateCardAction");
      },
    ],
    // A stored value in a field the part never prints is on screen and
    // editable (an adventure's spell showed none of them on `origin/main`,
    // so its case is creator-second-part-hide.test.tsx's alone).
    ...(kind === "adventure"
      ? []
      : ([
          [
            `stored ${kind} card — an edit of two fields its second part never prints keeps the rest as stored`,
            async () => {
              renderForm({ mode: "edit", card: storedPartCard(kind) });
              await type("back_face.loyalty", "5");
              await type("back_face.flavor_text", "Colder comfort.");
              return save("updateCardAction");
            },
          ],
        ] as [string, () => Promise<unknown>][])),
  ]),
);
Object.assign(SCENARIOS, PART_SCENARIOS);

const FIXTURE = path.join(__dirname, "fixtures", "face-tabs-main-payloads.json");
const capturePath = process.env.FACE_TABS_CAPTURE;

describe("Face tabs moved the back's fields, not what a save sends", () => {
  if (capturePath) {
    it("records every scenario (run on the commit before Face tabs)", async () => {
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
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  it("the fixture holds every scenario", () => {
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
  it.each(Object.keys(SCENARIOS))("%s: identical to origin/main", async (name) => {
    const got = await SCENARIOS[name]();
    // Byte for byte, key order included — but for what TODO 4.26 adds to a
    // NEW split or aftermath card, each part in its own colour: the switch
    // ON (the new-card default on a frame that draws it) and the second
    // part's colour from its cost. Checked here, then taken out: the rest
    // of the payload is main's. (An edit sends neither: the stored cards'
    // scenarios are main's as they are.)
    expect(JSON.stringify(withoutPartColour(name, got), null, 2)).toBe(JSON.stringify(recorded[name], null, 2));
  }, 30_000);
});

/** A new split / aftermath / adventure card's 4.26 additions, asserted and
 *  removed (the adventure's: the spell's page in its own colour). */
function withoutPartColour(name: string, got: unknown): unknown {
  const payload = got as { frame_style?: Record<string, unknown>; back_face?: Record<string, unknown> | null } | null;
  const template = payload?.frame_style?.template;
  if (!payload?.frame_style || (template !== "split" && template !== "aftermath" && template !== "adventure") || !/^new /.test(name)) return got;
  expect(payload.frame_style.partColor, name).toBe(true);
  const frameStyle = { ...payload.frame_style };
  delete frameStyle.partColor;
  const out: Record<string, unknown> = { ...payload, frame_style: frameStyle };
  if (payload.back_face) {
    expect(payload.back_face.color_identity, name).toEqual(partColorFromCost(payload.back_face.cost as string));
    const back = { ...payload.back_face };
    delete back.color_identity;
    out.back_face = back;
  }
  return out;
}

describe("4.26's additions to a new two-part card", () => {
  it("are the only change the split, aftermath and adventure scenarios make", () => {
    expect(Object.keys(SCENARIOS).filter((n) => /^new (split|aftermath) /.test(n)).length).toBeGreaterThan(0);
    expect(Object.keys(SCENARIOS).filter((n) => /^new adventure /.test(n)).length).toBeGreaterThan(0);
  });
});

// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

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
          screen.queryByRole("tab", { name: /^Back face/ })?.getAttribute("aria-selected") === "true";
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
    // Byte for byte, key order included.
    expect(JSON.stringify(got, null, 2)).toBe(JSON.stringify(recorded[name], null, 2));
  }, 30_000);
});

// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FRAME_TEMPLATE_VALUES, type Card, type FrameTemplate, type GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The frame picker's groups (2026-10-13): extended art, the full-art basics
// and the textless frames moved from "Showcase & Universes Beyond" to the M15
// era's variations. A picker change — nothing about what a save sends may
// have moved.
//
// Each scenario drives the real CardCreatorForm (the driver of
// creator-face-tabs-payload.test.tsx: every control is found wherever the
// creator puts it) and records the payload the save hands to the server
// action: a new card that PICKS each moved frame, a colour change and a
// kind change on a card wearing one, an edit and a remix of a stored card
// on each (no Card step: the frame can't even be re-picked), and the values
// the form opens a stored card with.
//
// `fixtures/frame-picker-groups-main-payloads.json` is what THIS FILE
// recorded on `origin/main` c1c7b2e7 (and again, byte-identical, on 00bc2ca7 after #544) — the
// same file runs unchanged on both (a chip is found by either commit's
// label; the kind change answers main's "Switch frame era?" question, which
// the branch no longer asks, with "Switch to M15"). To re-record there:
//   FRAME_GROUPS_PAYLOAD_CAPTURE=<path/to/out.json> npx vitest run <this file>
// (Edited by hand 2026-10-30, one deliberate change: a NEW card's — and a
// key-less parent's remix's — `frame_style.collector` reads "off" where it
// read "2023", the collector line's new-card default (NEW_CARD_ANATOMY);
// a stored card's own "2023" is unchanged. Nothing else moved.)
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
// Every frame, every colour: the moved ones are offered whatever
// production has ticked.
const VERIFIED = FRAME_TEMPLATE_VALUES.flatMap((template) => EVERY_COLOUR.map((key) => frameComboKey(template, key)));


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
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function save(action: "createCardAction" | "updateCardAction") {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await click(saveButton());
  await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
  const call = actions[action].mock.calls[0];
  return JSON.parse(JSON.stringify(action === "createCardAction" ? call[0] : call[1])) as Record<string, unknown>;
}
const previewProps = () => JSON.parse(screen.getAllByTestId("card-preview")[0].dataset.props ?? "{}") as unknown;
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


/** A stored card on `template`, of the type that frame dresses. */
function storedCard(template: FrameTemplate): Card {
  const land = template === "m15fullartland" || template === "fullartland" || template === "m15textlessland";
  const basic = template === "m15fullartland" || template === "fullartland";
  return {
    id: CARD_ID,
    owner_id: USER,
    title: basic ? "Forest" : land ? "Mossy Reach" : "Thornback Stalker",
    slug: "stored-card",
    game_system_id: GAME,
    cost: land ? null : "{1}{G}",
    color_identity: ["green"],
    supertype: basic ? "Basic" : null,
    printed_types: null,
    card_type: land ? "land" : "creature",
    subtypes: basic ? ["Forest"] : land ? [] : ["Beast"],
    tags: ["test"],
    rarity: "rare",
    rules_text: basic ? null : land ? "{T}: Add {G}." : "Trample",
    flavor_text: basic ? null : "It was here first.",
    power: land ? null : "3",
    toughness: land ? null : "3",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.31, focalY: 0.62, scale: 1.4 },
    frame_style: { finish: "regular", template },
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

/** A Variations chip by either commit's label ("Full Art — Basic Land" on
 *  main, "Full-Art Basic Land" after the move). */
const VARIATION: Record<string, RegExp> = {
  extendedart: /^Extended Art/,
  m15fullartland: /^(Full Art — Basic Land|Full-Art Basic Land)/,
  fullartland: /^(Full Art — Borderless Basic Land|Borderless Full-Art Basic Land)/,
  m15textless: /^(Full Art — Textless|Textless)(?! Land)/,
  m15textlessland: /^(Full Art — Textless Land|Textless Land)/,
};
const MOVED = Object.keys(VARIATION) as FrameTemplate[];
const LAND_FRAMES = new Set<string>(["m15fullartland", "fullartland", "m15textlessland"]);

async function fillCreature() {
  await type("title", "Thornback Stalker");
  await type("subtypes_text", "Beast");
  await setArt("art_url");
  await type("artist_credit", "Anya Vale");
  await typeRules("rules_text", "Trample");
  await type("power", "3");
  await type("toughness", "3");
}
async function fillLand(basic: boolean) {
  await type("title", basic ? "Forest" : "Mossy Reach");
  await setArt("art_url");
  await type("artist_credit", "Anya Vale");
  if (!basic) await typeRules("rules_text", "{T}: Add {G}.");
}
/** Main asks "Switch frame era?" when a card leaves a showcase frame for
 *  another kind; the answer every scenario gives is "Switch to M15". */
async function answerEraQuestion() {
  const button = screen.queryByRole("button", { name: /Switch to M15/ });
  if (button) await click(button);
}

const SCENARIOS: Record<string, () => Promise<unknown>> = {
  ...Object.fromEntries(
    MOVED.flatMap((template): [string, () => Promise<unknown>][] => {
      const land = LAND_FRAMES.has(template);
      const basic = template === "m15fullartland" || template === "fullartland";
      const start = async () => {
        renderForm();
        await chip("Card type", land ? /^Land/ : /^Creature/);
        if (land) await chip("Land type", basic ? /^Basic/ : /^Nonbasic/);
        await chip("Color identity", /^green/i);
        await chip("Frame variations", VARIATION[template]);
        if (land) await fillLand(basic);
        else await fillCreature();
      };
      return [
        [
          `new card — picks ${template}`,
          async () => {
            await start();
            return save("createCardAction");
          },
        ],
        [
          `new card on ${template} — the colour changes to blue`,
          async () => {
            await start();
            await chip("Color identity", /^blue/i);
            return save("createCardAction");
          },
        ],
        [
          `new card on ${template} — the kind changes to ${land ? "Creature" : "Instant"}`,
          async () => {
            await start();
            await chip("Card type", land ? /^Creature/ : /^Instant/);
            await answerEraQuestion();
            if (land) {
              await type("title", "Mossy Walker");
              await type("power", "2");
              await type("toughness", "2");
            }
            return save("createCardAction");
          },
        ],
        [
          `stored card on ${template} — opened for an edit: the values the form holds`,
          async () => {
            renderForm({ mode: "edit", card: storedCard(template) });
            return previewProps();
          },
        ],
        [
          `stored card on ${template} — an edit of its artist keeps its frame as stored`,
          async () => {
            renderForm({ mode: "edit", card: storedCard(template) });
            await type("artist_credit", "Bo Marsh");
            return save("updateCardAction");
          },
        ],
        [
          `stored card on ${template} — a remix with a new name`,
          async () => {
            renderForm({ mode: "remix", card: storedCard(template) });
            await type("title", basic ? "Forest" : "Renamed Remix");
            await type("artist_credit", "Bo Marsh");
            return save("createCardAction");
          },
        ],
      ];
    }),
  ),
};

const FIXTURE = path.join(__dirname, "fixtures", "frame-picker-groups-main-payloads.json");
const capturePath = process.env.FRAME_GROUPS_PAYLOAD_CAPTURE;

describe("the frame picker's groups moved five frames, not what a save sends", () => {
  if (capturePath) {
    it("records every scenario (run on the commit before the move)", async () => {
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
    }, 300_000);
    return;
  }
  const recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  it("the fixture holds every scenario", () => {
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
  it("every new card saved on the frame it picked", () => {
    for (const template of MOVED) {
      const payload = recorded[`new card — picks ${template}`] as { frame_style?: { template?: string } };
      expect(payload.frame_style?.template, template).toBe(template);
    }
  });
  it.each(Object.keys(SCENARIOS))("%s: identical to origin/main", async (name) => {
    const got = await SCENARIOS[name]();
    // Byte for byte, key order included.
    expect(JSON.stringify(got, null, 2)).toBe(JSON.stringify(recorded[name], null, 2));
  }, 30_000);
});

// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, FaceContent, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveStationTiers } from "@/lib/cards/station";
import { STATION_TIER_LIMIT_NOTE } from "@/lib/creator/station-rows";
import { PT_NEEDS_TIER_NOTE } from "@/lib/cards/pt-drawn";
import { updateCardSchema } from "@/lib/validation/card";
import { withPrintTypographyUpdate } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// The station frame's TIER EDITOR (TODO 4.27a, PR 2), through the real
// CardCreatorForm: an edit never changes a field or a drawing its maker did
// not touch, and never drops a change they made.
//
// The path PR 1 left open (the independent check of #543): on a card stored
// with rows — `face_content.station`, which can put the power / toughness on
// a tier the TEXT would not — typing one word anywhere in the rules text
// dropped the rows, and the plate went back to the tier the text plates.
// Here every edited save carries the rows with the plate where the maker has
// it; an untouched save sends neither the rows nor a rewritten text; a card
// stored as plain text is given no rows until it is edited; and a shape the
// editor cannot show as rows (a fourth tier line) stays in the text.
//
// Every `sent` payload is what the form handed the server action; they are
// also run through the SERVER's schema and its typography pass.
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
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15artifact", "m15land", "m15station", "m15stationland"].flatMap((t) =>
  ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)),
);

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
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
    flavor_text: "\"Hold the line.\"",
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
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
    ...overrides,
  } as unknown as Card;
}

function renderForm(
  mode: "create" | "edit" | "remix",
  card?: Card,
  viewer: { isPaid?: boolean; defaultFooterText?: string | null } = {},
) {
  return render(
    <CardCreatorForm
      mode={mode}
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      {...viewer}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  });
};
const field = (name: string) => {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
};
const type = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(name), { target: { value } });
  });
};
/** The pip editors (a walker's rows, a saga's chapters) are contenteditable
 *  boxes named by `data-field`. */
const typeRich = async (name: string, value: string) => {
  const el = document.querySelector(`[data-field="${name}"]`);
  if (!el) throw new Error(`no editor named ${name}`);
  await act(async () => {
    el.textContent = value;
    fireEvent.input(el);
  });
};
const goTo = async (step: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
  });
};
const sentUpdate = async () => {
  await save();
  await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
  return actions.updateCardAction.mock.calls[0][1] as Record<string, unknown>;
};
const sentCreate = async () => {
  await save();
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
};



const REMINDER =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)";
const TEXT = `Flying\n${REMINDER}\n3+ | Other creatures you control get +1/+1.\n6+ | Whenever this Spacecraft attacks, draw a card.\n9+ | Flying, "lifelink"`;
/** The plate on 6+ — a tier the text (its reminder names 9+) would not plate. */
const ROWS: FaceContent = {
  v: 1,
  station: {
    intro: `Flying\n${REMINDER}`,
    tiers: [
      { threshold: 3, text: "Other creatures you control get +1/+1." },
      { threshold: 6, text: "Whenever this Spacecraft attacks, draw a card.", pt: true },
      { threshold: 9, text: 'Flying, "lifelink"' },
    ],
  },
};
const craft = (rules_text: string, face_content: unknown = null, over: Record<string, unknown> = {}) =>
  savedCard({
    title: "Lumen-Class Frigate",
    cost: "{2}{U}",
    color_identity: ["blue"],
    supertype: null,
    card_type: "artifact",
    subtypes: ["Spacecraft"],
    flavor_text: null,
    power: "3",
    toughness: "5",
    rules_text,
    face_content,
    frame_style: { finish: "regular", template: "m15station" },
    ...over,
  });

const serverTakes = (payload: Record<string, unknown>) => updateCardSchema.safeParse(payload).success;
const afterServer = (payload: Record<string, unknown>, card: Card) =>
  withPrintTypographyUpdate(payload as never, card as never) as unknown as Record<string, unknown>;
const platedOf = (payload: Record<string, unknown>) =>
  resolveStationTiers(payload.face_content as FaceContent | null, payload.rules_text as string, true).tiers.findIndex((t) => t.pt);
const tiersOf = (payload: Record<string, unknown>) =>
  resolveStationTiers(payload.face_content as FaceContent | null, payload.rules_text as string, true).tiers.map((t) => [t.threshold, t.text]);

const open = async (card: Card, mode: "edit" | "remix" = "edit") => {
  renderForm(mode, card);
  await goTo("Text & stats");
};
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const setNumber = async (tier: number, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(`Tier ${tier} charge counters`), { target: { value } });
  });
};

describe("a station card stored WITH rows (the plate on a tier the text would not plate)", () => {
  it("opens as rows: the top band, three tiers, the P/T on tier 2", async () => {
    await open(craft(TEXT, ROWS));
    expect(document.querySelector('[data-field="station_intro"]')?.textContent).toContain("Station (Tap another creature");
    expect((screen.getByLabelText("Tier 1 charge counters") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Tier 3 charge counters") as HTMLInputElement).value).toBe("9");
    const radios = screen.getAllByRole("radio", { name: "Power / toughness on this tier" }) as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    // The ordinary rules box is not shown beside it.
    expect(document.querySelector('[data-field="rules_text"]')).toBeNull();
  });

  it("a title-only edit sends neither the rows nor another text", async () => {
    const card = craft(TEXT, ROWS);
    renderForm("edit", card);
    await type("title", "Lumen-Class Cruiser");
    const sent = await sentUpdate();
    expect(sent.title).toBe("Lumen-Class Cruiser");
    expect("face_content" in sent).toBe(false);
    expect(sent.rules_text).toBe(TEXT);
    expect(serverTakes(sent)).toBe(true);
    expect(afterServer(sent, card).rules_text).toBe(TEXT);
  });

  it("THE PATH PR 1 LEFT OPEN — a word typed in the top band keeps the rows and the plate on 6+", async () => {
    const card = craft(TEXT, ROWS);
    await open(card);
    await typeRich("station_intro", `Flying, vigilance\n${REMINDER}`);
    const sent = await sentUpdate();
    expect(platedOf(sent)).toBe(1);
    expect((sent.face_content as FaceContent).station!.tiers).toEqual(ROWS.station!.tiers);
    expect((sent.face_content as FaceContent).station!.intro).toBe(`Flying, vigilance\n${REMINDER}`);
    expect(sent.rules_text).toBe(TEXT.replace("Flying\n", "Flying, vigilance\n"));
    expect(serverTakes(sent)).toBe(true);
    // The server's typography pass leaves the tiers the maker did not edit as stored (the straight quotes of 9+).
    const stored = afterServer(sent, card);
    expect((stored.face_content as FaceContent).station!.tiers[2]!.text).toBe('Flying, "lifelink"');
    expect(platedOf(stored)).toBe(1);
  });

  it("editing ONE tier's text changes that tier alone — and only it is set in print typography", async () => {
    const card = craft(TEXT, ROWS);
    await open(card);
    await typeRich("station_tier_0", `Other creatures you control get +2/+2 and "ward".`);
    const sent = await sentUpdate();
    expect(tiersOf(sent)).toEqual([
      [3, `Other creatures you control get +2/+2 and "ward".`],
      [6, "Whenever this Spacecraft attacks, draw a card."],
      [9, 'Flying, "lifelink"'],
    ]);
    expect(platedOf(sent)).toBe(1);
    const stored = afterServer(sent, card);
    expect(tiersOf(stored)).toEqual([
      [3, "Other creatures you control get +2/+2 and “ward”."],
      [6, "Whenever this Spacecraft attacks, draw a card."],
      [9, 'Flying, "lifelink"'],
    ]);
    expect(stored.rules_text).toContain('9+ | Flying, "lifelink"');
    expect(stored.rules_text).toContain("3+ | Other creatures you control get +2/+2 and “ward”.");
  });

  it("moving the P/T to another tier is saved, with every text as it was", async () => {
    await open(craft(TEXT, ROWS));
    await click(screen.getAllByRole("radio", { name: "Power / toughness on this tier" })[0]!);
    const sent = await sentUpdate();
    expect(platedOf(sent)).toBe(0);
    expect(tiersOf(sent)).toEqual(ROWS.station!.tiers.map((t) => [t.threshold, t.text]));
    expect(sent.rules_text).toBe(TEXT);
    expect(serverTakes(sent)).toBe(true);
  });

  it("a threshold changed, a tier removed: the other rows and the plate's tier follow", async () => {
    await open(craft(TEXT, ROWS));
    await setNumber(2, "7");
    await click(screen.getByRole("button", { name: "Remove tier 1" }));
    const sent = await sentUpdate();
    expect(tiersOf(sent)).toEqual([
      [7, "Whenever this Spacecraft attacks, draw a card."],
      [9, 'Flying, "lifelink"'],
    ]);
    // The plate was on the old tier 2 — now the first.
    expect(platedOf(sent)).toBe(0);
    expect(serverTakes(sent)).toBe(true);
  });

  it("removing the plated tier puts the P/T where the text says (9+); removing every tier clears the rows", async () => {
    await open(craft(TEXT, ROWS));
    await click(screen.getByRole("button", { name: "Remove tier 2" }));
    let sent = await sentUpdate();
    expect(tiersOf(sent).map(([n]) => n)).toEqual([3, 9]);
    expect(platedOf(sent)).toBe(1);
    cleanup();
    actions.updateCardAction.mockClear();

    await open(craft(TEXT, ROWS));
    for (let i = 0; i < 3; i++) await click(screen.getByRole("button", { name: "Remove tier 1" }));
    sent = await sentUpdate();
    expect(sent.face_content).toBeNull();
    expect(sent.rules_text).toBe(`Flying\n${REMINDER}`);
  });

  it("a FOURTH tier is refused with a message; a number that is not one never reaches the card", async () => {
    await open(craft(TEXT, ROWS));
    expect(screen.queryByTestId("station-tier-limit")).toBeNull();
    await click(screen.getByTestId("station-add-tier"));
    expect(screen.getByTestId("station-tier-limit").textContent).toBe(STATION_TIER_LIMIT_NOTE);
    expect(screen.queryByLabelText("Tier 4 charge counters")).toBeNull();
    await setNumber(1, "");
    expect(screen.getByLabelText("Tier 1 charge counters").getAttribute("aria-invalid")).toBe("true");
    await goTo("Identity");
    await type("title", "Lumen-Class Cruiser");
    const sent = await sentUpdate();
    // Nothing about the tiers was changed: the card stays as stored.
    expect("face_content" in sent).toBe(false);
    expect(sent.rules_text).toBe(TEXT);
  });

  it("a remix (a new card) carries the rows and the plate's tier", async () => {
    renderForm("remix", craft(TEXT, ROWS));
    await type("title", "Lumen-Class Remix");
    const sent = await sentCreate();
    expect(platedOf(sent)).toBe(1);
    // (A remix is a NEW card: its text is set in print typography whole — the quotes of 9+ included.)
    expect(tiersOf(sent)).toEqual(ROWS.station!.tiers.map((t) => [t.threshold, t.text.replace(/"(\w+)"/, "“$1”")]));
  });
});

describe("a station card stored as PLAIN TEXT", () => {
  // Spelled as no editor writes it: no space round the bar, a blank line.
  const PLAIN = `Flying\n\n${REMINDER}\n3+|Other creatures you control get +1/+1.\n9+ |  Flying, lifelink`;

  it("opens into rows without being rewritten: a title-only edit sends the stored text, byte for byte, and no rows", async () => {
    const card = craft(PLAIN);
    await open(card);
    expect((screen.getByLabelText("Tier 2 charge counters") as HTMLInputElement).value).toBe("9");
    expect((screen.getAllByRole("radio", { name: "Power / toughness on this tier" }) as HTMLInputElement[]).map((r) => r.checked)).toEqual([false, true]);
    await goTo("Identity");
    await type("title", "Lumen-Class Cruiser");
    const sent = await sentUpdate();
    expect("face_content" in sent).toBe(false);
    expect(sent.rules_text).toBe(PLAIN);
  });

  it("an added tier is saved as rows beside the canonical text, the P/T where the reminder says", async () => {
    await open(craft(PLAIN));
    await click(screen.getByTestId("station-add-tier"));
    expect((screen.getByLabelText("Tier 3 charge counters") as HTMLInputElement).value).toBe("13");
    // A tier with no text is asked for before the save goes out.
    await save();
    expect(actions.updateCardAction).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Tier 3 \(13\+\) has no text yet/).length).toBeGreaterThan(0);
    await typeRich("station_tier_2", "Trample");
    const sent = await sentUpdate();
    expect(tiersOf(sent)).toEqual([
      [3, "Other creatures you control get +1/+1."],
      [9, "Flying, lifelink"],
      [13, "Trample"],
    ]);
    expect(platedOf(sent)).toBe(1);
    expect(sent.rules_text).toBe(`Flying\n\n${REMINDER}\n3+ | Other creatures you control get +1/+1.\n9+ | Flying, lifelink\n13+ | Trample`);
    expect(serverTakes(sent)).toBe(true);
  });

  it("numbers that do not rise are asked for, never saved short", async () => {
    await open(craft(PLAIN));
    await setNumber(2, "2");
    await save();
    expect(actions.updateCardAction).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Tier numbers rise down the card: tier 2 is 2\+ under 3\+/).length).toBeGreaterThan(0);
  });

  it("a fourth tier LINE in the text is kept as typed and said so — nothing is dropped by an edit elsewhere", async () => {
    const four = `${REMINDER}\n3+ | Flying\n6+ | Vigilance\n9+ | Trample\n12+ | Indestructible`;
    await open(craft(four));
    expect(screen.getByTestId("station-extra-tier").textContent).toContain("12+ | Indestructible");
    await typeRich("station_tier_0", "Flying, haste");
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe(four.replace("3+ | Flying", "3+ | Flying, haste"));
    expect((sent.face_content as FaceContent).station!.tiers).toHaveLength(3);
    expect((sent.face_content as FaceContent).station!.tiers[2]!.text).toBe("Trample\n12+ | Indestructible");
  });

  it("no tier and a P/T: the note under the inputs says where this frame prints it", async () => {
    await open(craft(`Flying\n${REMINDER}`));
    expect(screen.getByTestId("pt-not-drawn-note-front").textContent).toBe(PT_NEEDS_TIER_NOTE);
    await click(screen.getByTestId("station-add-tier"));
    expect(screen.queryByTestId("pt-not-drawn-note-front")).toBeNull();
  });
});

describe("stored rows that say another text than the rules text (written by the API)", () => {
  it("the editor shows the ROWS; an untouched save still sends the stored text, and an edit writes the rows' own", async () => {
    const other = "Flying\n3+ | An older wording.";
    const card = craft(other, ROWS);
    await open(card);
    expect((screen.getByLabelText("Tier 3 charge counters") as HTMLInputElement).value).toBe("9");
    await goTo("Identity");
    await type("title", "Lumen-Class Cruiser");
    let sent = await sentUpdate();
    expect("face_content" in sent).toBe(false);
    expect(sent.rules_text).toBe(other);
    cleanup();
    actions.updateCardAction.mockClear();

    await open(card);
    await typeRich("station_tier_2", "Flying, lifelink, trample");
    sent = await sentUpdate();
    expect(platedOf(sent)).toBe(1);
    expect(tiersOf(sent)[2]).toEqual([9, "Flying, lifelink, trample"]);
    expect(sent.rules_text).toContain("6+ | Whenever this Spacecraft attacks, draw a card.");
  });

  // The independent check of #549: OFF the station frame nothing draws the
  // rows — the card draws its rules text. The form opened such a card with
  // the rows' text all the same, and a title-only edit stored it in place
  // of the card's own (on main: the stored text, byte for byte).
  it("on a card that is NOT on a station frame the rules box shows the card's own text, and a title-only edit keeps it", async () => {
    const other = "Flying\n3+ | An older wording.";
    const card = craft(other, ROWS, { frame_style: { finish: "regular", template: "m15artifact" } });
    renderForm("edit", card);
    await type("title", "Lumen-Class Cruiser");
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe(other);
    expect("face_content" in sent).toBe(false);
    expect(afterServer(sent, card).rules_text).toBe(other);
  });
});

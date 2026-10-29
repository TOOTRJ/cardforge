// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { createCardSchema } from "@/lib/validation/card";
import { sagaReminder } from "@/lib/ai/layout-design";
import { fitArtToWindow } from "@/lib/cards/art-fit";

// ---------------------------------------------------------------------------
// The AI dialog's sagas and two-part cards (PR 2), through the REAL
// CardCreatorForm: the fill the job hands back is poured into the creator's
// OWN paths — a saga's rules text into its chapter rows, a second part into
// `back_face.*`, the part-colour switch and the first half's colour into
// `frame_style` — and the creator's own save writes them exactly as it
// writes a card made by hand (face_content rows, back_face, partColor /
// firstPartColor, the WHOLE card's colour_identity).
//
// The dialog is a stand-in that asks for a kind; the jobs API is a stubbed
// fetch handing back the fill a step hands (tests/unit/ai/
// layout-fill-jobs.test.ts holds the job to it). No generation is run.
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
const confirm = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("@/components/billing/credit-confirm-provider", () => ({
  useCreditConfirm: () => async (options: Record<string, unknown>) => {
    confirm.calls.push(options);
    return true;
  },
}));
const actions = vi.hoisted(() => ({ createCardAction: vi.fn(), updateCardAction: vi.fn() }));
vi.mock("@/lib/cards/actions", () => actions);
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
const EVERY_FIELD = ["card_type", "color_identity", "title", "cost", "rarity", "rules_text", "flavor_text", "stats", "art"];
const dialog = vi.hoisted(() => ({ kind: "saga", want: null as string[] | null }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ onGenerate }: { onGenerate: (options: Record<string, unknown>) => void }) => (
    <button
      type="button"
      data-testid="run-fill"
      onClick={() =>
        onGenerate({
          want: dialog.want ?? EVERY_FIELD,
          design_kind: dialog.kind,
          frame: dialog.kind,
        })
      }
    >
      run fill
    </button>
  ),
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = ["m15", "m15artifact", "m15land", "saga", "split", "aftermath", "adventure", "prepare", "flip"].flatMap((t) => COLOURS.map((k) => frameComboKey(t, k)));
const ART = `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png`;

const jobs = { posted: [] as Record<string, unknown>[], fill: {} as Record<string, unknown> };

beforeEach(() => {
  jobs.posted = [];
  confirm.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/ai/jobs") {
        jobs.posted.push(JSON.parse(init!.body!) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, job: { id: "job-1" }, credits: 5 }), { status: 200 });
      }
      if (String(url).startsWith("/api/ai/jobs/job-1/step")) {
        return new Response(JSON.stringify({ ok: true, credits: 4, job: { steps: [{ status: "done", fill: jobs.fill }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "card-1", slug: "made" });
});
afterEach(() => {
  dialog.want = null;
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

/** Run the fill for `kind` on a new card and save it: what the creator's
 *  own save hands the server. */
async function fillAndSave(kind: string, fill: Record<string, unknown>, verified: string[] = VERIFIED, beforeFill?: () => Promise<void>) {
  dialog.kind = kind;
  jobs.fill = { art_url: ART, artist_credit: "Tester", deck_id: null, rarity: "uncommon", ...fill };
  render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={verified} />);
  if (beforeFill) await beforeFill();
  await click(screen.getByTestId("run-fill"));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
  await waitFor(() => expect(save().disabled).toBe(false));
  await click(save());
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  const payload = JSON.parse(JSON.stringify(actions.createCardAction.mock.calls[0]![0])) as Record<string, unknown>;
  // The server's own schema reads it as a valid create.
  expect(createCardSchema.safeParse(payload).success).toBe(true);
  return payload;
}

describe("a saga from the AI dialog", () => {
  it("its rules text becomes the chapter rows, and the save writes them as face_content", async () => {
    const rules = `${sagaReminder(3)}\nI — Draw a card.\nII, III — Create a 2/2 green Bear creature token.`;
    const sent = await fillAndSave("saga", {
      title: "The Long Thaw",
      cost: "{2}{G}",
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      color_identity: ["green"],
      rules_text: rules,
      flavor_text: null,
      power: null,
      toughness: null,
      frame_template: "saga",
    });
    expect(jobs.posted[0]).toMatchObject({ kind: "card_fill", design_kind: "saga" });
    // The one credit, said in the confirm.
    expect(confirm.calls[0]).toMatchObject({ cost: 1 });
    expect(sent).toMatchObject({
      title: "The Long Thaw",
      card_type: "enchantment",
      subtypes: ["Saga"],
      color_identity: ["green"],
      frame_style: expect.objectContaining({ template: "saga" }),
      face_content: {
        v: 1,
        saga: {
          intro: sagaReminder(3),
          chapters: [
            { numerals: [1], text: "Draw a card." },
            { numerals: [2, 3], text: "Create a 2/2 green Bear creature token." },
          ],
        },
      },
    });
    expect(sent.rules_text).toBe(rules);
    expect(sent.back_face ?? null).toBeNull();
  });
});

describe("a two-part card from the AI dialog: its second part in back_face, as the creator saves one", () => {
  it("split — the second half and each part's colour; color_identity the whole card's", async () => {
    const sent = await fillAndSave("split", {
      title: "Emberlash",
      cost: "{1}{R}",
      card_type: "instant",
      supertype: null,
      subtypes: [],
      color_identity: ["red", "blue", "multicolor"],
      rules_text: "Emberlash deals 2 damage to any target.",
      flavor_text: null,
      power: null,
      toughness: null,
      frame_template: "split",
      back_face: { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{1}{U}", rules_text: "Tap target permanent. Draw a card.", color_identity: ["blue"], art_url: ART },
      part_color: true,
      first_part_color: ["red"],
    });
    // The one picture, in the confirm's words.
    expect(confirm.calls[0]!.description).toContain("paints its one picture");
    expect(sent).toMatchObject({
      card_type: "instant",
      frame_style: expect.objectContaining({ template: "split", partColor: true, firstPartColor: ["red"] }),
      back_face: { title: "Frostbind", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent. Draw a card.", color_identity: ["blue"] },
    });
    // The whole card: red and blue, the creator's single-select gold (as
    // a Fire // Ice import saves it — M2), never the first half's red.
    expect(sent.color_identity).toEqual(["multicolor"]);
    // The right half's own window: the SAME stored picture (owner
    // 2026-10-28), fitted to its window as any picture that lands is.
    expect(sent.back_face).toMatchObject({ art_url: ART, art_position: fitArtToWindow() });
    expect(sent.art_url).toBe(ART);
  });

  it("a second run on the same kind pins the second part's kept fields and never overwrites them", async () => {
    const back = { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{1}{U}", rules_text: "Tap target permanent. Draw a card.", color_identity: ["blue"] };
    dialog.kind = "split";
    jobs.fill = {
      art_url: ART,
      title: "Emberlash",
      cost: "{1}{R}",
      card_type: "instant",
      supertype: null,
      subtypes: [],
      color_identity: ["red", "blue", "multicolor"],
      rules_text: "Emberlash deals 2 damage to any target.",
      frame_template: "split",
      back_face: back,
      part_color: true,
      first_part_color: ["red"],
    };
    render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // The first run: the card wasn't of the kind yet — nothing pinned.
    expect(jobs.posted[0]!.locked).not.toHaveProperty("back_face");
    // The maker keeps the names and the rules; the AI rewrites the costs.
    dialog.want = ["card_type", "cost"];
    jobs.fill = { card_type: "instant", supertype: null, subtypes: [], cost: "{R}", frame_template: "split", back_face: { card_type: "instant", supertype: null, subtypes: [], cost: "{U}", color_identity: ["blue"] }, part_color: true, first_part_color: ["red"] };
    toast.success.mockClear();
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(jobs.posted[1]!.locked).toMatchObject({ back_face: { title: "Frostbind", rules_text: "Tap target permanent. Draw a card." } });
    expect((jobs.posted[1]!.locked as { back_face: Record<string, unknown> }).back_face).not.toHaveProperty("cost");
    actions.createCardAction.mockClear();
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const sent = actions.createCardAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.back_face).toMatchObject({ title: "Frostbind", cost: "{U}", rules_text: "Tap target permanent. Draw a card." });
  });

  it("adventure — the spell on its page, an Adventure", async () => {
    const sent = await fillAndSave("adventure", {
      title: "Hearthwood Giant",
      cost: "{3}{G}",
      card_type: "creature",
      supertype: null,
      subtypes: ["Giant"],
      color_identity: ["green"],
      rules_text: "Reach",
      flavor_text: null,
      power: "4",
      toughness: "4",
      frame_template: "adventure",
      back_face: { card_type: "instant", supertype: null, subtypes: ["Adventure"], title: "Stomp Through", cost: "{1}{G}", rules_text: "Target creature you control gets +2/+2 until end of turn.", color_identity: ["green"] },
      part_color: true,
    });
    expect(sent).toMatchObject({
      card_type: "creature",
      power: "4",
      frame_style: expect.objectContaining({ template: "adventure", partColor: true }),
      back_face: { title: "Stomp Through", card_type: "instant", subtypes: ["Adventure"], cost: "{1}{G}" },
    });
  });

  it("aftermath — the aftermath half in its own colour", async () => {
    const sent = await fillAndSave("aftermath", {
      title: "Cleave",
      cost: "{2}{R}",
      card_type: "sorcery",
      supertype: null,
      subtypes: [],
      color_identity: ["red", "green", "multicolor"],
      rules_text: "Cleave deals 4 damage to target creature.",
      flavor_text: null,
      power: null,
      toughness: null,
      frame_template: "aftermath",
      back_face: {
        card_type: "sorcery",
        supertype: null,
        subtypes: [],
        title: "Regrowth Rite",
        cost: "{3}{G}",
        rules_text: "Aftermath (Cast this spell only from your graveyard. Then exile it.)\nCreate two 2/2 green Wolf creature tokens.",
        color_identity: ["green"],
        art_url: ART,
      },
      part_color: true,
      first_part_color: ["red"],
    });
    expect(sent).toMatchObject({
      card_type: "sorcery",
      color_identity: ["multicolor"],
      frame_style: expect.objectContaining({ template: "aftermath", partColor: true, firstPartColor: ["red"] }),
      back_face: { title: "Regrowth Rite", cost: "{3}{G}", card_type: "sorcery", color_identity: ["green"], art_url: ART, art_position: fitArtToWindow() },
    });
  });

  it("prepare — the spell on its page", async () => {
    const sent = await fillAndSave("prepare", {
      title: "Lantern Scholar",
      cost: "{2}{W}",
      card_type: "creature",
      supertype: null,
      subtypes: ["Human", "Cleric"],
      color_identity: ["white"],
      rules_text: "Flying\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
      flavor_text: null,
      power: "2",
      toughness: "3",
      frame_template: "prepare",
      back_face: { card_type: "sorcery", supertype: null, subtypes: [], title: "Gentle Recall", cost: "{W}", rules_text: "You gain 3 life.", color_identity: ["white"] },
      part_color: true,
    });
    expect(sent).toMatchObject({
      card_type: "creature",
      frame_style: expect.objectContaining({ template: "prepare", partColor: true }),
      back_face: { title: "Gentle Recall", cost: "{W}", card_type: "sorcery", rules_text: "You gain 3 life." },
    });
  });

  it("flip — the flipped side with its own power / toughness and no cost", async () => {
    const sent = await fillAndSave("flip", {
      title: "Ashen Apprentice",
      cost: "{1}{R}",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Wizard"],
      color_identity: ["red"],
      rules_text: "Whenever you cast an instant or sorcery spell, put a ki counter on Ashen Apprentice. Then if it has two or more ki counters on it, flip it.",
      flavor_text: null,
      power: "1",
      toughness: "2",
      frame_template: "flip",
      back_face: { card_type: "creature", supertype: "Legendary", subtypes: ["Human", "Wizard"], title: "Ashen Pyromancer", rules_text: "Whenever you cast an instant or sorcery spell, Ashen Pyromancer deals 1 damage to each opponent.", power: "3", toughness: "3" },
    });
    expect(sent).toMatchObject({
      frame_style: expect.objectContaining({ template: "flip" }),
      back_face: { title: "Ashen Pyromancer", card_type: "creature", supertype: "Legendary", power: "3", toughness: "3" },
    });
    expect(sent.back_face).not.toHaveProperty("cost");
  });
});

// The #636 check, through the real form: the second part the plan judged is
// the one the form holds — a name and cost the maker didn't tick, no stale
// field from another kind — and an AI landing is no misleading frame toast.
describe("the fill the plan judged is the card the form saves (the #636 check)", () => {
  const SPLIT_FRONT = {
    title: "Emberlash",
    cost: "{1}{U}",
    card_type: "instant",
    supertype: null,
    subtypes: [],
    color_identity: ["blue"],
    rules_text: "Draw two cards.",
    flavor_text: null,
    power: null,
    toughness: null,
    frame_template: "split",
  };

  it("Title and Cost unticked on a new card: the half's name and cost come from the AI, so Save is not blocked", async () => {
    dialog.want = ["card_type", "color_identity", "rules_text", "art"];
    // What the step hands for those ticks now (fillSecondPartOf: an unticked
    // field the card holds no value for is written).
    const sent = await fillAndSave("split", {
      card_type: "instant",
      supertype: null,
      subtypes: [],
      color_identity: ["blue"],
      rules_text: "Draw two cards.",
      frame_template: "split",
      back_face: { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{1}{U}", rules_text: "Tap target permanent.", color_identity: ["blue"], art_url: ART },
      part_color: true,
    }, VERIFIED, async () => {
      // The maker's own front title (kept: Title unticked).
      await click(screen.getAllByTitle("Go to Identity")[0]!);
      const title = document.querySelector<HTMLInputElement>("input[name='title']")!;
      await act(async () => {
        fireEvent.change(title, { target: { value: "Emberlash" } });
        fireEvent.blur(title);
      });
    });
    expect(jobs.posted[0]!.locked).toMatchObject({ title: "Emberlash" });
    expect(sent.title).toBe("Emberlash");
    expect(sent.back_face).toMatchObject({ title: "Frostbind", cost: "{1}{U}", color_identity: ["blue"] });
    expect(sent.frame_style).toMatchObject({ partColor: true });
  });

  it("onto another kind: the old second part's fields are gone (a flip side's P/T never rides onto a split half)", async () => {
    dialog.kind = "flip";
    jobs.fill = {
      art_url: ART,
      title: "Ashen Apprentice",
      cost: "{1}{R}",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human"],
      color_identity: ["red"],
      rules_text: "Haste",
      power: "1",
      toughness: "2",
      frame_template: "flip",
      back_face: { card_type: "creature", supertype: "Legendary", subtypes: ["Human"], title: "Ashen Pyromancer", rules_text: "Haste", power: "3", toughness: "3" },
    };
    render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    toast.success.mockClear();
    dialog.kind = "split";
    jobs.fill = { ...SPLIT_FRONT, back_face: { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{U}", rules_text: "Tap target permanent.", color_identity: ["blue"], art_url: ART }, part_color: true };
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(JSON.stringify(actions.createCardAction.mock.calls[0]![0])) as { back_face: Record<string, unknown> };
    expect(sent.back_face).toMatchObject({ title: "Frostbind", card_type: "instant" });
    for (const key of ["power", "toughness", "supertype"]) expect(sent.back_face, key).not.toHaveProperty(key);
  });

  it("a new (colourless) card filled as a blue split: no 'isn't available in colorless' toast — the kind is judged in the fill's colour", async () => {
    const blueSplitOnly = [...VERIFIED.filter((key) => !key.startsWith("split/")), frameComboKey("split", "u")];
    await fillAndSave(
      "split",
      { ...SPLIT_FRONT, back_face: { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{U}", rules_text: "Tap target permanent.", color_identity: ["blue"], art_url: ART }, part_color: true },
      blueSplitOnly,
    );
    const infos = toast.info.mock.calls.map((call) => String(call[0]));
    expect(infos.filter((message) => /isn't available in|Switched to/.test(message))).toEqual([]);
  });
});

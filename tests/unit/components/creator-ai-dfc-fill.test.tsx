// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate, type GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { createCardSchema } from "@/lib/validation/card";
import { dfcBackArtMissing, dfcFrontColorError, dfcFrontTypeError, resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { frameGateError } from "@/lib/cards/frame-availability";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { printTypography } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// The AI dialog's double-faced cards (PR 3), through the REAL
// CardCreatorForm: the job's TWO steps — the front's text and picture, then
// the back's own picture — are poured into the creator's OWN paths (the
// kind, its front body, `back_face.*` with its own colour and picture), and
// the creator's own save sends what the server's gates take: each payload
// is run through the same gates createCardAction runs (the kind gate, the
// front's type and colour rules, the published frame, resolveDfcBackFace)
// and stays public (both arts).
//
// The fills handed back are the ones the REAL job hands (recorded in
// tests/unit/ai/fixtures/job-payloads-main.json, "dfc fill steps · <kind>"
// — tests/unit/ai/dfc-fill-jobs.test.ts drives the job to them). No
// generation is run.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() }));
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
const dialog = vi.hoisted(() => ({ kind: "transform", frame: "m15dfcfront" }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ onGenerate }: { onGenerate: (options: Record<string, unknown>) => void }) => (
    <button
      type="button"
      data-testid="run-fill"
      onClick={() => onGenerate({ want: EVERY_FIELD, design_kind: dialog.kind, frame: dialog.frame })}
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
const VERIFIED = FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour)));

type Fill = Record<string, unknown> & { back_face?: Record<string, unknown> };
const RECORDED = JSON.parse(readFileSync(join(process.cwd(), "tests/unit/ai/fixtures/job-payloads-main.json"), "utf8")) as Record<
  string,
  { steps: Array<{ key: string; status: string; fill: Fill }> }
>;
/** The fills the job hands, the back's picture at a URL of its own (the
 *  pinned run's storage stub hands one URL to every upload). */
const BACK_ART = `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/back.png`;
const recordedFills = (kind: string) => {
  const steps = RECORDED[`dfc fill steps · ${kind}`]!.steps;
  const back = steps[1]!.fill;
  return { front: steps[0]!.fill, back: { ...back, back_face: { ...back.back_face, art_url: BACK_ART } } };
};

const jobs = {
  posted: [] as Record<string, unknown>[],
  stepBodies: [] as string[],
  front: {} as Fill,
  frontStep: {} as Record<string, unknown>,
  back: {} as Record<string, unknown>,
  /** How the back step's POST answers: as the server would, thrown on the
   *  way (a dropped connection) or with a page that isn't JSON. */
  backPost: "ok" as "ok" | "throw" | "nojson",
  /** What a re-read of the job (GET /api/ai/jobs/job-1) says of the back. */
  reread: null as Record<string, unknown> | "fail" | null,
  rereads: 0,
  claimed: [] as string[],
};

beforeEach(() => {
  jobs.posted = [];
  jobs.stepBodies = [];
  jobs.frontStep = {};
  jobs.backPost = "ok";
  jobs.reread = null;
  jobs.rereads = 0;
  jobs.claimed = [];
  confirm.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/ai/jobs") {
        jobs.posted.push(JSON.parse(init!.body!) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ ok: true, job: { id: "job-1", steps: [{ key: "fill:0", status: "pending" }, { key: "fill:1", status: "pending" }] }, credits: 5, cost: 2 }),
          { status: 200 },
        );
      }
      if (url === "/api/ai/jobs/job-1") {
        jobs.rereads += 1;
        if (jobs.reread === "fail" || jobs.reread === null) throw new TypeError("Failed to fetch");
        const front = { key: "fill:0", status: "done", fill: jobs.front };
        return new Response(JSON.stringify({ ok: true, job: { steps: [front, { key: "fill:1", ...jobs.reread }] } }), { status: 200 });
      }
      if (url === "/api/ai/card-fill" && (init as { method?: string } | undefined)?.method === "POST") {
        jobs.claimed.push(String(init?.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).startsWith("/api/ai/jobs/job-1/step")) {
        jobs.stepBodies.push(init?.body ?? "");
        const isBack = (init?.body ?? "").includes("fill:1");
        if (isBack && jobs.backPost === "throw") throw new TypeError("Failed to fetch");
        if (isBack && jobs.backPost === "nojson") return new Response("<html>504 Gateway Timeout</html>", { status: 504 });
        const front = { key: "fill:0", status: "done", fill: jobs.front, ...jobs.frontStep };
        const back = (init?.body ?? "").includes("fill:1") ? { key: "fill:1", ...jobs.back } : { key: "fill:1", status: "pending" };
        return new Response(JSON.stringify({ ok: true, credits: 3, job: { steps: [front, back] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }),
  );
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "card-1", slug: "made" });
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

async function runFill(kind: string, frame: string, opts: { backStep?: Record<string, unknown>; expectToast?: "success" | "warning" } = {}) {
  dialog.kind = kind;
  dialog.frame = frame;
  const recorded = recordedFills(kind);
  jobs.front = recorded.front;
  jobs.back = opts.backStep ?? { status: "done", fill: recorded.back };
  render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
  await click(screen.getByTestId("run-fill"));
  await waitFor(() => expect(toast[opts.expectToast ?? "success"]).toHaveBeenCalled());
  return recorded;
}

async function fillAndSave(kind: string, frame: string) {
  const recorded = await runFill(kind, frame);
  const save = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
  await waitFor(() => expect(save().disabled).toBe(false));
  await click(save());
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  const payload = JSON.parse(JSON.stringify(actions.createCardAction.mock.calls[0]![0])) as Record<string, unknown> & {
    frame_style: Record<string, unknown> & { template: string };
    back_face: Record<string, unknown> & { frame_style?: { template: string } };
  };
  expect(createCardSchema.safeParse(payload).success).toBe(true);
  return { payload, recorded };
}

/** The gates createCardAction runs on a double-faced card, on the payload. */
function serverGates(payload: Awaited<ReturnType<typeof fillAndSave>>["payload"]) {
  const verified = new Set(VERIFIED);
  const template = payload.frame_style.template;
  expect(frameKindGateError(template, { cardType: payload.card_type as string, supertype: payload.supertype as string, subtypes: payload.subtypes as string[], title: payload.title as string, rulesText: payload.rules_text as string })).toBeNull();
  expect(dfcFrontTypeError(template, payload.card_type as string)).toBeNull();
  expect(dfcFrontColorError(template, { cardType: payload.card_type as string, supertype: payload.supertype as string }, payload.color_identity as never)).toBeNull();
  expect(frameGateError(template, payload.color_identity as never, verified)).toBeNull();
  const gate = resolveDfcBackFace({
    frontTemplate: template,
    back: payload.back_face,
    family: payload.frame_style.dfcIcon as string | undefined,
    frontColorIdentity: payload.color_identity as never,
    verifiedKeys: verified,
  });
  expect(gate.ok, JSON.stringify(gate)).toBe(true);
  return gate;
}

const CASES = [
  { kind: "transform", frame: "m15dfcfront", back: "m15dfcback" },
  { kind: "mdfc", frame: "m15mdfcfront", back: "m15mdfclandback" },
  { kind: "dfc_saga", frame: "sagadfcfront", back: "m15dfcback" },
  { kind: "dfc_token", frame: "m20token", back: "m20token" },
] as const;

describe("a double-faced card from the AI dialog: two pictures, the creator's own save", () => {
  it.each(CASES)("$kind — front on $frame, back on $back, each face its own picture, public", async ({ kind, frame, back }) => {
    const { payload, recorded } = await fillAndSave(kind, frame);
    // Priced before anyone pays: two credits, one per picture.
    expect(jobs.posted[0]).toMatchObject({ kind: "card_fill", design_kind: kind, frame });
    expect(confirm.calls[0]).toMatchObject({ cost: 2 });
    expect(confirm.calls[0]!.description).toContain("a picture for each face");
    // The two steps, in order: the front, then the back by name.
    expect(jobs.stepBodies).toEqual(["{}", JSON.stringify({ step: "fill:1" })]);
    expect(payload.frame_style.template).toBe(frame);
    expect(payload.art_url).toBe(recorded.front.art_url);
    expect(payload.back_face).toMatchObject({
      title: printTypography(String(recorded.front.back_face!.title), "name"),
      card_type: recorded.front.back_face!.card_type,
      art_url: BACK_ART,
      art_position: fitArtToWindow(),
      frame_style: { template: back },
    });
    expect(payload.back_face.art_url).not.toBe(payload.art_url);
    // A transform-layout back prints no cost; every back has its colour.
    expect(payload.back_face).not.toHaveProperty("cost");
    expect(payload.back_face.color_identity).toEqual(recorded.front.back_face!.color_identity);
    if (kind !== "dfc_token") expect(payload.frame_style.dfcIcon).toBe("arrows");
    // What the server stores: the same body; both arts → it stays public.
    const gate = serverGates(payload);
    expect(gate.ok && gate.back?.frame_style).toEqual({ template: back });
    expect(dfcBackArtMissing(payload.frame_style.template, payload.back_face)).toBe(false);
    expect(payload.visibility).toBe("public");
  });

  it("a double-faced saga's rules text becomes its chapter rows, saved as face_content", async () => {
    const { payload } = await fillAndSave("dfc_saga", "sagadfcfront");
    expect(payload).toMatchObject({
      card_type: "enchantment",
      subtypes: ["Saga"],
      face_content: {
        v: 1,
        saga: {
          intro: "(As this Saga enters and after your draw step, add a lore counter.)",
          chapters: [
            { numerals: [1], text: "You gain 3 life." },
            { numerals: [2], text: "Exile this Saga, then return it to the battlefield transformed under your control." },
          ],
        },
      },
    });
  });
});

describe("never two credits for one picture, silently", () => {
  it("the back's picture failed after the front's: the front is the maker's, the back's credit returned — and said", async () => {
    await runFill("transform", "m15dfcfront", {
      backStep: { status: "failed", failure: "art_blocked", refunded: 1, refund_pending: false },
      expectToast: "warning",
    });
    expect(toast.success).not.toHaveBeenCalled();
    const [title, options] = toast.warning.mock.calls[0]! as [string, { description: string }];
    expect(title).toContain("not its back face's picture");
    expect(options.description).toContain("Your credit was returned.");
    expect(options.description).toContain("or save it as a draft");
    // Both faces' text is in the form; a public save waits for the back's
    // picture (the creator's own "still needed", before any save is sent).
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.createCardAction).not.toHaveBeenCalled();
  });

  it("the front failed: nothing is applied, and the back's step is asked to close (it charges nothing)", async () => {
    dialog.kind = "transform";
    dialog.frame = "m15dfcfront";
    jobs.front = {};
    jobs.frontStep = { status: "failed", failure: "art_timeout", refunded: 1, fill: undefined };
    jobs.back = { status: "failed", refunded: 0, error: "The front face wasn't made, so its back wasn't painted." };
    render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0]![0])).toContain("Your credit was returned.");
    expect(jobs.stepBodies).toEqual(["{}", JSON.stringify({ step: "fill:1" })]);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("a lost answer about the back never loses the front (review of #639)", () => {
  const backDone = () => ({ status: "done", fill: recordedFills("transform").back });

  it("the back's request THROWS (a dropped connection): the job is re-read, a finished back merged, the fill claimed", async () => {
    jobs.backPost = "throw";
    jobs.reread = backDone();
    const { payload } = await fillAndSave("transform", "m15dfcfront");
    expect(jobs.rereads).toBe(1);
    expect(payload.back_face).toMatchObject({ art_url: BACK_ART });
    expect(jobs.claimed).toEqual([JSON.stringify({ jobId: "job-1" })]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("thrown AND the re-read lost too: the front is applied, the fill left UNCLAIMED (offered back later), and the toast says only what's true", async () => {
    jobs.backPost = "throw";
    jobs.reread = "fail";
    await runFill("transform", "m15dfcfront", { expectToast: "warning" });
    const [, options] = toast.warning.mock.calls[0]! as [string, { description: string }];
    expect(options.description).toContain("We lost the connection while the back face's picture was being painted");
    expect(options.description).toContain("offered on this page next time");
    expect(options.description).not.toContain("couldn't be painted");
    expect(options.description).not.toContain("was returned");
    // The front is in the form; nothing claimed, so a back the server
    // finishes is offered by the unclaimed route.
    // (The warning is raised only once the fill was poured into the form.)
    expect(jobs.claimed).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("the back's answer isn't JSON (a platform timeout page) but the server finished it: merged from the re-read", async () => {
    jobs.backPost = "nojson";
    jobs.reread = backDone();
    const { payload } = await fillAndSave("transform", "m15dfcfront");
    expect(payload.back_face).toMatchObject({ art_url: BACK_ART });
    expect(jobs.claimed).toHaveLength(1);
  });

  it("a back still running on the re-read: unclaimed, said as unknown", async () => {
    jobs.backPost = "nojson";
    jobs.reread = { status: "running" };
    await runFill("transform", "m15dfcfront", { expectToast: "warning" });
    expect(jobs.claimed).toEqual([]);
  });

  it("a failed back's warning carries the frame notice too", async () => {
    dialog.kind = "transform";
    dialog.frame = "m15dfcfront";
    const recorded = recordedFills("transform");
    jobs.front = { ...recorded.front, frame_notice: "Designed as a land, so it's on Transform land front." };
    jobs.back = { status: "failed", failure: "art_blocked", refunded: 1 };
    render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={VERIFIED} />);
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [, options] = toast.warning.mock.calls[0]! as [string, { description: string }];
    expect(options.description).toContain("Designed as a land, so it's on Transform land front.");
    expect(options.description).toContain("Your credit was returned.");
  });
});

describe("the icon family travels with a double-faced kind", () => {
  it("a second run on a transform card sends the card's family; the first (no family yet) sends none", async () => {
    await runFill("transform", "m15dfcfront");
    expect(jobs.posted[0]).not.toHaveProperty("dfc_icon");
    toast.success.mockClear();
    await click(screen.getByTestId("run-fill"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(jobs.posted[1]).toMatchObject({ dfc_icon: "arrows" });
  });
});

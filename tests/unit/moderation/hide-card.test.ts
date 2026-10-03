import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The moderation HIDE (lib/moderation/hide-card.ts) — ONE code path for the
// admin's "Hide" on a reported card and for a card that uses a file the
// moderation rescan flagged (owner answer 2026-09-29: "reuse its code path,
// don't re-implement"). In order: private + render pointer cleared in one
// update → both render objects removed → pending reports actioned → the
// purge of pages AND CDN copies (share image, /render-cdn bake), after the
// remove. A failed hide changes nothing else.
// ---------------------------------------------------------------------------

const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "99999999-9999-4999-8999-999999999999";

const s = vi.hoisted(() => ({
  seq: [] as string[],
  card: { owner_id: "11111111-1111-4111-8111-111111111111", slug: "the-card" } as null | { owner_id: string; slug: string },
  readError: null as null | { message: string },
  hideError: null as null | { message: string },
  reportsError: null as null | { message: string },
  removeError: null as null | string,
  purged: [] as Array<[{ id: string; slug: string | null }, string | null | undefined]>,
  admin: null as null | { is_admin: boolean; id: string },
  client: null as unknown,
  log: null as unknown,
}));

vi.mock("@/lib/cards/bake-core", async (importOriginal) => ({
  // The pointer list is the real one (0126 + 0134's six columns minus
  // layout_version); only the storage call is faked.
  CLEARED_RENDER_POINTERS: (await importOriginal<typeof import("@/lib/cards/bake-core")>()).CLEARED_RENDER_POINTERS,
  removeRenderObjects: async (owner: string, ids: string[]) => {
    s.seq.push(`remove ${owner} ${ids.join(",")}`);
    return { error: s.removeError };
  },
}));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: async (card: { id: string; slug: string | null }, username: string | null | undefined) => {
    s.seq.push("purge");
    s.purged.push([card, username]);
  },
  revalidateCardPaths: vi.fn(),
}));
vi.mock("@/lib/profile/username", () => ({ lookupUsername: async () => "owner-handle" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => s.admin,
  getCurrentUser: async () => null,
  createClient: async () => ({}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => s.client }));
vi.mock("@/lib/moderation/notify", () => ({ notifyAdminsOfReport: vi.fn() }));

import { hideCard } from "@/lib/moderation/hide-card";
import { resolveCardReportsAction } from "@/lib/moderation/actions";

function adminClient() {
  const stub = chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) {
      s.seq.push("update cards");
      return { error: s.hideError };
    }
    if (table === "cards") {
      s.seq.push("read cards");
      return s.readError ? { error: s.readError } : { data: s.card };
    }
    if (table === "card_reports" && called(calls, "update")) {
      s.seq.push("update card_reports");
      return { error: s.reportsError };
    }
    return {};
  });
  s.client = stub.client;
  s.log = stub.log;
  return stub;
}

beforeEach(() => {
  s.seq = [];
  s.card = { owner_id: OWNER, slug: "the-card" };
  s.readError = null;
  s.hideError = null;
  s.reportsError = null;
  s.removeError = null;
  s.purged = [];
  s.admin = { is_admin: true, id: ADMIN };
});

describe("hideCard", () => {
  it("private + pointer cleared in one update, then the renders, the reports, and the purge — in that order", async () => {
    const stub = adminClient();
    expect(await hideCard(stub.client as never, CARD, { resolvedBy: null })).toEqual({ ok: true, ownerId: OWNER });
    expect(s.seq).toEqual(["read cards", "update cards", `remove ${OWNER} ${CARD}`, "update card_reports", "purge"]);
    const update = stub.forTable("cards").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(update.calls, "update")).toEqual({
      visibility: "private",
      rendered_image_url: null,
      rendered_thumb_url: null,
      rendered_back_image_url: null,
      rendered_back_thumb_url: null,
      rendered_at: null,
    });
    expect(called(update.calls, "eq", "id")).toBe(true);
    const reports = stub.forTable("card_reports")[0];
    expect(payloadOf(reports.calls, "update")).toMatchObject({ status: "actioned", resolved_by: null });
    expect(reports.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["card_id", CARD],
      ["status", "pending"],
    ]);
    expect(s.purged).toEqual([[{ id: CARD, slug: "the-card" }, "owner-handle"]]);
  });

  it("a card that isn't there, or a read or hide that fails, changes nothing else", async () => {
    adminClient();
    s.card = null;
    expect(await hideCard(s.client as never, CARD, { resolvedBy: null })).toMatchObject({ ok: false, notFound: true });
    s.card = { owner_id: OWNER, slug: "x" };
    s.readError = { message: "db down" };
    expect(await hideCard(s.client as never, CARD, { resolvedBy: null })).toMatchObject({ ok: false, error: "Couldn't read the card: db down" });
    s.readError = null;
    s.hideError = { message: "nope" };
    expect(await hideCard(s.client as never, CARD, { resolvedBy: null })).toEqual({ ok: false, error: "Couldn't hide the card: nope" });
    expect(s.seq.filter((e) => e.startsWith("remove") || e === "purge" || e === "update card_reports")).toEqual([]);
  });

  it("a render delete that fails is logged, and the reports are still actioned and the card purged", async () => {
    adminClient();
    s.removeError = "storage down";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await hideCard(s.client as never, CARD, { resolvedBy: null })).ok).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not delete its render: storage down"));
    log.mockRestore();
    expect(s.seq.slice(-2)).toEqual(["update card_reports", "purge"]);
  });

  it("reports that weren't marked are an error — but the hidden card is purged all the same", async () => {
    adminClient();
    s.reportsError = { message: "locked" };
    expect(await hideCard(s.client as never, CARD, { resolvedBy: null })).toEqual({
      ok: false,
      error: "Card hidden, but the reports weren't marked: locked",
    });
    expect(s.seq.at(-1)).toBe("purge");
  });
});

describe("resolveCardReportsAction('hide') — the admin's Hide goes through hideCard", () => {
  it("hides with the admin as the resolver", async () => {
    const stub = adminClient();
    expect(await resolveCardReportsAction({ cardId: CARD, action: "hide" })).toEqual({ ok: true });
    expect(s.seq).toEqual(["read cards", "update cards", `remove ${OWNER} ${CARD}`, "update card_reports", "purge"]);
    expect(payloadOf(stub.forTable("card_reports")[0].calls, "update")).toMatchObject({ status: "actioned", resolved_by: ADMIN });
  });

  it("passes a failure through, and never runs for a non-admin", async () => {
    adminClient();
    s.card = null;
    expect(await resolveCardReportsAction({ cardId: CARD, action: "hide" })).toEqual({
      ok: false,
      error: "Card not found — it may already be deleted.",
    });
    s.admin = { is_admin: false, id: ADMIN };
    s.seq = [];
    expect(await resolveCardReportsAction({ cardId: CARD, action: "hide" })).toEqual({ ok: false, error: "Not authorized." });
    expect(s.seq).toEqual([]);
  });
});

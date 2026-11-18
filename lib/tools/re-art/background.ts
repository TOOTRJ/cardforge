import "server-only";

import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import type { JobStep } from "@/lib/ai/generation-jobs";
import { recordToolEventLater } from "@/lib/tools/events";
import { openToken, sealToken } from "@/lib/tools/re-art/token-seal";
import {
  REART_BACKGROUND_STALE_MS,
  REART_TOOL_SLUG,
  type ReartBackground,
  type ReartBackgroundReason,
  type ReartBackgroundState,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// A Re-art run the SERVER carries on after its page is closed (migration
// 0218; owner 2026-11-18: "borrow the sign-in").
//
// Every step of a run works under the maker's own session — the step door,
// claim_job_step and spend_credits (auth.uid()), the card's edit — so the
// server needs that session to work a step. It BORROWS it:
//
//   * the hand-over (a server action, the maker's own request) takes the
//     session's ACCESS TOKEN — never its refresh token — and keeps it,
//     ENCRYPTED, beside the run (deck_reart_background_tokens: no API role
//     reads that table; lib/tools/re-art/token-seal.ts) until the run ends
//     or the token does;
//   * a DRIVER asks the STEP DOOR for the run's steps exactly as the
//     browser's runner does — POST /api/ai/jobs/[id]/step, one request per
//     card — with a session cookie made of that access token ALONE. A card
//     is never painted inside the driver's own request: each step keeps its
//     own time limit and its own follow-up work (the card's render is baked
//     after the step's response);
//   * the driver is the hand-over's own request for its first minutes
//     (after its response), then a cron, every minute
//     (/api/cron/reart-background). NEVER a request that calls itself in a
//     chain: Vercel's recursion protection answers the fourth or so of
//     those with 508 (INFINITE_LOOP_DETECTED), and a run would stop after a
//     few minutes on production while working on a laptop;
//   * the token is NEVER refreshed here. Refresh tokens rotate, and the
//     browser still holds the real one: a refresh by the server would leave
//     the browser with a used token, and the maker signed out (the
//     2026-06-30 incident's cause — "never call Supabase auth in after()").
//     The cookie the door is sent holds a refresh token that is not one
//     (NO_REFRESH), so a refresh that is tried anyway fails without touching
//     the real session;
//   * so a run is carried for as long as the one token lasts: about an
//     hour. The driver stops asking while the token still has minutes to
//     spare, the kept token is erased, and the run PAUSES — exactly the
//     state a closed page always left it in.
//
// The row is the driver's LEASE (`driver`, `driven_until`, renewed as it
// works): two drivers never work one run. `beat_at` is its heartbeat — the
// studio reads "the server is carrying this" from it.
//
// The page, while it is open, goes on asking for steps as it always did. A
// step is claimed atomically (0066), and the driver asks only while fewer
// than two cards are being painted — so no card is painted twice, and the
// two together never paint more at once than the page would alone.
// ---------------------------------------------------------------------------

/** The hand-over refreshes the browser's session first unless its token is
 *  this fresh already (the best part of an hour for the run, and no
 *  needless rotation). */
export const FRESH_TOKEN_S = 45 * 60;
/** A hand-over is refused with less than this left of a token that couldn't
 *  be refreshed. */
const MIN_TOKEN_S = 10 * 60;
/** A step is asked for only while the token will outlive it WITH ROOM: a
 *  step's last writes (the card's edit, the done-write that settles its
 *  credit) are made under the session up to the step door's 180 s later, and
 *  the sign-in library treats a token as expired 90 s before it is — it
 *  would then try a refresh, which this cookie cannot do, and the step
 *  would finish signed out with its picture painted and nothing saved. So:
 *  180 + 90, and a minute to spare. */
const TOKEN_MARGIN_S = 330;
/** How long the cron's driver works: it is called every minute. */
export const SWEEP_MS = 55_000;
/** …and the hand-over's own, after its response. */
export const KICK_MS = 240_000;
/** Outside production the hand-over's driver can be made shorter
 *  (REART_BACKGROUND_KICK_MS), so a check can leave a run to the cron's
 *  route at once. Never read on production. */
export function kickMs(): number {
  if (process.env.NODE_ENV === "production") return KICK_MS;
  const asked = Number(process.env.REART_BACKGROUND_KICK_MS);
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, KICK_MS) : KICK_MS;
}
/** A driver looks at its runs this often… */
const TICK_MS = 4_000;
/** …and holds a run this long past its last look (a driver that died lets
 *  go by itself). */
const LEASE_MS = 20_000;
/** Cards painted at once, the page's own included (the runner's number). */
const WORKERS = 2;
/** After asking, a driver gives the door this long to claim a card (it then
 *  shows as being painted) or to answer at once, before it looks again. */
const ASK_SETTLE_MS = 3_000;
/** claim_job_step's own rule: a claim older than this is dead. */
const STEP_CLAIM_FRESH_MS = 5 * 60_000;
/** …and the door is asked to take a dead claim back no more often than this. */
const STALE_ASK_EVERY_MS = 30_000;
const MAX_DOOR_ERRORS = 3;
/** The step door said to come back this much later, or more: the AI's daily
 *  limit, not the minute's — not this run's to wait out. */
const LONG_WAIT_S = 300;
/** Runs one driver works at a time (the least recently worked first). */
const MAX_RUNS = 20;
/** The refresh token the door's cookie carries: not one. */
const NO_REFRESH = "none";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds of life an access token has left (0: unreadable or expired). */
export function tokenSecondsLeft(accessToken: string | null | undefined, now: number = Date.now()): number {
  const part = accessToken?.split(".")[1];
  if (!part) return 0;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? Math.max(0, Math.floor(payload.exp - now / 1000)) : 0;
  } catch {
    return 0;
  }
}

/**
 * The Cookie header the step door is sent: a session of the access token
 * ALONE, written by the sign-in library itself (its name, encoding and
 * chunking are the library's to know). Null when the token is refused —
 * expired, or its session ended (the maker signed out).
 */
export async function sessionCookieHeader(accessToken: string): Promise<string | null> {
  if (tokenSecondsLeft(accessToken) <= 0) return null;
  const { url, anonKey } = getSupabaseEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  try {
    const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: NO_REFRESH });
    if (error || !data.session || jar.size === 0) return null;
  } catch {
    return null;
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * The step door the browser's runner calls, at this deployment's own
 * address. Never a host taken from a request on a deployed site (the header
 * is the caller's to write) — only a local dev server is reached by the
 * address it was called on.
 */
export function stepDoorUrl(requestUrl: string | null, jobId: string): string {
  let origin = getSiteBaseUrl();
  if (requestUrl) {
    try {
      const asked = new URL(requestUrl);
      if (asked.hostname === "localhost" || asked.hostname === "127.0.0.1" || asked.hostname === "[::1]") origin = asked.origin;
    } catch {
      // Not an address: the site's own.
    }
  }
  return `${origin}/api/ai/jobs/${jobId}/step`;
}

/** The headers of a request to the step door: the session cookie, and — on
 *  a preview behind Vercel Authentication — the bypass that lets a
 *  deployment reach itself (lib/render/card-frames.ts does the same for its
 *  own frames). */
function doorHeaders(cookie: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", cookie };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

type Row = {
  job_id: string;
  owner_id: string;
  deck_id: string;
  state: string;
  reason: string | null;
  driver: string | null;
  driven_until: string | null;
  beat_at: string;
  door_errors: number;
  limited_keys: string[] | null;
};
const COLUMNS = "job_id, owner_id, deck_id, state, reason, driver, driven_until, beat_at, door_errors, limited_keys";
const VIEW_COLUMNS = "job_id, state, reason, beat_at";

const STATES: ReadonlyArray<string> = ["running", "paused", "stopped", "finished"];
const REASONS: ReadonlyArray<string> = ["expired", "error", "credits", "capacity", "stopped"];
const viewOf = (row: Pick<Row, "job_id" | "state" | "reason" | "beat_at">): ReartBackground => ({
  jobId: row.job_id,
  state: (STATES.includes(row.state) ? row.state : "paused") as ReartBackgroundState,
  reason: (row.reason && REASONS.includes(row.reason) ? row.reason : null) as ReartBackgroundReason | null,
  beatAt: row.beat_at,
});

const missingTable = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

/** The server's part of the deck's runs, by job (the owner's own session) —
 *  for the studio. A read that failed shows none. */
export async function readBackgrounds(deckId: string): Promise<Map<string, ReartBackground>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("deck_reart_background").select(VIEW_COLUMNS).eq("deck_id", deckId);
  if (error) {
    if (!missingTable(error)) console.error(`[re-art] background runs of deck ${deckId} not read: ${error.code ?? ""} ${error.message}`);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.job_id, viewOf(row)]));
}

/** What a run came to, for the bell and the tool's log. */
export type BackgroundCounts = { painted: number; failed: number; waiting: number };
export const countsOf = (steps: ReadonlyArray<Pick<JobStep, "status">>): BackgroundCounts => ({
  painted: steps.filter((step) => step.status === "done").length,
  failed: steps.filter((step) => step.status === "failed").length,
  waiting: steps.filter((step) => step.status === "pending" || step.status === "running").length,
});

type LimitStep = Pick<JobStep, "key" | "status" | "error_code">;
const isLimit = (step: LimitStep) => step.status === "failed" && (step.error_code === "INSUFFICIENT_CREDITS" || step.error_code === "CARD_CAPACITY");
/** The steps that have failed on a plan limit already: only a NEW such
 *  failure stops a carried run (an old one may have been cured since —
 *  credits bought, a card deleted — and "Continue" pressed). */
export const limitedKeysOf = (steps: ReadonlyArray<LimitStep>): string[] => steps.filter(isLimit).map((step) => step.key);

/**
 * Ends the server's part of a run: what became of it, the kept token
 * erased, and — unless the maker stopped it themselves — one row in their
 * bell. Only a row still "running" is ended (two drivers that both see the
 * end write it once).
 */
async function finalize(
  row: Pick<Row, "job_id" | "owner_id" | "deck_id">,
  state: Exclude<ReartBackgroundState, "running">,
  reason: ReartBackgroundReason | null,
  counts: BackgroundCounts,
): Promise<boolean> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("deck_reart_background")
    .update({ state, reason, finished_at: now, beat_at: now, driver: null, driven_until: null })
    .eq("job_id", row.job_id)
    .eq("owner_id", row.owner_id)
    .eq("state", "running")
    .select("job_id");
  if (error) {
    console.error(`[re-art] background run ${row.job_id} not ended (${state}): ${error.message}`);
    return false;
  }
  if (!data || data.length === 0) return false;
  // The borrowed sign-in is kept no longer than the run is carried.
  const { error: tokenError } = await admin.from("deck_reart_background_tokens").delete().eq("job_id", row.job_id);
  if (tokenError) console.error(`[re-art] background run ${row.job_id}: its kept token was not erased: ${tokenError.message}`);
  if (reason !== "stopped") {
    const { data: deck } = await admin.from("decks").select("title").eq("id", row.deck_id).maybeSingle();
    const { error: noticeError } = await admin.from("notifications").insert({
      recipient_id: row.owner_id,
      actor_id: row.owner_id,
      type: "reart_run",
      payload: { jobId: row.job_id, deckId: row.deck_id, deckTitle: deck?.title ?? null, state, reason, ...counts },
    });
    if (noticeError) console.error(`[re-art] background run ${row.job_id}: its owner was not told: ${noticeError.message}`);
  }
  // What the run came to, for the tool's log: counts and codes (never
  // waited for: a driver's work is the runs, not its own bookkeeping).
  recordToolEventLater({
    slug: REART_TOOL_SLUG,
    userId: row.owner_id,
    event: "background_finished",
    access: null,
    props: { state, ...(reason ? { reason } : {}), ...counts },
  });
  return true;
}

/**
 * Whether this deployment can reach its own step door with these headers —
 * asked BEFORE a run is taken on, so a hand-over that could carry nothing
 * (a preview behind a wall with no bypass configured) is refused at once,
 * in the page's words, instead of pausing a minute later with a bell row.
 * A GET claims nothing: the door only takes POST and answers 405.
 */
async function doorReachable(url: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET", headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8_000) });
    return response.status === 405;
  } catch {
    return false;
  }
}

export type HandOver =
  | { ok: true; state: "started" | "already"; headers: Record<string, string> }
  | { ok: false; reason: "unavailable" | "no_session" | "unreachable" | "not_saved" };

/**
 * Hands a run to the server: the lease row is made (or put back to
 * "running" — a run that paused, stopped or went quiet is taken up again),
 * and the access token is kept, sealed, for the drivers. A run the server
 * is carrying right now is "already" (its token is replaced by this fresher
 * one all the same). The caller has checked that the job is the caller's
 * own running Re-art run; `steps` are that job's.
 */
export async function startBackground(input: {
  userId: string;
  jobId: string;
  deckId: string;
  accessToken: string;
  steps: ReadonlyArray<LimitStep>;
  requestUrl: string | null;
}): Promise<HandOver> {
  if (!isAdminConfigured()) return { ok: false, reason: "unavailable" };
  if (tokenSecondsLeft(input.accessToken) < MIN_TOKEN_S) return { ok: false, reason: "no_session" };
  // The session the drivers will send — proven before anything is kept: a
  // token the sign-in service refuses is never stored.
  const cookie = await sessionCookieHeader(input.accessToken);
  if (!cookie) return { ok: false, reason: "no_session" };
  const headers = doorHeaders(cookie);
  if (!(await doorReachable(stepDoorUrl(input.requestUrl, input.jobId), headers))) return { ok: false, reason: "unreachable" };

  const admin = createAdminClient();
  const refused = (error: { code?: string; message: string }): HandOver => {
    console.error(`[re-art] background run ${input.jobId} not started: ${error.code ?? ""} ${error.message}`);
    return { ok: false, reason: missingTable(error) ? "unavailable" : "not_saved" };
  };
  const { data: existing, error: readError } = await admin
    .from("deck_reart_background")
    .select(COLUMNS)
    .eq("job_id", input.jobId)
    .eq("owner_id", input.userId)
    .maybeSingle();
  if (readError) return refused(readError);
  const alive = Boolean(existing && existing.state === "running" && Date.now() - Date.parse(existing.beat_at) < REART_BACKGROUND_STALE_MS);
  const now = new Date().toISOString();
  const running = { state: "running", reason: null, door_errors: 0, limited_keys: limitedKeysOf(input.steps), finished_at: null, beat_at: now };
  let written = existing
    ? await admin.from("deck_reart_background").update(running).eq("job_id", input.jobId).eq("owner_id", input.userId)
    : await admin.from("deck_reart_background").insert({ job_id: input.jobId, owner_id: input.userId, deck_id: input.deckId, ...running });
  // Another request made the row this instant: it is this run's all the same.
  if (written.error?.code === "23505") written = await admin.from("deck_reart_background").update(running).eq("job_id", input.jobId).eq("owner_id", input.userId);
  if (written.error) return refused(written.error);

  const { error: tokenError } = await admin.from("deck_reart_background_tokens").upsert(
    {
      job_id: input.jobId,
      sealed: sealToken(input.accessToken, input.jobId),
      expires_at: new Date(Date.now() + tokenSecondsLeft(input.accessToken) * 1000).toISOString(),
    },
    { onConflict: "job_id" },
  );
  if (tokenError) {
    // Nothing to carry it with: the run is the page's alone, as it always was.
    await admin
      .from("deck_reart_background")
      .update({ state: "paused", reason: "error", finished_at: new Date().toISOString() })
      .eq("job_id", input.jobId)
      .eq("owner_id", input.userId)
      .eq("state", "running");
    return refused(tokenError);
  }
  return { ok: true, state: alive ? "already" : "started", headers };
}

/** What one driver did. */
export type DriveResult = { runs: number; asked: number; ended: number };

/** What a driver remembers of a run while it works (nothing outlives it). */
type Mem = {
  /** The token it sends, and the headers made of it. */
  token: string | null;
  headers: Record<string, string> | null;
  /** The AI's per-minute limit: not asked again before this. */
  waitUntil: number;
  /** …or its daily one. */
  longWait: boolean;
  /** Answers since its last look: refusals, and whether any was a step. */
  refused: number;
  answered: boolean;
  /** A quota wait a step asked for was given once. */
  quotaHeld: boolean;
  /** When the door was last asked to take back a dead claim. */
  staleAsked: number;
  open: Set<AbortController>;
};

/**
 * A DRIVER: for `forMs` it looks at the runs the server is carrying (or at
 * `only` one) every few seconds — ends the ones that are over, and asks the
 * step door for a card wherever fewer than two are being painted. It awaits
 * no card: a step is the door's own request, and what became of it is read
 * from the job at the next look.
 *
 * Called by the cron every minute, and by the hand-over for its first
 * minutes (`preset`: the session it was just given, so nothing about the
 * sign-in is asked again after the response).
 */
export async function driveBackgroundRuns(input: {
  forMs: number;
  requestUrl: string | null;
  only?: string;
  preset?: { jobId: string; accessToken: string; headers: Record<string, string> };
}): Promise<DriveResult> {
  if (!isAdminConfigured()) return { runs: 0, asked: 0, ended: 0 };
  const admin = createAdminClient();
  const driver = randomUUID();
  const startedAt = Date.now();
  const mems = new Map<string, Mem>();
  const seen = new Set<string>();
  let asked = 0;
  let ended = 0;
  let closing = false;

  const memOf = (jobId: string): Mem => {
    let mem = mems.get(jobId);
    if (!mem) {
      const given = input.preset?.jobId === jobId ? input.preset : null;
      mem = { token: given?.accessToken ?? null, headers: given?.headers ?? null, waitUntil: 0, longWait: false, refused: 0, answered: false, quotaHeld: false, staleAsked: 0, open: new Set() };
      mems.set(jobId, mem);
    }
    return mem;
  };

  /** One request to the step door, as the browser's runner makes it: no
   *  step is named, so it claims the next card that is waiting. */
  const ask = async (run: Row, mem: Mem, headers: Record<string, string>): Promise<void> => {
    const controller = new AbortController();
    mem.open.add(controller);
    asked += 1;
    try {
      const response = await fetch(stepDoorUrl(input.requestUrl, run.job_id), {
        method: "POST",
        headers,
        body: "{}",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status === 429) {
        const seconds = Math.max(1, Number(response.headers.get("Retry-After")) || 20);
        if (seconds >= LONG_WAIT_S) mem.longWait = true;
        else mem.waitUntil = Date.now() + Math.min(seconds, 60) * 1000;
        return;
      }
      const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
      if (response.status === 200 && body?.ok === true) mem.answered = true;
      else mem.refused += 1;
    } catch {
      // Let go by this driver at its end: the step goes on by itself.
      if (!closing) mem.refused += 1;
    } finally {
      mem.open.delete(controller);
    }
  };

  /** One look at one run. False: another driver holds it. */
  const tick = async (row: Row): Promise<boolean> => {
    const now = Date.now();
    // The lease: this driver's already, or nobody's (never held, or let lapse).
    const free = row.driver === driver || !row.driver || !row.driven_until || Date.parse(row.driven_until) < now;
    if (!free) return false;
    let claim = admin
      .from("deck_reart_background")
      .update({ driver, driven_until: new Date(now + LEASE_MS).toISOString(), beat_at: new Date(now).toISOString() })
      .eq("job_id", row.job_id)
      .eq("state", "running");
    // …taken only as it was read: two drivers that both saw it free don't both take it.
    claim = row.driver ? claim.eq("driver", row.driver) : claim.is("driver", null);
    claim = row.driven_until ? claim.eq("driven_until", row.driven_until) : claim.is("driven_until", null);
    const { data: held, error: claimError } = await claim.select(COLUMNS);
    if (claimError || !held || held.length === 0) return false;
    const run = held[0] as Row;
    seen.add(run.job_id);
    const mem = memOf(run.job_id);

    const { data: job, error: jobError } = await admin.from("ai_generation_jobs").select("steps, status").eq("id", run.job_id).maybeSingle();
    // A read that failed is not "nothing left": looked at again shortly.
    if (jobError) return true;
    const steps = (Array.isArray(job?.steps) ? job.steps : []) as unknown as JobStep[];
    const counts = countsOf(steps);
    const end = async (state: Exclude<ReartBackgroundState, "running">, reason: ReartBackgroundReason | null) => {
      for (const controller of mem.open) controller.abort();
      if (await finalize(run, state, reason, counts)) ended += 1;
      return true;
    };

    if (job && counts.waiting === 0) return end("finished", null);
    // A run that is no longer "generating" with cards still waiting was
    // closed (the maker started another run of the deck): nothing to carry.
    if (!job || job.status !== "generating") return end("stopped", "stopped");
    // A NEW plan-limit failure stops the run and says which limit.
    const before = new Set(run.limited_keys ?? []);
    const limited = steps.find((step) => isLimit(step) && !before.has(step.key));
    if (limited) return end("stopped", limited.error_code === "INSUFFICIENT_CREDITS" ? "credits" : "capacity");

    // What the door answered since the last look.
    if (mem.longWait) return end("paused", "error");
    if (mem.answered || mem.refused > 0) {
      const doorErrors = mem.answered ? 0 : run.door_errors + mem.refused;
      mem.answered = false;
      mem.refused = 0;
      if (doorErrors !== run.door_errors) {
        await admin.from("deck_reart_background").update({ door_errors: doorErrors }).eq("job_id", run.job_id).eq("driver", driver);
        run.door_errors = doorErrors;
      }
    }
    // The door keeps refusing (signed out, the job gone): it never spins.
    if (run.door_errors >= MAX_DOOR_ERRORS) return end("paused", "error");

    // The sign-in it borrows: kept sealed beside the run.
    if (!mem.token) {
      const { data: kept, error: keptError } = await admin.from("deck_reart_background_tokens").select("sealed").eq("job_id", run.job_id).maybeSingle();
      if (keptError) return true;
      mem.token = kept ? openToken(kept.sealed, run.job_id) : null;
      if (!mem.token) return end("paused", "error");
    }
    // A step's last writes must land while the token lives.
    if (tokenSecondsLeft(mem.token) < TOKEN_MARGIN_S) return end("paused", "expired");
    if (!mem.headers) {
      // A token the sign-in service refuses now: the maker signed out.
      const cookie = await sessionCookieHeader(mem.token);
      if (!cookie) return end("paused", "error");
      mem.headers = doorHeaders(cookie);
    }
    if (now < mem.waitUntil) return true;

    // Ask for a card wherever fewer than two are being painted — by this
    // driver, another one's last asks, or the page.
    const fresh = (step: JobStep) => typeof step.claimed_at !== "string" || now - Date.parse(step.claimed_at) < STEP_CLAIM_FRESH_MS;
    const pending = steps.filter((step) => step.status === "pending");
    const painting = steps.filter((step) => step.status === "running" && fresh(step)).length;
    // A claim that went stale (its request died) is the door's to take
    // back: one ask finds it (and it is not asked over and over).
    const stale = steps.some((step) => step.status === "running" && !fresh(step)) && now - mem.staleAsked >= STALE_ASK_EVERY_MS;
    const want = Math.min(pending.length + (stale ? 1 : 0), Math.max(0, WORKERS - painting));
    if (want === 0) return true;
    if (stale) mem.staleAsked = now;
    // Every waiting card was put back in line by a quota (it says how
    // long): given that long once, then asked again.
    const quota = pending.filter((step) => step.error_code === "RATE_LIMITED").map((step) => Math.max(1, step.retry_after_seconds ?? 20));
    if (!stale && quota.length === pending.length && !mem.quotaHeld) {
      mem.quotaHeld = true;
      mem.waitUntil = now + Math.min(Math.min(...quota), 20) * 1000;
      return true;
    }
    mem.quotaHeld = false;
    const headers = mem.headers;
    const asks = Array.from({ length: want }, () => ask(run, mem, headers));
    // Each either claims a card (it then shows as being painted) or answers
    // at once (nothing to claim, a limit, a refusal): seen at the next look.
    await Promise.race([Promise.all(asks), sleep(ASK_SETTLE_MS)]);
    return true;
  };

  try {
    for (;;) {
      let query = admin.from("deck_reart_background").select(COLUMNS).eq("state", "running");
      if (input.only) query = query.eq("job_id", input.only);
      const { data, error } = await query.order("beat_at", { ascending: true }).limit(MAX_RUNS);
      if (error) {
        if (!missingTable(error)) console.error(`[re-art] background runs not read: ${error.code ?? ""} ${error.message}`);
        break;
      }
      const rows = (data ?? []) as Row[];
      // Nothing is being carried: done (the cron's every-minute call ends here).
      if (rows.length === 0) break;
      const lookedAt = Date.now();
      const worked = await Promise.all(rows.map((row) => tick(row).catch(() => true)));
      // The hand-over's driver, with another driver on its run already: that one carries it.
      if (input.only && worked.every((held) => !held)) break;
      if (Date.now() - startedAt + TICK_MS >= input.forMs) break;
      await sleep(Math.max(500, TICK_MS - (Date.now() - lookedAt)));
    }
  } finally {
    // The cards being painted go on by themselves (a step is the door's own
    // request); this driver lets go of them, and of its runs.
    closing = true;
    for (const mem of mems.values()) for (const controller of mem.open) controller.abort();
    if (seen.size > 0) {
      const { error } = await admin.from("deck_reart_background").update({ driver: null, driven_until: null }).eq("driver", driver).eq("state", "running");
      if (error) console.error(`[re-art] background driver ${driver}: its runs were not let go: ${error.message}`);
    }
  }
  return { runs: seen.size, asked, ended };
}

/**
 * The maker's Stop: the server's part of the run ends HERE — no driver
 * asks for another card (a driver takes a run only while it says
 * "running"), and the kept token is erased. The cards being painted
 * finish. No bell row: they pressed it. False when it couldn't be written.
 */
export async function requestBackgroundStop(userId: string, jobId: string): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("deck_reart_background")
    .update({ state: "stopped", reason: "stopped", finished_at: now, driver: null, driven_until: null })
    .eq("job_id", jobId)
    .eq("owner_id", userId)
    .eq("state", "running")
    .select("job_id");
  if (error) {
    if (!missingTable(error)) console.error(`[re-art] background run ${jobId}: stop not written: ${error.message}`);
    return false;
  }
  // Only the caller's own run's token (the row above was theirs).
  if (data && data.length > 0) {
    const { error: tokenError } = await admin.from("deck_reart_background_tokens").delete().eq("job_id", jobId);
    if (tokenError) console.error(`[re-art] background run ${jobId}: its kept token was not erased: ${tokenError.message}`);
  }
  return true;
}

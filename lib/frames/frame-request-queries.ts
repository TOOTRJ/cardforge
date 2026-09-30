import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { FRAME_TEMPLATE_SET, type FrameTemplate } from "@/types/card";
import { describeFrame } from "@/lib/creator/frame-resolve";
import {
  FRAME_REQUEST_ART_FLAGS,
  isForGoodSignature,
  scryfallPrintingUrl,
  signatureBlockedBy,
  type FrameRequestArtFlag,
  type FrameRequestCause,
  type FrameRequestStatus,
} from "@/lib/frames/frame-requests";
import { isKnownFrameSignature, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";

// ---------------------------------------------------------------------------
// /admin/frame-requests reads (TODO 1.6, migration 0123): the requests per
// signature + set + cause over a window, most distinct users first, then
// most requests (owner decision D4, 2026-09-29). The RPC is EXECUTE-granted
// to service_role only; the is_admin check here is what stands between a
// signed-in user and it (null → the page 404s).
// ---------------------------------------------------------------------------

export const FRAME_REQUEST_WINDOWS = ["30", "90", "all"] as const;
export type FrameRequestWindow = (typeof FRAME_REQUEST_WINDOWS)[number];

export const FRAME_REQUEST_WINDOW_LABELS: Record<FrameRequestWindow, string> = {
  "30": "30 days",
  "90": "90 days",
  all: "All time",
};

export function parseFrameRequestWindow(value: unknown): FrameRequestWindow {
  return (FRAME_REQUEST_WINDOWS as readonly unknown[]).includes(value)
    ? (value as FrameRequestWindow)
    : "30";
}

export type FrameRequestRow = {
  signature: string;
  /** The registry's exactLabel: what the printing IS. */
  label: string;
  setCode: string | null;
  status: FrameRequestStatus;
  /** Why these imports were logged (D1): no exact frame, or an exact frame
   *  not yet verified in the card's colour. */
  cause: FrameRequestCause;
  count: number;
  users: number;
  lastSeen: string;
  /** The frame the latest import landed on, and its label. */
  template: string | null;
  templateLabel: string | null;
  artFlags: FrameRequestArtFlag[];
  sampleCollector: string | null;
  sampleScryfallId: string | null;
  /** The sample printing's Scryfall page. */
  sampleUrl: string | null;
  /** The TODO item that would make it exact, per the registry — null once
   *  the frame it landed on draws the missing piece (`drawnNow`). */
  blockedBy: string | null;
  /** Logged before PipGlyph drew the missing piece, which the frame it
   *  landed on draws now (a legendary crown or two-colour frame logged
   *  before 4.6a / 4.6b; lib/scryfall/frame-signatures.ts signatureDrawnOn):
   *  the same printing imports exact today — listed apart, not as open. */
  drawnNow: boolean;
  /** PipGlyph will never build this family (collapsed by default). */
  forGood: boolean;
  /** The signature is a key of today's registry. False for a renamed or
   *  removed rule, or a row written straight through the RPC with an
   *  invented key (the table can't check the registry) — the page flags it
   *  (D6). */
  inRegistry: boolean;
};

export type FrameRequestSummary = {
  window: FrameRequestWindow;
  rows: FrameRequestRow[];
  totalRequests: number;
  /** Why the list may be empty for another reason than "no requests". */
  error: string | null;
};

type RpcRow = {
  signature: string;
  label: string;
  set_code: string | null;
  cause: string;
  status: string;
  template: string | null;
  n: number | string;
  users: number | string;
  last_seen: string;
  sample_scryfall_id: string | null;
  sample_collector: string | null;
  art_flags: string[] | null;
};

const isTemplate = (value: string | null): value is FrameTemplate =>
  value != null && Object.prototype.hasOwnProperty.call(FRAME_TEMPLATE_SET, value);

/** Pure: RPC rows → panel rows. */
export function mapFrameRequestRows(rows: readonly RpcRow[]): FrameRequestRow[] {
  return rows.map((row) => {
    const drawnNow = signatureDrawnOn(row.signature, row.template);
    return {
      signature: row.signature,
      label: row.label,
      setCode: row.set_code,
      status: row.status === "unsupported" ? "unsupported" : "nearest",
      cause: row.cause === "unverified" ? "unverified" : "missing",
      count: Number(row.n) || 0,
      users: Number(row.users) || 0,
      lastSeen: row.last_seen,
      template: row.template,
      templateLabel: isTemplate(row.template) ? describeFrame(row.template) : row.template,
      artFlags: (row.art_flags ?? []).filter((flag): flag is FrameRequestArtFlag =>
        (FRAME_REQUEST_ART_FLAGS as readonly string[]).includes(flag),
      ),
      sampleCollector: row.sample_collector,
      sampleScryfallId: row.sample_scryfall_id,
      sampleUrl: scryfallPrintingUrl(row.set_code, row.sample_collector),
      blockedBy: drawnNow ? null : signatureBlockedBy(row.signature),
      drawnNow,
      forGood: isForGoodSignature(row.signature),
      inRegistry: isKnownFrameSignature(row.signature),
    };
  });
}

/** The page's order (D4): most distinct users, then most requests, then the
 *  latest. The RPC already sorts this way (its 500-row limit needs it);
 *  this keeps the panel honest about it. Pure: returns a new array. */
export function sortFrameRequestRows(rows: readonly FrameRequestRow[]): FrameRequestRow[] {
  return [...rows].sort(
    (a, b) =>
      b.users - a.users ||
      b.count - a.count ||
      Date.parse(b.lastSeen) - Date.parse(a.lastSeen),
  );
}

export function windowSince(range: FrameRequestWindow, now = Date.now()): string | null {
  if (range === "all") return null;
  return new Date(now - Number(range) * 24 * 60 * 60 * 1000).toISOString();
}

/** The admin page's data. Null for non-admins (the page 404s). */
export async function getFrameRequestSummary(
  range: FrameRequestWindow,
): Promise<FrameRequestSummary | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;

  const empty = (error: string | null): FrameRequestSummary => ({
    window: range,
    rows: [],
    totalRequests: 0,
    error,
  });
  if (!isAdminConfigured()) return empty("The admin key isn't configured here.");

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("admin_frame_request_counts", {
      p_since: windowSince(range),
    });
    if (error) {
      console.warn("getFrameRequestSummary: rpc error", error.message);
      // The shared dev DB has no migration 0123 until it merges.
      return empty("Couldn't read the request log (is migration 0123 applied here?).");
    }
    const rows = sortFrameRequestRows(mapFrameRequestRows((data ?? []) as RpcRow[]));
    return {
      window: range,
      rows,
      totalRequests: rows.reduce((sum, row) => sum + row.count, 0),
      error: null,
    };
  } catch (error) {
    console.warn(
      "getFrameRequestSummary: failed",
      error instanceof Error ? error.message : error,
    );
    return empty("Couldn't read the request log.");
  }
}

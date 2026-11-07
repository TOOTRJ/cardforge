import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { TOOL_EVENT_RE, isToolSlug } from "./catalog";
import type { ToolAccessPath } from "./access";

// ---------------------------------------------------------------------------
// tool_events writes (migration 0182) — what /admin/tools' analytics read.
// Best effort by design: instrumentation never fails a tool action, so every
// error is logged and swallowed. `open` is a tool page view; anything else is
// a USE (a search, a generation, a download) named by the tool.
// Props: at most 12 scalar values (string ≤ 120 chars, finite number,
// boolean) — never a card's text, a prompt, an email or a file name.
// ---------------------------------------------------------------------------

export type ToolEventProps = Record<string, string | number | boolean | null>;

const MAX_PROPS = 12;
const MAX_STRING = 120;

export function sanitizeToolEventProps(props: unknown): ToolEventProps {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  const out: ToolEventProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

export async function recordToolEvent(input: {
  slug: string;
  userId: string | null;
  event: string;
  access: ToolAccessPath | null;
  props?: unknown;
}): Promise<void> {
  if (!isToolSlug(input.slug) || !TOOL_EVENT_RE.test(input.event) || !isAdminConfigured()) return;
  try {
    const { error } = await createAdminClient()
      .from("tool_events")
      .insert({
        tool_slug: input.slug,
        user_id: input.userId,
        event: input.event,
        access: input.access,
        props: sanitizeToolEventProps(input.props),
      });
    if (error) console.warn(`[tools] ${input.slug}/${input.event} not recorded:`, error.message);
  } catch (error) {
    console.warn(
      `[tools] ${input.slug}/${input.event} not recorded:`,
      error instanceof Error ? error.message : error,
    );
  }
}

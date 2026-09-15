"use client";

// ---------------------------------------------------------------------------
// UpdatePrompt — tells a stale tab that production has moved on.
//
//   * Polls /api/version (cookie-less, uncached) on mount, when the tab
//     regains focus/visibility, and every 10 minutes while visible.
//   * On a mismatch: a small pill, bottom-centre — "PipGlyph was updated.
//     Refresh to get the latest." with Refresh / Later (30-minute snooze).
//     Never a modal: people are mid-edit, mid-wizard, or have an export
//     assembling in this tab.
//   * Reloads on its own at the next SAFE moment: a client-side navigation
//     while no AI job is stepping and no export is building. A hard reload
//     of the page just navigated to loses nothing.
//   * Never loops: the remote id we reloaded for is remembered; if it still
//     mismatches afterwards (rollback, or the check raced a promotion) the
//     prompt stays quiet for that id.
// ---------------------------------------------------------------------------

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerationContext } from "@/components/ai/generation-provider";
import { useDeckExport } from "@/components/decks/deck-export-provider";
import { BUILD_ID } from "@/lib/build-id";
import {
  decideUpdate,
  MIN_CHECK_GAP_MS,
  POLL_MS,
  SNOOZE_MS,
} from "@/lib/updates/build-check";

const RELOADED_KEY = "pipglyph:update-reloaded-for";
const SNOOZE_KEY = "pipglyph:update-snoozed-until";
/** Dev aid: `localStorage.setItem("pipglyph:fake-build", "x")` makes this tab
 *  believe it was built as "x", so the prompt can be exercised locally. */
const FAKE_BUILD_KEY = "pipglyph:fake-build";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage — the prompt still works, just without memory.
  }
}

export function UpdatePrompt() {
  const pathname = usePathname();
  const generation = useGenerationContext();
  const exporter = useDeckExport();
  const [remote, setRemote] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const lastCheckRef = useRef(0);
  const busy = generation.busy || exporter.busy;

  const currentBuild = useCallback(() => {
    if (process.env.NODE_ENV !== "production") return read(FAKE_BUILD_KEY) || BUILD_ID;
    return BUILD_ID;
  }, []);

  const check = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
    lastCheckRef.current = now;
    try {
      const response = await fetch(`/api/version?t=${now}`, {
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { build?: string };
      if (typeof body.build !== "string") return;
      setRemote(body.build);
      const snoozed = Number(read(SNOOZE_KEY));
      const decision = decideUpdate({
        current: currentBuild(),
        remote: body.build,
        reloadedFor: read(RELOADED_KEY),
        snoozedUntil: Number.isFinite(snoozed) && snoozed > 0 ? snoozed : null,
        now,
      });
      setVisible(decision === "prompt");
    } catch {
      // Offline or a blip — try again on the next trigger.
    }
  }, [currentBuild]);

  // Mount (after a short delay so it never competes with first paint),
  // focus/visibility, and a slow interval while visible.
  useEffect(() => {
    const first = setTimeout(() => void check(), 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [check]);

  const reload = useCallback(
    (target: string) => {
      write(RELOADED_KEY, target);
      window.location.reload();
    },
    [],
  );

  // Safe-moment auto reload: a client navigation with nothing running.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (pathname === lastPathRef.current) return;
    lastPathRef.current = pathname;
    if (!remote || !visible || busy) return;
    if (read(RELOADED_KEY) === remote) return;
    reload(remote);
  }, [pathname, remote, visible, busy, reload]);

  if (!visible || !remote) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-full items-center gap-3 rounded-full border border-gold/40 bg-surface/95 py-2 pl-4 pr-2 shadow-xl backdrop-blur">
        <Sparkles className="h-4 w-4 shrink-0 text-gold" aria-hidden />
        <span className="text-sm text-foreground">
          <span className="font-semibold">PipGlyph was updated.</span>{" "}
          <span className="text-muted">Refresh to get the latest.</span>
        </span>
        <Button type="button" size="sm" onClick={() => reload(remote)} className="rounded-full">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
        <button
          type="button"
          onClick={() => {
            write(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
            setVisible(false);
          }}
          aria-label="Later"
          className="rounded-full p-1.5 text-subtle transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

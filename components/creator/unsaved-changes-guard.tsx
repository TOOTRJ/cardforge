"use client";

// Unsaved-changes guard for the card creator (owner decision 2026-09-16):
// nothing is saved automatically any more, so leaving the editor with
// changes has to ASK — save as a draft, leave without saving, or stay.
//
// What can be intercepted in a browser:
//   • in-app link clicks (header, dashboard, "Cancel", …) — capture-phase
//     click listener, so the intent is caught before Next's <Link> routes;
//   • the browser Back button — a sentinel history entry is pushed while
//     dirty; popping it shows the dialog and "leave" walks past it;
//   • closing / reloading the tab — only the browser's own "Leave site?"
//     prompt is possible there (beforeunload), without our draft option.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingLeave = { proceed: () => void };

type UseUnsavedChangesGuardOptions = {
  /** True while the form has changes worth asking about. */
  enabled: boolean;
};

/** Registers the click / Back / beforeunload interceptors and returns the
 *  pending navigation (null when none) plus a way to clear it. */
export function useUnsavedChangesGuard({ enabled }: UseUnsavedChangesGuardOptions) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Native prompt for tab close / reload.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (enabledRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // In-app link clicks.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!enabledRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download") || anchor.dataset.noGuard != null) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // same page (e.g. a hash jump) — nothing to lose
      }
      event.preventDefault();
      event.stopPropagation();
      const destination = `${url.pathname}${url.search}${url.hash}`;
      setPending({ proceed: () => router.push(destination) });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [router]);

  // Browser Back: keep a sentinel entry on top of the real one while dirty.
  const sentinelArmedRef = useRef(false);
  useEffect(() => {
    if (enabled && !sentinelArmedRef.current) {
      sentinelArmedRef.current = true;
      window.history.pushState({ pipglyphUnsavedGuard: true }, "", window.location.href);
    }
  }, [enabled]);
  useEffect(() => {
    const handler = () => {
      if (!enabledRef.current || !sentinelArmedRef.current) return;
      // The sentinel was popped: put it back and ask. "Leave" then goes
      // back TWO entries (past the real one we are standing on).
      window.history.pushState({ pipglyphUnsavedGuard: true }, "", window.location.href);
      setPending({
        proceed: () => {
          sentinelArmedRef.current = false;
          window.history.go(-2);
        },
      });
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return {
    pending,
    clearPending: () => setPending(null),
    /** Run after a save so the next navigation isn't intercepted. */
    disarm: () => {
      enabledRef.current = false;
    },
  };
}

type UnsavedChangesDialogProps = {
  open: boolean;
  /** "draft" offers "Save as draft" (create / remix); "changes" offers
   *  "Save changes" (edit). */
  saveKind: "draft" | "changes";
  /** Why saving isn't possible right now (e.g. no title yet) — disables the
   *  save option and explains. */
  saveBlockedReason: string | null;
  saving: boolean;
  onSave: () => void;
  onLeave: () => void;
  onStay: () => void;
};

export function UnsavedChangesDialog({
  open,
  saveKind,
  saveBlockedReason,
  saving,
  onSave,
  onLeave,
  onStay,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onStay())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-gold-strong" aria-hidden />
            Leave without saving?
          </DialogTitle>
          <DialogDescription>
            {saveKind === "draft"
              ? "This card hasn't been saved. Save it as a private draft to finish later, or leave and lose it."
              : "You have unsaved changes to this card. Save them, or leave and discard them."}
          </DialogDescription>
        </DialogHeader>
        {saveBlockedReason ? (
          <p className="px-5 text-xs leading-5 text-gold">{saveBlockedReason}</p>
        ) : null}
        <DialogFooter className="flex-wrap px-5 pb-5 pt-2">
          <Button type="button" variant="ghost" onClick={onStay} disabled={saving}>
            Keep editing
          </Button>
          <Button type="button" variant="outline" onClick={onLeave} disabled={saving}>
            Leave without saving
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={saving || Boolean(saveBlockedReason)}
            title={saveBlockedReason ?? undefined}
          >
            <Save className="h-4 w-4" aria-hidden />
            {saving
              ? "Saving…"
              : saveKind === "draft"
                ? "Save as draft"
                : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

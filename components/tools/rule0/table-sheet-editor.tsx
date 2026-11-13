"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2, Loader2, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { textareaClass } from "@/components/ui/field-classes";
import { FieldGroup } from "@/components/creator/field-group";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { trackToolEvent } from "@/lib/tools/track-client";
import { readReferralShareInfo } from "@/lib/sharing/referral-share-client";
import { referralUrlFor } from "@/lib/sharing/share-url";
import { saveTableSheetAction, setTableSheetSharedAction } from "@/lib/tools/rule0/actions";
import { RULE0_TOOL_SLUG, type TableSheetRow } from "@/lib/tools/rule0/model";
import type { TableSheetFacts } from "@/lib/tools/rule0/sheet";
import { TABLE_SHEET_LIMITS, winConditionLines } from "@/lib/validation/table-sheet";
import type { QrPath } from "@/lib/qr/qr-path";
import { TableSheet, type TableSheetDeck, type TableSheetText } from "./table-sheet";

// ---------------------------------------------------------------------------
// The OWNER's table sheet: the three things only they can say (the game
// plan, the win conditions, anything else for the table), the optional AI
// draft (1 credit), the share switch, Print — and the sheet itself below,
// drawn live as they type. Everything the sheet derives from the deck
// (bracket, Game Changers, custom cards) comes from the server as `facts`.
// ---------------------------------------------------------------------------

type Fields = { gamePlan: string; winConditions: string; tableNotes: string };
type FieldKey = keyof Fields;

function fieldsOf(sheet: Pick<TableSheetRow, "gamePlan" | "winConditions" | "tableNotes">): Fields {
  return { gamePlan: sheet.gamePlan ?? "", winConditions: sheet.winConditions ?? "", tableNotes: sheet.tableNotes ?? "" };
}

const same = (a: Fields, b: Fields) =>
  a.gamePlan.trim() === b.gamePlan.trim() &&
  a.winConditions.trim() === b.winConditions.trim() &&
  a.tableNotes.trim() === b.tableNotes.trim();

export function TableSheetEditor({
  deckId,
  deckSlug,
  deckVisibility,
  deck,
  facts,
  initial,
  qr,
  shareUrl,
  aiAvailable,
}: {
  deckId: string;
  deckSlug: string;
  deckVisibility: "public" | "unlisted" | "private";
  deck: TableSheetDeck;
  facts: TableSheetFacts;
  initial: Omit<TableSheetRow, "deckId">;
  qr: { url: string; path: QrPath } | null;
  /** The sheet's own address (absolute), for "Copy link". */
  shareUrl: string;
  aiAvailable: boolean;
}) {
  const ids = { status: useId(), share: useId(), aiTitle: useId() };
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(initial));
  const [fields, setFields] = useState<Fields>(() => fieldsOf(initial));
  const [shared, setShared] = useState(initial.shared);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saving, startSave] = useTransition();
  const [sharing, startShare] = useTransition();
  const [drafting, setDrafting] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const draftButton = useRef<HTMLButtonElement>(null);
  const gamePlanRef = useRef<HTMLTextAreaElement>(null);
  const winConditionsRef = useRef<HTMLTextAreaElement>(null);
  const tableNotesRef = useRef<HTMLTextAreaElement>(null);
  const focusField = (key: FieldKey) =>
    (key === "gamePlan" ? gamePlanRef : key === "winConditions" ? winConditionsRef : tableNotesRef).current?.focus();
  const upgrade = useUpgradeModal();

  const dirty = !same(fields, saved);
  const isPrivate = deckVisibility === "private";
  const shareBlocked = isPrivate && !shared;
  useLeaveWarning(dirty || drafting);

  const set = (key: FieldKey) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setFields((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = () => {
    // aria-disabled, never `disabled`: a control that disables itself under
    // the focus drops it to <body> — the guards keep it reachable and inert.
    if (!dirty || saving) return;
    setFormError(null);
    startSave(async () => {
      const result = await saveTableSheetAction(deckId, fields);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
        const first = (["gamePlan", "winConditions", "tableNotes"] as const).find((key) => result.fieldErrors?.[key]);
        if (first) focusField(first);
        return;
      }
      const next = fieldsOf(result.sheet);
      setSaved(next);
      setFields(next);
      setErrors({});
      setStatus("Sheet saved.");
      toast.success("Table sheet saved.");
    });
  };

  const toggleShare = () => {
    if (sharing || shareBlocked) return;
    const next = !shared;
    setFormError(null);
    startShare(async () => {
      const result = await setTableSheetSharedAction(deckId, next);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setShared(result.sheet.shared);
      setStatus(result.sheet.shared ? "Sharing on: anyone who can open the deck can open this sheet." : "Sharing off.");
    });
  };

  // The copied link carries the sharer's referral code, as every other
  // share does (owner 2026-11-11). It is read when the editor opens, never
  // in the click: a browser lets a page write the clipboard only straight
  // from the press, and Safari refuses after a network read was awaited.
  // No code — the program off, the read failed or not back yet — and the
  // link is the plain one.
  const referralCode = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    void readReferralShareInfo()
      .then((info) => {
        if (live) referralCode.current = info?.enabled ? (info.code ?? null) : null;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralUrlFor(shareUrl, referralCode.current));
      toast.success("Link copied.");
      trackToolEvent(RULE0_TOOL_SLUG, "copy_link");
    } catch {
      toast.error("Couldn't copy — the link is in your address bar.");
    }
  };

  const print = () => {
    trackToolEvent(RULE0_TOOL_SLUG, "print", { shared, custom: facts.customCount });
    window.print();
  };

  const hasWrittenText = Boolean(fields.gamePlan.trim() || fields.winConditions.trim());

  const runDraft = async () => {
    setConfirmDraft(false);
    setDrafting(true);
    setFormError(null);
    setStatus("Drafting the game plan from your cards. This takes up to a minute.");
    // Tracking only: an answer that never reached this page is one the
    // route may not have recorded (a dropped connection, a stopped function).
    const startedAt = Date.now();
    const lost = (reason: "no_answer" | "network", status?: number) => {
      try {
        trackToolEvent(RULE0_TOOL_SLUG, "ai_draft_lost", {
          reason,
          ...(status === undefined ? {} : { status }),
          ms: Date.now() - startedAt,
        });
      } catch {
        // Tracking never changes what the page says.
      }
    };
    try {
      const response = await fetch("/api/tools/rule0-sheet/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deckId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; draft: { gamePlan: string; winConditions: string[] }; sheet: TableSheetRow | null; credits: number | null }
        | { ok: false; error?: string; code?: string; credits?: number | null }
        | null;
      if (body && typeof body.credits === "number") publishCredits(body.credits);
      if (!body || !body.ok) {
        if (!body) lost("no_answer", response.status);
        const message = body?.error ?? "The draft didn't finish. Try again.";
        if (body?.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", "rule0_sheet");
        setFormError(message);
        setStatus("");
        return;
      }
      const drafted = { ...fields, gamePlan: body.draft.gamePlan, winConditions: body.draft.winConditions.join("\n") };
      setFields(drafted);
      // Written to the sheet by the route; if that write failed the draft
      // stays in the form, unsaved, for Save.
      if (body.sheet) setSaved(fieldsOf(body.sheet));
      setErrors({});
      const words = body.sheet ? "Draft saved to the sheet — edit it as you like." : "Draft ready — press Save to keep it.";
      setStatus(words);
      toast.success(words);
      focusField("gamePlan");
    } catch {
      lost("network");
      // The route writes the draft to the sheet before it answers: a lost
      // answer is often a draft that is already saved.
      const message =
        "We lost the answer. If the draft was written, it is saved on your sheet and shows after a reload (save what you have typed first). If it wasn't, the credit comes back by itself within the hour.";
      setFormError(message);
      setStatus("");
    } finally {
      setDrafting(false);
    }
  };

  const draftOff = drafting || facts.cardCount === 0;
  const startDraft = () => {
    if (draftOff) return;
    if (hasWrittenText) setConfirmDraft(true);
    else void runDraft();
  };

  const winCount = winConditionLines(fields.winConditions).length;
  const text: TableSheetText = {
    gamePlan: fields.gamePlan.trim() || null,
    winConditions: fields.winConditions.trim() || null,
    tableNotes: fields.tableNotes.trim() || null,
  };

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <h1 className="sr-only">Table sheet for {deck.title}</h1>
      <section aria-label="Your words for the table" className="table-sheet-controls flex flex-col gap-5 rounded-frame border border-border/60 bg-surface/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 className="font-display text-lg font-semibold text-foreground">Your words for the table</h2>
            <p className="text-sm leading-6 text-muted">
              The bracket check and the custom cards fill themselves in from the deck. Say how it plays and how it wins —
              or let AI write a first draft from your cards.
            </p>
          </div>
          {aiAvailable ? (
            <Button
              ref={draftButton}
              type="button"
              variant="secondary"
              size="sm"
              className="aria-disabled:cursor-default aria-disabled:opacity-60"
              onClick={startDraft}
              aria-disabled={draftOff || undefined}
              aria-busy={drafting || undefined}
              aria-describedby={facts.cardCount === 0 ? ids.status : undefined}
            >
              {drafting ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              {drafting ? "Drafting…" : "Draft with AI · 1 credit"}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <FieldGroup
            label="Game plan"
            helper={`How the deck plays, for the other players. ${fields.gamePlan.length}/${TABLE_SHEET_LIMITS.gamePlan}`}
            error={errors.gamePlan}
          >
            <textarea
              ref={gamePlanRef}
              rows={5}
              maxLength={TABLE_SHEET_LIMITS.gamePlan}
              value={fields.gamePlan}
              onChange={set("gamePlan")}
              placeholder="Ramp into big threats, draw cards, and win with a wide board in the late game."
              className={textareaClass(Boolean(errors.gamePlan))}
            />
          </FieldGroup>
          <FieldGroup
            label="Win conditions"
            helper={`One per line, up to ${TABLE_SHEET_LIMITS.winConditionLines}. ${winCount} listed.`}
            error={errors.winConditions}
          >
            <textarea
              ref={winConditionsRef}
              rows={5}
              maxLength={TABLE_SHEET_LIMITS.winConditions}
              value={fields.winConditions}
              onChange={set("winConditions")}
              placeholder={"Combat damage with a wide board\nA big drain with my commander"}
              className={textareaClass(Boolean(errors.winConditions))}
            />
          </FieldGroup>
        </div>
        <FieldGroup
          label="Anything else for the table"
          helper={`House rules, cards you're happy to swap out, what you'd like to avoid. Optional. ${fields.tableNotes.length}/${TABLE_SHEET_LIMITS.tableNotes}`}
          error={errors.tableNotes}
        >
          <textarea
            ref={tableNotesRef}
            rows={2}
            maxLength={TABLE_SHEET_LIMITS.tableNotes}
            value={fields.tableNotes}
            onChange={set("tableNotes")}
            className={textareaClass(Boolean(errors.tableNotes))}
          />
        </FieldGroup>

        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            onClick={save}
            aria-disabled={!dirty || saving || undefined}
            aria-busy={saving || undefined}
            className="aria-disabled:cursor-default aria-disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Button type="button" variant="secondary" onClick={print}>
            <Printer aria-hidden />
            Print
          </Button>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={shared}
              aria-describedby={ids.share}
              // A private deck's sheet can't be shared: the switch stays
              // reachable (its reason is its description), it just does nothing.
              aria-disabled={shareBlocked || sharing || undefined}
              aria-busy={sharing || undefined}
              onClick={shareBlocked ? undefined : toggleShare}
              className="inline-flex h-9 items-center gap-2 rounded-control border border-border px-3 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <span
                aria-hidden
                className={`relative inline-block h-4 w-7 rounded-full transition-colors ${shared ? "bg-primary" : "bg-border-strong"}`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${shared ? "left-3.5" : "left-0.5"}`}
                />
              </span>
              <Link2 className="h-4 w-4" aria-hidden />
              Share this sheet
            </button>
            {shared ? (
              <Button type="button" variant="ghost" size="sm" onClick={copyLink}>
                <Copy aria-hidden />
                Copy link
              </Button>
            ) : null}
          </div>
          <p id={ids.share} className="w-full text-xs leading-5 text-muted">
            {isPrivate
              ? "This deck is private, so only you can open its sheet — and the printed page has no QR code. Make the deck unlisted or public in its details to share."
              : shared
                ? deckVisibility === "unlisted"
                  ? "Anyone with the link can open this sheet, as with the unlisted deck itself."
                  : "Anyone who can open the deck can open this sheet."
                : "Only you can open this sheet. Turn sharing on to send the link to your playgroup."}
          </p>
        </div>
        <p id={ids.status} role="status" className="sr-only">
          {facts.cardCount === 0 ? "Add cards to the deck before drafting with AI. " : ""}
          {status}
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <p className="table-sheet-controls text-xs font-semibold uppercase tracking-wider text-subtle">
          The sheet {dirty ? "· unsaved changes" : ""}
        </p>
        <TableSheet deck={deck} facts={facts} text={text} qr={qr} editing />
      </div>

      <p className="table-sheet-controls text-sm text-muted">
        <Link
          href={`/deck/${deckSlug}`}
          className="rounded-sm text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          Back to the deck
        </Link>{" "}
        to change its bracket, cards or visibility.
      </p>

      <Dialog open={confirmDraft} onOpenChange={setConfirmDraft}>
        <DialogContent
          size="sm"
          // Closed either way, the focus goes back to the button that opened it.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            draftButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Replace your game plan and win conditions?</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              The AI draft (1 credit) replaces what&apos;s in those two fields and saves it to the sheet. Your notes for
              the table stay as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 pb-5 pt-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmDraft(false)}>
              Keep mine
            </Button>
            <Button type="button" onClick={() => void runDraft()}>
              <Sparkles aria-hidden />
              Replace with a draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

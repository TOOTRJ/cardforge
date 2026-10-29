"use client";

// ---------------------------------------------------------------------------
// The deck feedback dialog (TODO DK10.1): Idea / Bug / Other and a message,
// filed into the same `feedback` table as /feedback under area "decks"
// (migration 0146), so the admin inbox's Area filter finds it and 0051's
// trigger pings the admins' bell. No subject to write: the inbox takes the
// message's first line (`deckFeedbackSubject`).
//
// It attaches three things by itself and SAYS so above Send ("We'll
// include: …"): the deck it was opened on, the page's PATH (never its query
// string or hash) and the window size. Signed out, it explains why it needs
// an account and links to sign in — /feedback's rule, which takes no
// anonymous feedback.
//
// One dialog per trigger (the deck toolbar, the deck footer, My Decks, the
// beta banner): Radix returns the focus to the button that opened it. Radix
// also UNMOUNTS the content on close, so the draft (kind + message) lives
// here, above it: Escape or a backdrop click never loses a long report —
// only a send clears it.
// ---------------------------------------------------------------------------

import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Info, Loader2, MessageSquare, Send } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup, textareaClass } from "@/components/creator/field-group";
import { cn } from "@/lib/utils";
import { submitDeckFeedbackAction } from "@/lib/feedback/actions";
import {
  DECK_FEEDBACK_KINDS,
  deckFeedbackSchema,
  viewportOf,
  type DeckFeedbackKind,
} from "@/lib/feedback/schemas";

const KIND_OPTIONS: ChipOption<DeckFeedbackKind>[] = DECK_FEEDBACK_KINDS.map((k) => ({
  value: k.key,
  label: k.label,
}));

/** What the dialog attaches, in the words it shows above Send. */
export function deckFeedbackIncludes(hasDeck: boolean): string {
  return hasDeck
    ? "We’ll include: this deck, the page address and your window size."
    : "We’ll include: the page address and your window size.";
}

type Draft = { kind: DeckFeedbackKind; message: string };
const EMPTY_DRAFT: Draft = { kind: "idea", message: "" };

export function DeckFeedbackDialog({
  deckId = null,
  signedIn,
  trigger,
}: {
  /** The deck it was opened on; null on My Decks. */
  deckId?: string | null;
  signedIn: boolean;
  /** The button that opens it (rendered through `DialogTrigger asChild`). */
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  // The unsent draft outlives the content Radix unmounts on close.
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A sent dialog opens on a fresh form next time.
        if (!next && sent) setSent(false);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Feedback on decks</DialogTitle>
          <DialogDescription>
            An idea, a bug, anything missing — it goes straight to the team.
          </DialogDescription>
        </DialogHeader>
        {!signedIn ? (
          <SignedOutBody />
        ) : sent ? (
          <SentBody />
        ) : (
          <DeckFeedbackForm
            deckId={deckId}
            draft={draft}
            onDraftChange={setDraft}
            onSent={() => {
              setDraft(EMPTY_DRAFT);
              setSent(true);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeckFeedbackForm({
  deckId,
  draft,
  onDraftChange,
  onSent,
}: {
  deckId: string | null;
  draft: Draft;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
  onSent: () => void;
}) {
  const { kind, message } = draft;
  const setKind = (next: DeckFeedbackKind) => onDraftChange((d) => ({ ...d, kind: next }));
  const setMessage = (next: string) => onDraftChange((d) => ({ ...d, message: next }));
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const includesId = useId();
  const hint = DECK_FEEDBACK_KINDS.find((k) => k.key === kind)?.hint;

  const onSubmit = async () => {
    // Send stays focusable while a send is out (aria-disabled, see below):
    // a second press is ignored here, never by a `disabled` that would drop
    // the focus to <body> and leave it there after a refusal.
    if (sending) return;
    const payload = {
      kind,
      message,
      deck_id: deckId ?? "",
      // The path alone — never `location.search` or the hash.
      page_url: window.location.pathname,
      viewport: viewportOf(window.innerWidth, window.innerHeight) ?? "",
    };
    // The server action's own schema, so an empty or too-long message is
    // said inline before a round trip; the server checks it again.
    const parsed = deckFeedbackSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === "message");
      if (issue) {
        setMessageError(issue.message);
        setFormError(null);
        messageRef.current?.focus();
      } else {
        setMessageError(null);
        setFormError(parsed.error.issues[0]?.message ?? "Check your feedback and try again.");
      }
      return;
    }
    setMessageError(null);
    setFormError(null);
    setSending(true);
    try {
      const result = await submitDeckFeedbackAction(payload);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {/* ONE control with a role of its own (a radiogroup): `kind="control"`,
          the row named for the field and described by the kind's hint. */}
      <FieldGroup kind="control" label="What kind of feedback?" helper={hint}>
        {(aria) => (
          <ChipGroup
            ariaLabel="What kind of feedback?"
            ariaDescribedBy={aria["aria-describedby"]}
            layout="wrap"
            size="md"
            keepCase
            value={kind}
            onChange={setKind}
            options={KIND_OPTIONS}
          />
        )}
      </FieldGroup>

      <FieldGroup
        label="Message"
        error={messageError ?? undefined}
        helper={
          kind === "bug"
            ? "What did you do, what did you expect, and what happened instead?"
            : "The more specific, the better."
        }
      >
        <textarea
          ref={messageRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={kind === "idea" ? "I wish the deck builder could…" : "Tell us everything…"}
          className={textareaClass(Boolean(messageError))}
        />
      </FieldGroup>

      <p id={includesId} className="flex items-start gap-2 text-xs leading-5 text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
        {deckFeedbackIncludes(Boolean(deckId))}
      </p>

      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <DialogFooter className="border-t-0 px-0 py-0">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="sm">
            Cancel
          </Button>
        </DialogClose>
        {/* While sending: aria-disabled, never `disabled` — the focus stays
            on Send, so after a refusal it is still here and the alert above
            is the one announcement (onSubmit ignores the press). Empty:
            `disabled`, there is nothing to send and the focus is in the
            message. */}
        <Button
          type="submit"
          size="sm"
          aria-describedby={includesId}
          aria-disabled={sending || undefined}
          disabled={!sending && !message.trim()}
          className={sending ? "cursor-wait opacity-70" : undefined}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {sending ? "Sending…" : "Send feedback"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SentBody() {
  const doneRef = useRef<HTMLButtonElement>(null);
  const thanksId = useId();
  // The Send button the focus was on is gone with the form: the focus moves
  // to Done, which reads the thank-you as its description.
  useEffect(() => {
    doneRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <CheckCircle2 className="h-8 w-8 text-primary-bright" aria-hidden />
      <p id={thanksId} className="text-sm font-medium text-foreground">
        Thank you — it’s with the team.
      </p>
      <p className="max-w-sm text-sm leading-6 text-muted">
        You can follow its status on your{" "}
        <Link href="/feedback" className="text-primary-bright hover:underline">
          feedback page
        </Link>
        .
      </p>
      <DialogClose
        ref={doneRef}
        aria-describedby={thanksId}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Done
      </DialogClose>
    </div>
  );
}

function SignedOutBody() {
  const pathname = usePathname() ?? "/decks";
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-5">
      <p className="text-sm leading-6 text-muted">
        Sign in to send feedback — it lets us follow up and show you the status
        of what you’ve reported.
      </p>
      <Button asChild size="sm">
        <Link href={`/login?redirectTo=${encodeURIComponent(pathname)}`}>Sign in</Link>
      </Button>
    </div>
  );
}

/** The usual "Feedback" button with its dialog — the deck toolbar's and My
 *  Decks'. */
export function DeckFeedbackButton({
  deckId = null,
  signedIn,
  label = "Feedback",
  variant = "outline",
  className,
}: {
  deckId?: string | null;
  signedIn: boolean;
  label?: string;
  variant?: "outline" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <DeckFeedbackDialog
      deckId={deckId}
      signedIn={signedIn}
      trigger={
        <Button type="button" variant={variant} size="sm" className={className}>
          <MessageSquare className="h-4 w-4" aria-hidden />
          {label}
        </Button>
      }
    />
  );
}

/** The deck page's last word: a quiet line and the same dialog. */
export function DeckFeedbackFooter({
  deckId,
  signedIn,
  className,
}: {
  deckId: string;
  signedIn: boolean;
  className?: string;
}) {
  return (
    <aside
      aria-label="Deck builder feedback"
      className={cn(
        "mt-12 flex flex-col items-start gap-3 rounded-frame border border-border/60 bg-elevated/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-sm leading-6 text-muted">
        Something missing or broken in the deck builder? Tell us.
      </p>
      <DeckFeedbackButton deckId={deckId} signedIn={signedIn} label="Send feedback" />
    </aside>
  );
}

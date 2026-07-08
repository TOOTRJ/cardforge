"use client";

// Feedback intake form — category-first (the picker routes the submission
// and reveals the right context field), one subject + message, and a clear
// success state that sets expectations. Deep-linkable: ?category=frame /
// ?template=m15pw preselect, ?from=/some/page is captured as context.

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
import { submitFeedbackAction } from "@/lib/feedback/actions";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_KEYS,
  type FeedbackCategory,
} from "@/lib/feedback/schemas";
import { FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_VALUES } from "@/types/card";

export function FeedbackForm({ signedIn }: { signedIn: boolean }) {
  const params = useSearchParams();
  const initialCategory = ((): FeedbackCategory => {
    const c = params.get("category");
    return (FEEDBACK_CATEGORY_KEYS as string[]).includes(c ?? "")
      ? (c as FeedbackCategory)
      : "bug";
  })();
  const initialTemplate = ((): string => {
    const t = params.get("template");
    return (FRAME_TEMPLATE_VALUES as readonly string[]).includes(t ?? "")
      ? (t as string)
      : "";
  })();

  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [frameTemplate, setFrameTemplate] = useState(initialTemplate);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const categoryOptions: ChipOption<FeedbackCategory>[] =
    FEEDBACK_CATEGORIES.map((c) => ({
      value: c.key,
      label: c.label,
      description: c.hint,
    }));

  const showFrameSelect = category === "frame";
  const activeHint = FEEDBACK_CATEGORIES.find((c) => c.key === category)?.hint;

  const onSubmit = async () => {
    setSending(true);
    try {
      const result = await submitFeedbackAction({
        category,
        subject,
        message,
        frame_template: showFrameSelect ? frameTemplate : "",
        page_url: params.get("from") ?? "",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-6 py-10 text-center">
        <CheckCircle2 className="h-8 w-8 text-primary-bright" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          Thank you — we read every submission.
        </p>
        <p className="max-w-md text-sm leading-6 text-muted">
          Your feedback goes straight to the team. You can track its status in
          the list below.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSent(false);
            setSubject("");
            setMessage("");
          }}
        >
          Send more feedback
        </Button>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border/60 bg-elevated/40 px-6 py-8">
        <p className="text-sm leading-6 text-muted">
          Sign in to send feedback — it lets us follow up and show you the
          status of what you&apos;ve reported.
        </p>
        <Link
          href="/login?redirectTo=%2Ffeedback"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <FieldGroup label="What kind of feedback is this?" helper={activeHint}>
        <ChipGroup
          ariaLabel="Feedback category"
          layout="grid-2"
          size="md"
          value={category}
          onChange={setCategory}
          options={categoryOptions}
        />
      </FieldGroup>

      {showFrameSelect ? (
        <FieldGroup
          label="Which frame?"
          helper="Optional — pick the frame the issue appears on."
        >
          <select
            value={frameTemplate}
            onChange={(e) => setFrameTemplate(e.target.value)}
            className={inputClass(false)}
          >
            <option value="">Not sure / several</option>
            {FRAME_TEMPLATE_VALUES.map((t) => (
              <option key={t} value={t}>
                {FRAME_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </FieldGroup>
      ) : null}

      <FieldGroup label="Subject">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          required
          placeholder={
            category === "frame_request"
              ? "e.g. Retro artifact frame"
              : category === "feature"
                ? "e.g. Deck export to PDF"
                : "A short summary"
          }
          className={inputClass(false)}
        />
      </FieldGroup>

      <FieldGroup
        label="Details"
        helper={
          category === "bug" || category === "frame"
            ? "What did you do, what did you expect, and what happened instead? A link to the card helps a lot."
            : "The more specific, the better."
        }
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
          required
          rows={6}
          placeholder="Tell us everything…"
          className={textareaClass(false)}
        />
      </FieldGroup>

      <div>
        <Button type="submit" disabled={sending || !subject.trim() || !message.trim()}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {sending ? "Sending…" : "Send feedback"}
        </Button>
      </div>
    </form>
  );
}

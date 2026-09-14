"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
import { adminStartThreadAction } from "@/lib/messages/actions";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
  startThreadSchema,
} from "@/lib/messages/schemas";

// ---------------------------------------------------------------------------
// NewMessageDialog — "Message this user" from /admin/users. Subject + first
// message; on success the admin lands in the new thread. The user gets a
// bell notification (and an email when Resend is configured) from the
// messages insert trigger.
// ---------------------------------------------------------------------------

export function NewMessageDialog({
  userId,
  userLabel,
  variant = "outline",
}: {
  userId: string;
  userLabel: string;
  variant?: "primary" | "outline" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const parsed = startThreadSchema.safeParse({ userId, subject, body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await adminStartThreadAction(parsed.data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Message sent to ${userLabel}.`);
      setOpen(false);
      setSubject("");
      setBody("");
      router.push(`/admin/messages/${result.threadId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm">
          <MessageSquarePlus className="h-4 w-4" aria-hidden />
          Message
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Message {userLabel}</DialogTitle>
          <DialogDescription>
            Starts a private conversation. They&apos;ll see it under Messages in
            their dashboard, get a notification, and can reply.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup label="Subject" helper={`Up to ${MESSAGE_SUBJECT_MAX} characters.`}>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={MESSAGE_SUBJECT_MAX}
              placeholder="About your recent export issue"
              className={inputClass(false)}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup
            label="Message"
            error={error ?? undefined}
            helper={`Up to ${MESSAGE_BODY_MAX.toLocaleString()} characters. Sent as the PipGlyph team.`}
          >
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Hi! We saw your feedback and…"
              className={textareaClass(Boolean(error))}
            />
          </FieldGroup>
          <DialogFooter className="border-t-0 px-0 py-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !subject.trim() || !body.trim()}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Send message
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

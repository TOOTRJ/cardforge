"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction, type UnsubscribeState } from "@/lib/email/preferences-actions";

const initialState: UnsubscribeState = { status: "idle" };

export function UnsubscribeForm({
  token,
  list,
  label,
}: {
  token: string;
  list: string;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(unsubscribeAction, initialState);

  if (state.status === "done") {
    return (
      <div
        role="status"
        className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
      >
        Done — you won&apos;t receive {label} emails any more. You can turn them
        back on in your settings whenever you like.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="list" value={list} />
      {state.status === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          That didn&apos;t work — the link may be out of date. Sign in and use
          your email settings instead.
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Working…" : "Unsubscribe"}
        </Button>
      </div>
    </form>
  );
}

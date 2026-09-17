"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  confirmEmailLinkAction,
  type ConfirmLinkState,
} from "@/app/(auth)/actions";
import type { EmailLinkType } from "@/lib/auth/email-links";

const initialState: ConfirmLinkState = { status: "idle" };

export function ConfirmLinkForm({
  tokenHash,
  type,
  next,
  buttonLabel,
}: {
  tokenHash: string;
  type: EmailLinkType;
  next?: string;
  buttonLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(
    confirmEmailLinkAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.status === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {state.error}{" "}
          <Link
            href={type === "recovery" ? "/forgot-password" : "/login"}
            className="font-medium text-primary-bright hover:underline"
          >
            {type === "recovery" ? "Request a new reset link" : "Back to sign in"}
          </Link>
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Working…" : buttonLabel}
      </Button>
    </form>
  );
}

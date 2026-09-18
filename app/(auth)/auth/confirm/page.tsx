import type { Metadata } from "next";
import Link from "next/link";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ConfirmLinkForm } from "@/components/auth/confirm-link-form";
import { EMAIL_LINK_COPY, parseEmailLinkType } from "@/lib/auth/email-links";

export const metadata: Metadata = {
  title: "Confirm",
  robots: { index: false, follow: false },
  // The token hash is in the query string — never leak it via Referer.
  referrer: "no-referrer",
};

type SearchParams = { token_hash?: string; type?: string; next?: string };

// The link in a PipGlyph auth email lands HERE, and nothing is verified until
// the visitor presses the button. Mail security scanners and link previewers
// (Outlook Safe Links, corporate gateways) fetch every URL in a message; a
// GET that consumed the one-time token would leave the real user with an
// "expired" link. A POST they never send keeps the token intact.
export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { token_hash: tokenHash, type: rawType, next } = await searchParams;
  const type = parseEmailLinkType(rawType);

  if (!tokenHash || !type) {
    return (
      <SurfaceCard tone="gold" className="flex flex-col gap-6 p-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            This link isn&apos;t complete
          </h1>
          <p className="text-sm text-muted">
            Open the link from your email again, or copy the whole address into
            your browser. If it keeps failing, request a fresh one.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <Link href="/login" className="font-medium text-primary-bright hover:underline">
            Back to sign in
          </Link>
          <Link
            href="/forgot-password"
            className="font-medium text-primary-bright hover:underline"
          >
            Request a password reset
          </Link>
        </div>
      </SurfaceCard>
    );
  }

  const copy = EMAIL_LINK_COPY[type];
  return (
    <SurfaceCard tone="gold" className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </h1>
        <p className="text-sm text-muted">{copy.body}</p>
      </div>
      <ConfirmLinkForm
        tokenHash={tokenHash}
        type={type}
        next={next}
        buttonLabel={copy.button}
      />
    </SurfaceCard>
  );
}

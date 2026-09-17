import type { Metadata } from "next";
import Link from "next/link";
import { SurfaceCard } from "@/components/ui/surface-card";
import { UnsubscribeForm } from "@/components/email/unsubscribe-form";
import { EMAIL_LIST_COPY, isUnsubscribeToken, parseEmailList } from "@/lib/email/lists";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// The footer link of every PipGlyph email. Works signed out (it is opened from
// an inbox); the change happens on the button press, not on page load, so
// link-prefetching mail scanners can't unsubscribe anyone.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; list?: string }>;
}) {
  const { token, list: rawList } = await searchParams;
  const list = parseEmailList(rawList);
  const valid = isUnsubscribeToken(token) && list;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="mx-auto flex max-w-xl flex-col gap-6 p-8">
        {valid ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                Unsubscribe
              </h1>
              <p className="text-sm leading-6 text-muted">
                Stop receiving{" "}
                <span className="font-medium text-foreground">
                  {EMAIL_LIST_COPY[list].label}
                </span>{" "}
                emails from PipGlyph?
              </p>
            </div>
            <UnsubscribeForm token={token} list={list} label={EMAIL_LIST_COPY[list].label} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              This link isn&apos;t complete
            </h1>
            <p className="text-sm leading-6 text-muted">
              Open the unsubscribe link from your email again, or manage every
              email from your settings.
            </p>
          </div>
        )}
        <p className="text-sm text-muted">
          <Link href="/settings#email" className="font-medium text-primary-bright hover:underline">
            Manage all email settings
          </Link>
        </p>
      </SurfaceCard>
    </div>
  );
}

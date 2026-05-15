import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The rules of the road for using CardForge — content ownership, acceptable use, and account responsibilities.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPageShell
      eyebrow="Legal"
      title="Terms of Service"
      description="A plain-English overview of the rules for using CardForge. This is MVP boilerplate — review with a lawyer before relying on it for anything serious."
      lastUpdated="May 2026"
    >
      <p className="rounded-md border border-border/60 bg-elevated px-4 py-3 text-foreground">
        <strong>Heads up:</strong> CardForge is in active development. These
        terms are intentionally short and may evolve. The version published
        here always reflects the current rules.
      </p>

      <h2>1. Accepting these terms</h2>
      <p>
        By creating an account or using CardForge, you agree to follow these
        terms. If you don&apos;t agree, please don&apos;t use the service.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You need to be 13 or older to create an account.</li>
        <li>You&apos;re responsible for keeping your credentials secure.</li>
        <li>
          You may delete your account at any time from the{" "}
          <Link href="/settings">settings page</Link>.
        </li>
      </ul>

      <h2>3. Content you create</h2>
      <p>
        You own the cards, sets, art, and text you upload to CardForge. By
        publishing a card publicly or as unlisted, you grant CardForge a
        non-exclusive license to host, display, and reproduce that content for
        the purpose of running the platform (e.g. rendering it in the gallery,
        generating Open Graph previews, etc.). You can revoke this license at
        any time by deleting the card, set, or your account.
      </p>

      <h2>4. Content you don&apos;t own</h2>
      <p>
        Don&apos;t upload artwork, text, or trademarks you don&apos;t have the
        right to use. That includes — but is not limited to — official
        Wizards of the Coast assets, copyrighted artwork, and trademarked
        names. See the <Link href="/disclaimer">full disclaimer</Link> for the
        long version.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to use CardForge to:</p>
      <ul>
        <li>Harass, defame, or threaten others.</li>
        <li>
          Distribute illegal content, including but not limited to CSAM,
          hate speech, or content that violates export controls.
        </li>
        <li>Attempt to bypass rate limits, exploit the platform, or scrape data without permission.</li>
        <li>
          Use the AI assistant to generate proprietary or trademarked content
          (the assistant is also prompted to refuse, but the
          responsibility ultimately rests with you).
        </li>
      </ul>

      <h2>6. Removal and account actions</h2>
      <p>
        We reserve the right to remove content or suspend accounts that
        violate these terms. We&apos;ll act in good faith and try to give
        notice when we can.
      </p>

      <h2>7. Service availability</h2>
      <p>
        CardForge is provided &quot;as is.&quot; We don&apos;t guarantee
        uptime, error-free operation, or that exported files will render
        exactly the same forever. Practice good hygiene: back up cards that
        matter to you.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>
        We may update these terms. Material changes will be announced — at
        minimum, the &quot;last updated&quot; date above will move forward and
        the new copy will live at this URL.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these terms? See the contact channels on the{" "}
        <Link href="/about">about page</Link>.
      </p>
    </LegalPageShell>
  );
}

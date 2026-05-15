import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What data Spellwright collects, why, and how to delete it. Plain-English overview.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      eyebrow="Legal"
      title="Privacy"
      description="What we collect, why we collect it, and how to delete it."
      lastUpdated="May 2026"
    >
      <p className="rounded-md border border-border/60 bg-elevated px-4 py-3 text-foreground">
        <strong>The short version:</strong> Spellwright collects the minimum it
        needs to run the service — your account, the cards you create, the
        files you upload, and basic event logs. We don&apos;t sell your data.
      </p>

      <h2>1. What we collect</h2>
      <h3>Account data</h3>
      <ul>
        <li>Email address (for authentication)</li>
        <li>Username + display name (public)</li>
        <li>Bio and website URL (public, optional)</li>
        <li>Hashed password (managed by Supabase Auth)</li>
      </ul>

      <h3>Content you create</h3>
      <ul>
        <li>Cards: title, slug, cost, rules text, flavor text, artwork URL, etc.</li>
        <li>Sets and the cards inside them.</li>
        <li>Likes you give to other people&apos;s cards.</li>
        <li>Exported PNGs of your cards in the export bucket.</li>
      </ul>

      <h3>Operational data</h3>
      <ul>
        <li>Standard server logs (IP address, user agent, request paths) for security and abuse prevention.</li>
        <li>
          Supabase auth logs (sign-ins, password resets) handled by Supabase
          per their privacy policy.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To run your account and render your content.</li>
        <li>To show public cards in the gallery, on your profile, and via Open Graph previews when you publish them.</li>
        <li>To enforce <Link href="/terms">our terms</Link> (e.g., investigating reported abuse).</li>
        <li>To improve the product — but we don&apos;t train AI models on your private content.</li>
      </ul>

      <h2>3. Who we share it with</h2>
      <p>We use a small set of vetted infrastructure providers:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — managed Postgres, authentication, and
          storage. Hosts your account and content.
        </li>
        <li>
          <strong>Vercel</strong> — application hosting and the CDN serving
          your card pages.
        </li>
        <li>
          <strong>Anthropic</strong> — only when you click an action in the AI
          assistant. The prompt we send contains the relevant card fields
          (title, rules, cost, etc.) — never your account email or password.
        </li>
      </ul>
      <p>We don&apos;t sell data to third parties or use it for advertising.</p>

      <h2>4. How long we keep it</h2>
      <ul>
        <li>Account data: until you delete your account.</li>
        <li>Public cards and sets: until you delete them.</li>
        <li>
          Server logs: rolling 30-day window for security investigations.
        </li>
      </ul>

      <h2>5. Your rights</h2>
      <ul>
        <li>
          <strong>Access</strong> — your dashboard shows everything tied to
          your account.
        </li>
        <li>
          <strong>Correction</strong> — edit profile data in{" "}
          <Link href="/settings">settings</Link>, or edit any card or set you
          own.
        </li>
        <li>
          <strong>Deletion</strong> — delete individual cards, sets, or your
          whole account. Account deletion cascades to your content
          immediately.
        </li>
        <li>
          <strong>Portability</strong> — exports (PNG today; full data export
          coming) are available from the editor.
        </li>
      </ul>

      <h2>6. Cookies</h2>
      <p>
        We use first-party cookies for authentication (Supabase session
        tokens). We don&apos;t use third-party advertising or analytics
        cookies. Basic anonymous analytics may be added later — if so, this
        page will be updated first.
      </p>

      <h2>7. Children</h2>
      <p>
        Spellwright isn&apos;t intended for users under 13. If we learn we have
        an account for someone under 13, we&apos;ll close it.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this policy. Material changes get a fresh
        &quot;last updated&quot; date and, when significant, an in-app notice.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions or requests? See the contact channels on the{" "}
        <Link href="/about">about page</Link>.
      </p>
    </LegalPageShell>
  );
}

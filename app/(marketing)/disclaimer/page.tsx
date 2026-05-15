import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Disclaimer",
  description:
    "Spellwright is an unofficial custom card design and playtesting tool — read the full disclaimer.",
  alternates: { canonical: "/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <LegalPageShell
      eyebrow="Legal"
      title="Disclaimer"
      description="What Spellwright is — and what it isn't."
      lastUpdated="May 2026"
    >
      <p className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-foreground">
        {siteConfig.disclaimer}
      </p>

      <h2>What Spellwright is</h2>
      <p>
        Spellwright is an independent, fan-built tool for designing, sharing, and
        remixing original custom trading cards. It launches with a fantasy-card
        template inspired by the broader genre of tabletop card games, but it
        ships with original generic frames, original placeholder iconography,
        and original UI copy.
      </p>

      <h2>What Spellwright isn&apos;t</h2>
      <ul>
        <li>
          We are <strong>not</strong> affiliated with, endorsed by, or sponsored
          by Wizards of the Coast, Hasbro, or any other official trading card
          game publisher.
        </li>
        <li>
          We do <strong>not</strong> distribute, host, or reproduce proprietary
          card art, official card frames, set symbols, or trademarked names.
        </li>
        <li>
          Spellwright is <strong>not</strong> a substitute for officially
          published cards and produces no legal play status of any kind.
        </li>
      </ul>

      <h2>Your responsibility as a creator</h2>
      <p>
        When you upload artwork or text to Spellwright, you confirm that you have
        the right to do so. That means original art you made yourself, art
        licensed from its creator, public-domain works, or content you have
        explicit permission to use.
      </p>
      <p>
        Cards that infringe a third party&apos;s rights — including but not
        limited to scanned official artwork, AI generations trained on a
        specific artist&apos;s style without permission, or content that
        impersonates a trademarked work — can be removed at any time and may
        result in account suspension.
      </p>

      <h2>Reporting and takedowns</h2>
      <p>
        If you believe a card on Spellwright infringes your rights, please reach
        out via the contact channel on the{" "}
        <Link href="/about">about page</Link>. We&apos;ll review reports
        promptly and act in good faith. Final policy details ship alongside the
        full <Link href="/terms">terms of service</Link>.
      </p>

      <h2>Changes to this disclaimer</h2>
      <p>
        We may update this page as Spellwright evolves. The version above will be
        amended in place, and the &quot;last updated&quot; date at the top will
        change to match.
      </p>
    </LegalPageShell>
  );
}

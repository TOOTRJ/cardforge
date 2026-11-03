import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { READING_TEXT_CLASS, ReadingLayout } from "@/components/layout/reading-layout";
import { RailCta, RailLinks } from "@/components/marketing/rail-cta";
import { cn } from "@/lib/utils";

/** The company and legal pages — the rail's list, one for every shell page. */
export const COMPANY_PAGES = [
  { href: "/about", label: "About PipGlyph" },
  { href: "/press", label: "Press kit" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy" },
] as const;

type LegalPageShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  lastUpdated?: string;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** The page's own path — marked in the rail's list. */
  current?: string;
  /** "measure" (default): running text at the reading measure; "column": a
   *  page of grids and swatches (the press kit). */
  main?: "measure" | "column";
};

// The wide frame (TODO WD10): the text keeps its reading measure (WD6) and
// the width beside it holds the company pages and the one way to reach us.
export function LegalPageShell({
  eyebrow,
  title,
  description,
  lastUpdated,
  children,
  backHref = "/",
  backLabel = "Back to home",
  current,
  main = "measure",
}: LegalPageShellProps) {
  return (
    <PageContainer size="wide" className="py-12 lg:py-16">
      <ReadingLayout
        main={main}
        railLabel="Company and legal"
        rail={
          <>
            <RailLinks title="Company & legal" links={COMPANY_PAGES} current={current} />
            <RailCta
              title="Questions?"
              description="Bugs, takedown or privacy requests, partnerships: the feedback form reaches the team, and the reply lands in your account messages."
              action={{ href: "/feedback", label: "Send feedback" }}
            />
          </>
        }
      >
        <Link
          href={backHref}
          className="mb-6 inline-flex items-center gap-1 rounded-sm text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>

        <PageHeader eyebrow={eyebrow} title={title} description={description} />

        {lastUpdated ? (
          <p className="mt-3 text-xs uppercase tracking-wider text-subtle">Last updated: {lastUpdated}</p>
        ) : null}

        <article
          className={cn(
            "mt-10 flex flex-col gap-6 text-muted [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-6 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_a]:text-primary-bright [&_a]:underline-offset-2 hover:[&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-foreground",
            main === "measure" ? READING_TEXT_CLASS : "text-sm leading-7 [&_p]:leading-7",
          )}
        >
          {children}
        </article>
      </ReadingLayout>
    </PageContainer>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

type LegalPageShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  lastUpdated?: string;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
};

export function LegalPageShell({
  eyebrow,
  title,
  description,
  lastUpdated,
  children,
  backHref = "/",
  backLabel = "Back to home",
}: LegalPageShellProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href={backHref}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>

      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      {lastUpdated ? (
        <p className="mt-3 text-xs uppercase tracking-wider text-subtle">
          Last updated: {lastUpdated}
        </p>
      ) : null}

      <article className="mt-10 flex flex-col gap-6 text-sm leading-7 text-muted [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-6 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_p]:leading-7 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-foreground">
        {children}
      </article>
    </div>
  );
}

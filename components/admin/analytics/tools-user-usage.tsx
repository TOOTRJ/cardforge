import Link from "next/link";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { formatCount } from "@/lib/admin/analytics/series";
import { toolNameOf, userToolLogHref, type UserToolUsageRow } from "@/lib/admin/analytics/tools-view";
import { toolBySlug } from "@/lib/tools/catalog";
import { formatUtcDateTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Tools used" on an account's admin page (/admin/users?u=…): every beta
// tool the account has an event of, all time (0204's admin_user_tool_usage).
// A tool's name opens that account's event log in the tool, on the
// analytics page's Tools tab. A read that failed says so; an account that
// never opened a tool says that.
// ---------------------------------------------------------------------------

export function UserToolsUsed({
  userId,
  usage,
  className,
}: {
  userId: string;
  /** null = the read failed. */
  usage: UserToolUsageRow[] | null;
  className?: string;
}) {
  if (usage === null) return <AdminLoadError what="the tools this account used" className={className} />;
  if (usage.length === 0) return <p className={cn("text-sm text-muted", className)}>Hasn&rsquo;t opened a tool yet.</p>;
  return (
    <div className={cn("relative overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <caption className="sr-only">Tools this account has used, all time</caption>
        <thead>
          <tr className="border-b border-border/50 text-left text-[11px] font-medium uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-4">
              Tool
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              Opens
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              Uses
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              Failures
            </th>
            <th scope="col" className="py-2">
              Last activity
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.map((row) => (
            <tr key={row.slug} className="border-b border-border/30">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {toolBySlug(row.slug) ? (
                  <Link href={userToolLogHref(row.slug, userId)} className="font-medium text-primary-bright hover:underline">
                    {toolNameOf(row.slug)}
                  </Link>
                ) : (
                  // A tool the catalog no longer lists has a log and no page.
                  <span title="No longer in the tools catalog">{toolNameOf(row.slug)}</span>
                )}
              </th>
              <td className="py-2 pr-4 text-right tabular-nums text-foreground">{formatCount(row.opens)}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-foreground">{formatCount(row.uses)}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-foreground">{formatCount(row.failures)}</td>
              <td className="whitespace-nowrap py-2 text-muted">{row.lastAt ? formatUtcDateTime(row.lastAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

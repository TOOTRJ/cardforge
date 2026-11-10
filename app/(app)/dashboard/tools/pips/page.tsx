import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CustomPipsPanel } from "@/components/settings/custom-pips-panel";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPipOverrides } from "@/lib/pips/queries";
import { CUSTOM_PIPS_HREF } from "@/lib/pips/href";
import { getViewerTool } from "@/lib/tools/queries";
import { toolHref } from "@/lib/tools/catalog";
import { CUSTOM_SYMBOLS_SLUG } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// /dashboard/tools/pips — the custom pips manager's home (owner 2026-11-06:
// "move custom pips to Tools"). An everyday tool on every account, so no
// beta gate: the same manager the creator's "Customize pips" dialog opens
// (`CustomPipsManager`). Settings keeps a pointer here.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Custom pips",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomPipsToolPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(CUSTOM_PIPS_HREF)}`);
  const [overrides, symbolsTool] = await Promise.all([
    getPipOverrides(user.id),
    getViewerTool(CUSTOM_SYMBOLS_SLUG),
  ]);

  return (
    <DashboardShell readable>
      <Link
        href="/dashboard/tools"
        className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Tools
      </Link>
      <PageHeader
        eyebrow="Tools"
        title="Custom pips"
        description="Swap the standard mana symbols for your own art. Your pips draw on every card you own — the live preview, gallery tiles, share images and downloads — while costs and rules read exactly the same."
      />
      <div className="mt-8">
        <CustomPipsPanel overrides={overrides} />
      </div>
      {symbolsTool?.allowed ? (
        <p className="mt-6 text-sm text-muted">
          Need a symbol beyond these six?{" "}
          <Link
            href={toolHref(CUSTOM_SYMBOLS_SLUG)}
            className="text-primary-bright underline-offset-4 hover:underline"
          >
            New mana symbols
          </Link>{" "}
          (beta) lets you make your own, written {"{*CODE}"}.
        </p>
      ) : null}
    </DashboardShell>
  );
}

"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/field-classes";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import {
  grantToolAccessAction,
  revokeToolAccessAction,
  searchToolUsersAction,
  type ToolUserMatch,
} from "@/lib/tools/admin-actions";
import type { ToolTester } from "@/lib/tools/admin-queries";
import { formatUtcDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

export const GRANT_LENGTHS: { value: string; label: string }[] = [
  { value: "none", label: "No end date" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

export function grantDaysOf(value: string): number | null {
  return value === "none" ? null : Number(value);
}

export function PersonLabel({
  person,
}: {
  person: { id: string; username: string | null; displayName: string | null };
}) {
  const name = person.displayName || (person.username ? `@${person.username}` : "Unnamed user");
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-xs font-semibold text-gold-strong"
      >
        {name.replace(/^@/, "").slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col">
        <Link
          href={`/admin/users?u=${person.id}`}
          className="truncate rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          {name}
        </Link>
        {person.username && person.displayName ? (
          <span className="truncate text-xs text-subtle">@{person.username}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Testers: find people and let them in, see who's in, take access back. */
export function TestersPanel({
  slug,
  toolName,
  testers,
}: {
  slug: string;
  toolName: string;
  testers: ToolTester[];
}) {
  const router = useRouter();
  const ids = { search: useId(), results: useId(), length: useId(), note: useId() };
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ToolUserMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ToolUserMatch[]>([]);
  const [length, setLength] = useState("none");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await searchToolUsersAction(q);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (!result.ok) {
        adminErrorToast("tester search", result.error);
        return;
      }
      setResults(result.data);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const liveIds = new Set(testers.filter((t) => t.live).map((t) => t.id));
  const pickedIds = new Set(picked.map((p) => p.id));
  const shownResults = query.trim().length >= 2 ? results : [];

  function grant() {
    startTransition(async () => {
      const result = await grantToolAccessAction({
        slug,
        userIds: picked.map((p) => p.id),
        expiresInDays: grantDaysOf(length),
        note: note || null,
      });
      if (!result.ok) {
        adminErrorToast("tool grant", result.error);
        return;
      }
      toast.success(
        `${result.data.granted} ${result.data.granted === 1 ? "person is" : "people are"} in the ${toolName} beta.`,
      );
      setPicked([]);
      setNote("");
      setQuery("");
      router.refresh();
    });
  }

  function revoke(userId: string) {
    startTransition(async () => {
      const result = await revokeToolAccessAction(slug, userId);
      setConfirmRevoke(null);
      if (!result.ok) {
        adminErrorToast("tool revoke", result.error);
        return;
      }
      toast.success("Access removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/40 p-4">
        <label htmlFor={ids.search} className="text-sm font-medium text-foreground">
          Add testers
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            id={ids.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Username, display name or email"
            autoComplete="off"
            aria-describedby={ids.results}
            className={cn(inputClass(false), "pl-9")}
          />
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-subtle" aria-hidden />
          ) : null}
        </div>
        <p id={ids.results} className="sr-only" aria-live="polite">
          {query.trim().length >= 2 && !searching ? `${shownResults.length} people found.` : ""}
        </p>
        {shownResults.length > 0 ? (
          <ul className="flex max-h-64 flex-col overflow-auto rounded-md border border-border/60" aria-label="Search results">
            {shownResults.map((user) => {
              const inAlready = liveIds.has(user.id);
              const chosen = pickedIds.has(user.id);
              return (
                <li key={user.id} className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {user.displayName || (user.username ? `@${user.username}` : "Unnamed user")}
                      {user.isAdmin ? <Badge className="ml-2" variant="gold">Admin</Badge> : null}
                    </span>
                    <span className="truncate text-xs text-subtle">
                      {[user.username ? `@${user.username}` : null, user.email, user.tier].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {inAlready ? (
                    <span className="shrink-0 text-xs text-gold-strong">Already a tester</span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant={chosen ? "secondary" : "outline"}
                      aria-pressed={chosen}
                      onClick={() =>
                        setPicked((prev) => (chosen ? prev.filter((p) => p.id !== user.id) : [...prev, user]))
                      }
                    >
                      {chosen ? "Added" : "Add"}
                      <span className="sr-only"> {user.username ?? user.displayName ?? "user"}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {picked.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
            <ul className="flex flex-wrap gap-2" aria-label="People to let in">
              {picked.map((p) => (
                <li key={p.id}>
                  <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 py-1 pl-3 pr-1 text-xs text-foreground">
                    {p.username ? `@${p.username}` : p.displayName ?? p.email}
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                      className="rounded-full p-0.5 text-muted hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">Remove {p.username ?? p.displayName ?? "user"}</span>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.length} className="text-xs font-medium text-muted">Access ends</label>
                <select id={ids.length} value={length} onChange={(e) => setLength(e.target.value)} className={inputClass(false)}>
                  {GRANT_LENGTHS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.note} className="text-xs font-medium text-muted">Note (only admins see it)</label>
                <input
                  id={ids.note}
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Discord feedback group"
                  className={inputClass(false)}
                />
              </div>
              <Button type="button" onClick={grant} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
                Let {picked.length} in
              </Button>
            </div>
            <p className="text-xs text-subtle">Each new tester gets a notification.</p>
          </div>
        ) : null}
      </div>

      {testers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No testers yet. Admins can always open the tool.
        </p>
      ) : (
        <ul aria-label={`Testers of ${toolName}`} className="flex min-w-0 flex-col">
          {testers.map((t) => (
            <li
              key={t.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 border-t border-border/40 py-3 first:border-t-0 first:pt-0"
            >
              <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", !t.live && "opacity-60")}>
                <PersonLabel person={t} />
                <p className="pl-11 text-xs text-subtle">
                  Added {formatUtcDate(t.grantedAt)}
                  {t.grantedBy ? ` by @${t.grantedBy}` : ""}
                  {" · "}
                  {t.expiresAt ? (
                    <span className={t.live ? "text-muted" : "font-medium text-danger"}>
                      {t.live ? `ends ${formatUtcDate(t.expiresAt)}` : `ended ${formatUtcDate(t.expiresAt)}`}
                    </span>
                  ) : (
                    <span className="text-muted">no end</span>
                  )}
                </p>
                {t.note ? (
                  <p className="truncate pl-11 text-xs italic text-muted" title={t.note}>
                    {t.note}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0">
                {confirmRevoke === t.id ? (
                  <span className="inline-flex gap-1">
                    <Button type="button" size="sm" variant="outline" className="border-danger/50 text-danger" onClick={() => revoke(t.id)} disabled={pending}>
                      Remove access
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRevoke(t.id)}>
                    {t.live ? "Revoke" : "Remove"}
                    <span className="sr-only"> {t.username ?? t.displayName ?? "tester"}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

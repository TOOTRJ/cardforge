"use client";

// ---------------------------------------------------------------------------
// SiteUpdatesAdmin — the /admin/updates surface: a create/edit form plus the
// full list (drafts, scheduled and live) with quick toggles for publish,
// homepage banner and must-read. Server truth flows back via router.refresh()
// after each action (same pattern as the challenges admin).
// ---------------------------------------------------------------------------

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarClock, Eye, EyeOff, Megaphone, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { inputClass, textareaClass } from "@/components/creator/field-group";
import {
  createSiteUpdateAction,
  deleteSiteUpdateAction,
  notifyAllUsersAction,
  setSiteUpdateFlagAction,
  updateSiteUpdateAction,
} from "@/lib/updates/actions";
import {
  formatReleaseDate,
  siteUpdateStatus,
  toDateTimeLocal,
  type SiteUpdate,
} from "@/lib/updates/shared";
import { cn } from "@/lib/utils";

const STATUS_LABEL = { draft: "Draft", scheduled: "Scheduled", live: "Live" } as const;

export function SiteUpdatesAdmin({ updates }: { updates: SiteUpdate[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SiteUpdate | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (u: SiteUpdate, flag: "is_published" | "show_in_banner" | "require_ack") =>
    startTransition(async () => {
      const result = await setSiteUpdateFlagAction(u.id, flag, !u[flag]);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });

  const notifyAll = (u: SiteUpdate) => {
    const again = u.notified_at != null;
    const ok = window.confirm(
      again
        ? `Send "${u.title}" again? Only users who haven't received it yet (new sign-ups) will get a notification.`
        : `Notify every user about "${u.title}"? Each person gets a bell notification and, if online, a toast.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await notifyAllUsersAction(u.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.sent === 0
          ? "Everyone already has this notification."
          : `Sent to ${result.sent.toLocaleString("en-US")} user${result.sent === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  };

  const remove = (u: SiteUpdate) => {
    if (!window.confirm(`Delete "${u.title}"? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteSiteUpdateAction(u.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Update deleted.");
      if (editing?.id === u.id) setEditing(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <UpdateForm
        key={editing?.id ?? "new"}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold text-foreground">All updates</h2>
        {updates.length === 0 ? (
          <SurfaceCard className="p-6 text-sm text-muted">Nothing posted yet.</SurfaceCard>
        ) : (
          updates.map((u) => {
            const status = siteUpdateStatus(u);
            return (
              <SurfaceCard key={u.id} className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={u.kind === "update" ? "gold" : "default"}>
                    {u.kind === "update" ? (
                      <Megaphone className="mr-1 h-3 w-3" aria-hidden />
                    ) : (
                      <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                    )}
                    {u.kind === "update" ? "Update" : "Upcoming"}
                  </Badge>
                  <Badge
                    className={cn(
                      status === "live" && "border-success/40 text-success",
                      status === "scheduled" && "border-gold/40 text-gold-strong",
                      status === "draft" && "text-subtle",
                    )}
                  >
                    {status === "scheduled" ? <CalendarClock className="mr-1 h-3 w-3" aria-hidden /> : null}
                    {STATUS_LABEL[status]}
                  </Badge>
                  <span className="text-xs text-subtle">
                    {status === "scheduled" ? "Releases " : "Released "}
                    {formatReleaseDate(u.publish_at)}
                  </span>
                  {u.show_in_banner ? <Badge>On banner</Badge> : null}
                  {u.require_ack ? <Badge>Must-read</Badge> : null}
                  {u.notified_at ? (
                    <Badge title={`Last sent ${formatReleaseDate(u.notified_at)}`}>
                      <BellRing className="mr-1 h-3 w-3" aria-hidden />
                      Notified {u.notified_count.toLocaleString("en-US")}
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground">{u.title}</h3>
                  <p className="text-sm leading-6 text-muted">{u.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(u)} disabled={pending}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toggle(u, "is_published")} disabled={pending}>
                    {u.is_published ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    {u.is_published ? "Unpublish" : "Publish"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toggle(u, "show_in_banner")} disabled={pending}>
                    {u.show_in_banner ? "Remove from banner" : "Show on banner"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toggle(u, "require_ack")} disabled={pending}>
                    {u.require_ack ? "Stop requiring read" : "Require read"}
                  </Button>
                  <Button
                    type="button"
                    variant={u.notified_at ? "outline" : "primary"}
                    size="sm"
                    onClick={() => notifyAll(u)}
                    disabled={pending || status !== "live"}
                    title={status !== "live" ? "Publish it first — only a live update can be sent" : undefined}
                  >
                    <BellRing className="h-3.5 w-3.5" aria-hidden />
                    {u.notified_at ? "Notify new users" : "Notify all users"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => remove(u)} disabled={pending}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Delete
                  </Button>
                </div>
              </SurfaceCard>
            );
          })
        )}
      </section>
    </div>
  );
}

function UpdateForm({
  editing,
  onCancelEdit,
  onSaved,
}: {
  editing: SiteUpdate | null;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateSiteUpdateAction(editing.id, formData)
        : await createSiteUpdateAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(editing ? "Update saved." : "Update posted.");
      formRef.current?.reset();
      onSaved();
    });
  };

  return (
    <SurfaceCard tone={editing ? "gold" : "default"} className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-foreground">
          {editing ? `Editing: ${editing.title}` : "Post an update"}
        </h2>
        {editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Cancel
          </Button>
        ) : null}
      </div>
      <form ref={formRef} action={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Kind</span>
          <select name="kind" defaultValue={editing?.kind ?? "update"} className={inputClass(false)}>
            <option value="update">Update — something shipped</option>
            <option value="upcoming">Upcoming — a feature to tease</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Release (UTC)</span>
          <input
            type="datetime-local"
            name="publishAt"
            defaultValue={toDateTimeLocal(editing?.publish_at ?? new Date().toISOString())}
            className={inputClass(false)}
          />
          <span className="text-xs text-subtle">A future time schedules it; it goes public on its own.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Title</span>
          <input name="title" required minLength={3} maxLength={120} defaultValue={editing?.title ?? ""} placeholder="Pips now render as icons in the editor" className={inputClass(false)} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Summary</span>
          <input name="summary" required minLength={3} maxLength={280} defaultValue={editing?.summary ?? ""} placeholder="One exciting sentence — this is what the banner and the splash show." className={inputClass(false)} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Details (optional)</span>
          <textarea name="body" rows={4} maxLength={4000} defaultValue={editing?.body ?? ""} placeholder="More detail for the news page and the must-read dialog. Line breaks are kept." className={textareaClass(false)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Link (optional)</span>
          <input name="linkHref" defaultValue={editing?.link_href ?? ""} placeholder="/create or https://…" className={inputClass(false)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Stop requiring read after (optional, UTC)</span>
          <input type="datetime-local" name="ackUntil" defaultValue={toDateTimeLocal(editing?.ack_until)} className={inputClass(false)} />
        </label>
        <div className="flex flex-wrap gap-5 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="isPublished" defaultChecked={editing ? editing.is_published : true} />
            Published (uncheck to keep as a draft)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="showInBanner" defaultChecked={editing?.show_in_banner ?? false} />
            Show on the homepage banner
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="requireAck" defaultChecked={editing?.require_ack ?? false} />
            Must-read: every signed-in user sees a dialog until they dismiss it
          </label>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            <Plus className="h-4 w-4" aria-hidden />
            {pending ? "Saving…" : editing ? "Save changes" : "Post update"}
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </SurfaceCard>
  );
}

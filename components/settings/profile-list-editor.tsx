"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ZodType } from "zod";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field-classes";
import { useRowFocus } from "@/components/creator/use-row-focus";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/ids";
import type { ListSaveResult, RowFieldErrors } from "@/app/(app)/settings/link-actions";

// ---------------------------------------------------------------------------
// ProfileListEditor — the Settings row editor behind "More links" and
// "Store cards" (migration 0153). Each row is a choice (link kind / store
// platform), an https URL and one optional text (a label / a title); rows
// move up and down and are removed with the focus handed on (useRowFocus).
// The list is checked with the SAME zod schema the server action runs
// (lib/profile/link-kinds.ts, lib/profile/store-platforms.ts) before it is
// sent, and saved whole: the server's per-row errors land under the inputs.
// ---------------------------------------------------------------------------

export type ListChoice = {
  value: string;
  label: string;
  /** <optgroup> label, when the choices are grouped. */
  group?: string;
  placeholder: string;
};

export type ListRow = { choice: string; url: string; text: string };

type KeyedRow = ListRow & { key: string };

export type ProfileListEditorProps = {
  /** "link" / "store" — the rows' accessible names ("Link 2", "Store 1"). */
  noun: string;
  initialRows: readonly ListRow[];
  max: number;
  choices: readonly ListChoice[];
  choiceLabel: string;
  /** The payload key the choice is saved under ("kind" / "platform"). */
  choiceKey: string;
  /** The text input's caption for a row's choice ("Label (optional)", or
   *  "Name" where the choice needs one). */
  textLabel: (choice: string) => string;
  /** The payload key the text is saved under ("label" / "title"). */
  textKey: string;
  textMax: number;
  textPlaceholder: (choice: string) => string;
  schema: ZodType;
  save: (rows: unknown) => Promise<ListSaveResult>;
  addLabel: string;
  emptyText: string;
  savedText: string;
};

function keyed(rows: readonly ListRow[]): KeyedRow[] {
  return rows.map((row) => ({ ...row, key: randomId() }));
}

export function ProfileListEditor({
  noun,
  initialRows,
  max,
  choices,
  choiceLabel,
  choiceKey,
  textLabel,
  textKey,
  textMax,
  textPlaceholder,
  schema,
  save,
  addLabel,
  emptyText,
  savedText,
}: ProfileListEditorProps) {
  const router = useRouter();
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfterRemove = useRowFocus(rootRef);
  const [rows, setRows] = useState<KeyedRow[]>(() => keyed(initialRows));
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initialRows));
  const [rowErrors, setRowErrors] = useState<RowFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const payload = useMemo(
    () =>
      rows.map((row) => ({
        [choiceKey]: row.choice,
        url: row.url.trim(),
        ...(row.text.trim() ? { [textKey]: row.text.trim() } : {}),
      })),
    [rows, choiceKey, textKey],
  );
  const current = JSON.stringify(rows.map(({ choice, url, text }) => ({ choice, url, text })));
  const dirty = current !== saved;

  const groups = useMemo(() => {
    const out = new Map<string, ListChoice[]>();
    for (const choice of choices) {
      const group = choice.group ?? "";
      out.set(group, [...(out.get(group) ?? []), choice]);
    }
    return [...out.entries()];
  }, [choices]);

  const update = (index: number, patch: Partial<ListRow>) => {
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setRowErrors((errors) => {
      if (!errors[index]) return errors;
      const next = { ...errors };
      delete next[index];
      return next;
    });
  };

  const move = (index: number, by: -1 | 1) => {
    setRows((list) => {
      const target = index + by;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setRowErrors({});
  };

  const remove = (index: number) => {
    setRows((list) => list.filter((_, i) => i !== index));
    setRowErrors({});
    focusAfterRemove(index);
  };

  const add = () => {
    setRows((list) => [...list, { key: randomId(), choice: choices[0]?.value ?? "", url: "", text: "" }]);
    // The new row's first control takes the focus once it is drawn.
    requestAnimationFrame(() => {
      const selects = rootRef.current?.querySelectorAll<HTMLSelectElement>("[data-row-choice]");
      selects?.[selects.length - 1]?.focus();
    });
  };

  const onSave = () => {
    setFormError(null);
    const checked = schema.safeParse(payload);
    if (!checked.success) {
      const errors: RowFieldErrors = {};
      let listError: string | null = null;
      for (const issue of checked.error.issues) {
        const [index, field] = issue.path;
        if (typeof index === "number") {
          const key = field === choiceKey ? "choice" : field === textKey ? "text" : "url";
          errors[index] ??= {};
          errors[index][key] ??= issue.message;
        } else listError ??= issue.message;
      }
      setRowErrors(errors);
      setFormError(listError ?? "Check the highlighted rows.");
      focusFirstError(errors);
      return;
    }
    startTransition(async () => {
      const result = await save(payload);
      if (result.ok) {
        setRowErrors({});
        setSaved(current);
        toast.success(savedText);
        router.refresh();
        return;
      }
      const errors: RowFieldErrors = {};
      for (const [index, fields] of Object.entries(result.rowErrors ?? {})) {
        errors[Number(index)] = {
          choice: fields[choiceKey],
          url: fields.url,
          text: fields[textKey],
        };
      }
      setRowErrors(errors);
      setFormError(result.formError ?? "We couldn't save that. Please try again.");
      focusFirstError(errors);
    });
  };

  const focusFirstError = (errors: RowFieldErrors) => {
    const first = Object.keys(errors).map(Number).sort((a, b) => a - b)[0];
    if (first === undefined) return;
    const field = errors[first].choice ? "choice" : errors[first].url ? "url" : "text";
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-${first}-${field}`)?.focus();
    });
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {rows.length === 0 ? <p className="text-sm text-muted">{emptyText}</p> : null}
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const choice = choices.find((c) => c.value === row.choice);
          const errors = rowErrors[index] ?? {};
          const id = (field: string) => `${baseId}-${index}-${field}`;
          const name = `${noun[0].toUpperCase()}${noun.slice(1)} ${index + 1}`;
          return (
            <li key={row.key}>
              <fieldset className="grid gap-2 rounded-md border border-border/50 bg-background/40 p-3 sm:grid-cols-[10rem_1fr] sm:items-start">
                <legend className="sr-only">{name}</legend>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    {choiceLabel}
                  </span>
                  <select
                    id={id("choice")}
                    data-row-choice
                    value={row.choice}
                    onChange={(event) => update(index, { choice: event.target.value })}
                    aria-invalid={errors.choice ? "true" : undefined}
                    className={cn(inputClass(Boolean(errors.choice)), "px-2")}
                  >
                    {groups.map(([group, items]) =>
                      group ? (
                        <optgroup key={group} label={group}>
                          {items.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        items.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))
                      ),
                    )}
                  </select>
                </label>
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                      URL
                    </span>
                    <input
                      id={id("url")}
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      value={row.url}
                      onChange={(event) => update(index, { url: event.target.value })}
                      placeholder={choice?.placeholder ?? "https://…"}
                      aria-invalid={errors.url ? "true" : undefined}
                      aria-describedby={errors.url ? id("url-error") : undefined}
                      className={inputClass(Boolean(errors.url))}
                    />
                    {errors.url ? (
                      <span id={id("url-error")} className="text-xs text-danger">
                        {errors.url}
                      </span>
                    ) : null}
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                        {textLabel(row.choice)}
                      </span>
                      <input
                        id={id("text")}
                        type="text"
                        value={row.text}
                        maxLength={textMax}
                        onChange={(event) => update(index, { text: event.target.value })}
                        placeholder={textPlaceholder(row.choice)}
                        aria-invalid={errors.text ? "true" : undefined}
                        aria-describedby={errors.text ? id("text-error") : undefined}
                        className={inputClass(Boolean(errors.text))}
                      />
                      {errors.text ? (
                        <span id={id("text-error")} className="text-xs text-danger">
                          {errors.text}
                        </span>
                      ) : null}
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 px-0"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${name} up`}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 px-0"
                        onClick={() => move(index, 1)}
                        disabled={index === rows.length - 1}
                        aria-label={`Move ${name} down`}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 px-0"
                        data-row-remove
                        onClick={() => remove(index)}
                        aria-label={`Remove ${name}`}
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          onClick={add}
          disabled={rows.length >= max}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {rows.length >= max ? `${max} is the most` : addLabel}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={isPending || !dirty}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

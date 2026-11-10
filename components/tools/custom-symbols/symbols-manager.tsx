"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ImageUp, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { SurfaceCard } from "@/components/ui/surface-card";
import { inputClass } from "@/components/ui/field-classes";
import { cn } from "@/lib/utils";
import { CUSTOM_PIPS_HREF } from "@/lib/pips/href";
import {
  createSymbolAction,
  createSymbolFromForgedPipAction,
  removeSymbolAction,
  replaceSymbolPictureAction,
  restoreSymbolAction,
  updateSymbolAction,
  type SymbolResult,
} from "@/lib/symbols/actions";
import {
  LIVE_SYMBOL_CAP,
  SYMBOL_BASE_COLORS,
  SYMBOL_BASE_COLOR_LABELS,
  SYMBOL_CODE_MAX,
  SYMBOL_MANA_VALUE_MAX,
  SYMBOL_NAME_MAX,
  normalizeSymbolCode,
  symbolMeaningLabel,
  symbolToken,
  type CustomSymbol,
  type SymbolBaseColor,
} from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// The New mana symbols manager (beta tool `custom-symbols`, 0193): make up to
// LIVE_SYMBOL_CAP symbols — a picture (an upload, or a forged pip when Pip
// Forge is open to the maker), a code written {*CODE}, a name, a mana value
// and a colour — then rename, re-mean, re-picture, remove and restore them.
// The server's answer is the truth: each action hands back the row, and the
// list follows it (no refresh round trip).
// ---------------------------------------------------------------------------

export type ForgedPipChoice = { id: string; name: string; imageUrl: string };

type ColorChoice = SymbolBaseColor | "C";

const COLOR_OPTIONS: ChipOption<ColorChoice>[] = [
  { value: "C", label: "Colorless" },
  ...SYMBOL_BASE_COLORS.map((color) => ({ value: color, label: SYMBOL_BASE_COLOR_LABELS[color] })),
];

type FieldErrors = Partial<Record<"code" | "name" | "manaValue" | "baseColor" | "file", string>>;

function byCode(a: CustomSymbol, b: CustomSymbol) {
  return a.code.localeCompare(b.code);
}

export function SymbolsManager({
  initialSymbols,
  forgedPips,
}: {
  initialSymbols: CustomSymbol[];
  forgedPips: ForgedPipChoice[];
}) {
  const [symbols, setSymbols] = useState<CustomSymbol[]>(() => [...initialSymbols].sort(byCode));
  // A row that leaves its list (removed, restored, deleted) hands the focus
  // to its section's heading, never to <body>.
  const yoursRef = useRef<HTMLHeadingElement>(null);
  const removedRef = useRef<HTMLHeadingElement>(null);
  const focusLater = (ref: React.RefObject<HTMLHeadingElement | null>) =>
    requestAnimationFrame(() => (ref.current ?? yoursRef.current)?.focus());
  const live = symbols.filter((symbol) => symbol.deletedAt === null);
  const removed = symbols.filter((symbol) => symbol.deletedAt !== null);

  const upsert = (symbol: CustomSymbol) =>
    setSymbols((prev) => [...prev.filter((s) => s.id !== symbol.id), symbol].sort(byCode));
  const drop = (id: string) => setSymbols((prev) => prev.filter((s) => s.id !== id));
  // One announcement per outcome: the toast (sonner's own live region).
  const say = (text: string, tone: "success" | "error" = "success") => {
    if (tone === "success") toast.success(text);
    else toast.error(text);
  };

  return (
    <div className="mt-8 flex flex-col gap-8">
      <SurfaceCard className="p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">How symbols work</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-muted">
          <li>
            Each symbol has a code you write as <Code>{"{*CODE}"}</Code>
            {` — a letter, then up to ${SYMBOL_CODE_MAX - 1} letters or digits. `}
            The code can&rsquo;t change once it&rsquo;s made.
          </li>
          <li>You choose what it means: its mana value and its colour (or colorless).</li>
          <li>
            Removing a symbol a card still uses keeps it for that card, under &ldquo;Removed symbols&rdquo;,
            where you can restore it.
          </li>
          <li>
            <span className="font-medium text-foreground">In this beta:</span> make and set up your symbols
            here. Writing them on cards comes in the next update.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Want to change how W, U, B, R, G or C look instead?{" "}
          <Link href={CUSTOM_PIPS_HREF} className="text-primary-bright underline-offset-4 hover:underline">
            Custom pips
          </Link>
        </p>
      </SurfaceCard>

      <NewSymbolForm
        full={live.length >= LIVE_SYMBOL_CAP}
        count={live.length}
        forgedPips={forgedPips}
        onCreated={(symbol) => {
          upsert(symbol);
          say(`${symbolToken(symbol.code)} ${symbol.name} is ready.`);
          // The form gives way to the "full" note: its button can't keep
          // the focus.
          if (live.length + 1 >= LIVE_SYMBOL_CAP) focusLater(yoursRef);
        }}
      />

      <section aria-labelledby="symbols-yours" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2">
          <h2
            ref={yoursRef}
            tabIndex={-1}
            id="symbols-yours"
            className="font-display text-lg font-semibold text-foreground focus-visible:outline-none"
          >
            Your symbols
          </h2>
          <p className="text-sm text-subtle">
            {live.length} of {LIVE_SYMBOL_CAP}
          </p>
        </div>
        {live.length === 0 ? (
          <p className="text-sm text-muted">No symbols yet — make your first one above.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {live.map((symbol) => (
              <li key={symbol.id} className="flex">
                <SymbolRow
                  symbol={symbol}
                  onChanged={(next, message) => {
                    upsert(next);
                    say(message);
                  }}
                  onRemoved={(result, message) => {
                    if (result) upsert(result);
                    else drop(symbol.id);
                    say(message);
                    focusLater(yoursRef);
                  }}
                  onError={(message) => say(message, "error")}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {removed.length > 0 ? (
        <section aria-labelledby="symbols-removed" className="flex flex-col gap-3">
          <div className="border-b border-border/60 pb-2">
            <h2
              ref={removedRef}
              tabIndex={-1}
              id="symbols-removed"
              className="font-display text-lg font-semibold text-foreground focus-visible:outline-none"
            >
              Removed symbols
            </h2>
            <p className="mt-1 text-sm text-subtle">
              Kept because a card of yours still uses them — those cards keep drawing them. Restore one to change
              it or use it again.
            </p>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {removed.map((symbol) => (
              <li key={symbol.id} className="flex">
                <RemovedRow
                  symbol={symbol}
                  full={live.length >= LIVE_SYMBOL_CAP}
                  onRestored={(next) => {
                    upsert(next);
                    say(`${symbolToken(next.code)} is back.`);
                    focusLater(removed.length > 1 ? removedRef : yoursRef);
                  }}
                  onDeleted={() => {
                    drop(symbol.id);
                    say(`${symbolToken(symbol.code)} is deleted.`);
                    focusLater(removed.length > 1 ? removedRef : yoursRef);
                  }}
                  onError={(message) => say(message, "error")}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

function SymbolPicture({ src, size = 40, faded }: { src: string; size?: number; faded?: boolean }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover shadow-[-1px_2px_0_#111]", faded && "opacity-60")}
      style={{ width: size, height: size }}
    />
  );
}

// --- the new-symbol form ------------------------------------------------------

function NewSymbolForm({
  full,
  count,
  forgedPips,
  onCreated,
}: {
  full: boolean;
  count: number;
  forgedPips: ForgedPipChoice[];
  onCreated: (symbol: CustomSymbol) => void;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [color, setColor] = useState<ColorChoice>("C");
  const [pictureFrom, setPictureFrom] = useState<"upload" | "forge">("upload");
  const [forgedPipId, setForgedPipId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const reset = () => {
    formRef.current?.reset();
    setColor("C");
    setForgedPipId(null);
    setPreview(null);
    setErrors({});
    setFormError(null);
  };

  const fail = (result: Extract<SymbolResult, { ok: false }>) => {
    if (result.field) setErrors({ [result.field]: result.error });
    else setErrors({});
    setFormError(result.error);
    toast.error(result.error);
    const field = result.field
      ? formRef.current?.querySelector<HTMLElement>(`[data-field="${result.field}"]`)
      : null;
    // A chip row's wrapper isn't focusable: its tab stop is.
    const target = field && field.tabIndex < 0 && field.tagName === "DIV" ? field.querySelector<HTMLElement>('[role="radio"]:not([tabindex="-1"])') : field;
    target?.focus();
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (full || pending) return;
    const data = new FormData(event.currentTarget);
    data.set("baseColor", color);
    const code = normalizeSymbolCode(data.get("code"));
    if (!code) {
      fail({
        ok: false,
        field: "code",
        error: `A code is a letter, then up to ${SYMBOL_CODE_MAX - 1} letters or digits.`,
      });
      return;
    }
    if (pictureFrom === "forge" && !forgedPipId) {
      fail({ ok: false, field: "file", error: "Pick one of your forged pips." });
      return;
    }
    if (pictureFrom === "upload" && !(data.get("file") instanceof File && (data.get("file") as File).size > 0)) {
      fail({ ok: false, field: "file", error: "Choose a picture for the symbol." });
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result =
        pictureFrom === "forge"
          ? await createSymbolFromForgedPipAction({
              forgedPipId,
              code,
              name: data.get("name"),
              manaValue: data.get("manaValue"),
              baseColor: color,
            }).catch(() => null)
          : await createSymbolAction(data).catch(() => null);
      if (!result) {
        fail({ ok: false, error: "The symbol couldn't be saved. Try again." });
        return;
      }
      if (!result.ok) {
        fail(result);
        return;
      }
      reset();
      onCreated(result.symbol);
    });
  };

  const describedBy = (field: keyof FieldErrors, hint?: string) =>
    [errors[field] ? `${id}-${field}-error` : null, hint].filter(Boolean).join(" ") || undefined;

  return (
    <SurfaceCard className="p-5">
      <h2 className="font-display text-lg font-semibold text-foreground">New symbol</h2>
      {full ? (
        <p className="mt-2 text-sm text-muted">
          You have {count} symbols, the most you can keep. Remove one to make another.
        </p>
      ) : (
        <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-5">
          {/* The picture */}
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-foreground">Picture</legend>
            {forgedPips.length > 0 ? (
              <ChipGroup
                ariaLabel="Where the picture comes from"
                value={pictureFrom}
                onChange={(next) => {
                  setPictureFrom(next);
                  setErrors((prev) => ({ ...prev, file: undefined }));
                }}
                keepCase
                options={[
                  { value: "upload", label: "Upload a picture" },
                  { value: "forge", label: "A pip from Pip Forge" },
                ]}
              />
            ) : null}
            {pictureFrom === "upload" ? (
              <div className="flex items-center gap-4">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-elevated/40">
                  {preview ? <SymbolPicture src={preview} size={52} /> : <ImageUp className="h-5 w-5 text-subtle" aria-hidden />}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={`${id}-file`} className="text-sm text-muted">
                    PNG, JPEG or WebP, up to 4 MB. It&rsquo;s cropped to a square and drawn as a round pip.
                  </label>
                  <input
                    ref={fileRef}
                    id={`${id}-file`}
                    name="file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    data-field="file"
                    aria-invalid={errors.file ? true : undefined}
                    aria-describedby={describedBy("file")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setPreview(file ? URL.createObjectURL(file) : null);
                      setErrors((prev) => ({ ...prev, file: undefined }));
                    }}
                    className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-elevated file:px-3 file:py-1.5 file:text-sm file:text-foreground"
                  />
                </div>
              </div>
            ) : (
              <div data-field="file">
                <ChipGroup
                  ariaLabel="Your forged pips"
                  ariaDescribedBy={describedBy("file")}
                  ariaInvalid={Boolean(errors.file)}
                  value={forgedPipId ?? ""}
                  onChange={(next) => {
                    setForgedPipId(next);
                    setErrors((prev) => ({ ...prev, file: undefined }));
                  }}
                  keepCase
                  options={forgedPips.map((pip) => ({
                    value: pip.id,
                    label: pip.name,
                    leading: <SymbolPicture src={pip.imageUrl} size={24} />,
                  }))}
                />
              </div>
            )}
            {errors.file ? (
              <p id={`${id}-file-error`} className="text-sm text-danger">
                {errors.file}
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-code`} className="text-sm font-medium text-foreground">
                Code
              </label>
              <div className="flex items-center gap-1 font-mono text-sm text-muted">
                <span aria-hidden>{"{*"}</span>
                <input
                  id={`${id}-code`}
                  name="code"
                  data-field="code"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={SYMBOL_CODE_MAX + 4}
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={describedBy("code", `${id}-code-hint`)}
                  onInput={(event) => {
                    // Room for a pasted "{*ABCDEF}": the braces and star go,
                    // then the code is held to its length. Rewritten only
                    // when it changes, so typing keeps the caret where it is
                    // (the field SHOWS capitals; the server stores them).
                    const input = event.currentTarget;
                    const next = input.value.replace(/[^A-Za-z0-9]/g, "").slice(0, SYMBOL_CODE_MAX);
                    if (next !== input.value) input.value = next;
                  }}
                  className={cn(inputClass(Boolean(errors.code)), "w-32 font-mono uppercase")}
                />
                <span aria-hidden>{"}"}</span>
              </div>
              <p id={`${id}-code-hint`} className="text-xs text-subtle">
                A letter, then up to {SYMBOL_CODE_MAX - 1} letters or digits. You write it as {"{*CODE}"}.
              </p>
              {errors.code ? (
                <p id={`${id}-code-error`} className="text-sm text-danger">
                  {errors.code}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-name`} className="text-sm font-medium text-foreground">
                Name
              </label>
              <input
                id={`${id}-name`}
                name="name"
                data-field="name"
                required
                maxLength={SYMBOL_NAME_MAX}
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={describedBy("name")}
                className={inputClass(Boolean(errors.name))}
              />
              {errors.name ? (
                <p id={`${id}-name-error`} className="text-sm text-danger">
                  {errors.name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-mv`} className="text-sm font-medium text-foreground">
                Mana value
              </label>
              <input
                id={`${id}-mv`}
                name="manaValue"
                data-field="manaValue"
                type="number"
                inputMode="numeric"
                min={0}
                max={SYMBOL_MANA_VALUE_MAX}
                step={1}
                defaultValue={1}
                aria-invalid={errors.manaValue ? true : undefined}
                aria-describedby={describedBy("manaValue", `${id}-mv-hint`)}
                className={cn(inputClass(Boolean(errors.manaValue)), "w-28")}
              />
              <p id={`${id}-mv-hint`} className="text-xs text-subtle">
                What one symbol adds to a card&rsquo;s mana value (0–{SYMBOL_MANA_VALUE_MAX}).
              </p>
              {errors.manaValue ? (
                <p id={`${id}-manaValue-error`} className="text-sm text-danger">
                  {errors.manaValue}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <span id={`${id}-color-label`} className="text-sm font-medium text-foreground">
                Colour
              </span>
              <ChipGroup
                ariaLabel="Colour"
                ariaDescribedBy={describedBy("baseColor")}
                value={color}
                onChange={setColor}
                options={COLOR_OPTIONS}
                keepCase
                size="sm"
              />
              {errors.baseColor ? (
                <p id={`${id}-baseColor-error`} className="text-sm text-danger">
                  {errors.baseColor}
                </p>
              ) : null}
            </div>
          </div>

          {formError && !Object.values(errors).some(Boolean) ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Make symbol
            </Button>
            <span className="text-sm text-subtle">
              {count} of {LIVE_SYMBOL_CAP} used
            </span>
          </div>
        </form>
      )}
    </SurfaceCard>
  );
}

// --- one live symbol ----------------------------------------------------------

function SymbolRow({
  symbol,
  onChanged,
  onRemoved,
  onError,
}: {
  symbol: CustomSymbol;
  onChanged: (symbol: CustomSymbol, message: string) => void;
  onRemoved: (kept: CustomSymbol | null, message: string) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const token = symbolToken(symbol.code);

  const replace = (file: File | undefined) => {
    if (!file) return;
    const data = new FormData();
    data.set("id", symbol.id);
    data.set("file", file);
    startTransition(async () => {
      const result = await replaceSymbolPictureAction(data).catch(() => null);
      if (!result) onError("The picture couldn't be saved. Try again.");
      else if (!result.ok) onError(result.error);
      else onChanged(result.symbol, `${token} has its new picture.`);
    });
  };

  const remove = () => {
    if (!window.confirm(`Remove ${token} ${symbol.name}? A card that uses it keeps drawing it.`)) return;
    startTransition(async () => {
      const result = await removeSymbolAction({ id: symbol.id }).catch(() => null);
      if (!result) onError("The symbol couldn't be removed. Try again.");
      else if (!result.ok) onError(result.error);
      else
        onRemoved(
          result.symbol,
          result.outcome === "kept"
            ? `${token} is removed. A card still uses it, so it's kept under Removed symbols.`
            : `${token} is deleted.`,
        );
    });
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-card border border-border/70 bg-surface/60 p-4">
      <div className="flex items-start gap-3">
        <SymbolPicture src={symbol.imageUrl} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Code>{token}</Code>
            <span className="truncate font-medium text-foreground">{symbol.name}</span>
          </div>
          <span className="text-sm text-muted">{symbolMeaningLabel(symbol)}</span>
          {symbol.source === "forge" ? <span className="text-xs text-subtle">From Pip Forge</span> : null}
        </div>
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-gold" aria-label="Saving" /> : null}
      </div>

      {editing ? (
        <EditSymbolForm
          symbol={symbol}
          onDone={(next) => {
            setEditing(false);
            if (next) onChanged(next, `${symbolToken(next.code)} is saved.`);
            requestAnimationFrame(() => editRef.current?.focus());
          }}
          onError={onError}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            ref={editRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setEditing(true)}
            aria-label={`Edit ${token} ${symbol.name}`}
          >
            <Pencil aria-hidden />
            Edit
          </Button>
          <input
            ref={fileRef}
            id={`${id}-replace`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              replace(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            aria-label={`Replace the picture of ${token} ${symbol.name}`}
          >
            <ImageUp aria-hidden />
            New picture
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={remove}
            aria-label={`Remove ${token} ${symbol.name}`}
            className="hover:text-danger"
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function EditSymbolForm({
  symbol,
  onDone,
  onError,
}: {
  symbol: CustomSymbol;
  onDone: (symbol: CustomSymbol | null) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState<ColorChoice>(symbol.baseColor ?? "C");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateSymbolAction({
        id: symbol.id,
        name: data.get("name"),
        manaValue: data.get("manaValue"),
        baseColor: color,
      }).catch(() => null);
      if (!result) {
        setError({ message: "The symbol couldn't be saved. Try again." });
        onError("The symbol couldn't be saved. Try again.");
        return;
      }
      if (!result.ok) {
        setError({ field: result.field, message: result.error });
        onError(result.error);
        return;
      }
      onDone(result.symbol);
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 border-t border-border/60 pt-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-xs font-medium text-foreground">
            Name
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            defaultValue={symbol.name}
            maxLength={SYMBOL_NAME_MAX}
            autoComplete="off"
            aria-invalid={error?.field === "name" ? true : undefined}
            aria-describedby={error?.field === "name" ? `${id}-error` : undefined}
            className={inputClass(error?.field === "name")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-mv`} className="text-xs font-medium text-foreground">
            Mana value
          </label>
          <input
            id={`${id}-mv`}
            name="manaValue"
            type="number"
            inputMode="numeric"
            min={0}
            max={SYMBOL_MANA_VALUE_MAX}
            step={1}
            defaultValue={symbol.manaValue}
            aria-invalid={error?.field === "manaValue" ? true : undefined}
            aria-describedby={error?.field === "manaValue" ? `${id}-error` : undefined}
            className={cn(inputClass(error?.field === "manaValue"), "w-28")}
          />
        </div>
      </div>
      <ChipGroup ariaLabel="Colour" value={color} onChange={setColor} options={COLOR_OPTIONS} keepCase size="sm" />
      {error ? (
        <p id={`${id}-error`} role={error.field ? undefined : "alert"} className="text-sm text-danger">
          {error.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// --- one removed symbol -------------------------------------------------------

function RemovedRow({
  symbol,
  full,
  onRestored,
  onDeleted,
  onError,
}: {
  symbol: CustomSymbol;
  full: boolean;
  onRestored: (symbol: CustomSymbol) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const fullNoteId = useId();
  const token = symbolToken(symbol.code);

  const restore = () =>
    startTransition(async () => {
      const result = await restoreSymbolAction({ id: symbol.id }).catch(() => null);
      if (!result) onError("The symbol couldn't be restored. Try again.");
      else if (!result.ok) onError(result.error);
      else onRestored(result.symbol);
    });

  const deleteForGood = () => {
    if (!window.confirm(`Delete ${token} ${symbol.name} for good? Only a symbol no card uses can be deleted.`)) return;
    startTransition(async () => {
      const result = await removeSymbolAction({ id: symbol.id }).catch(() => null);
      if (!result) onError("The symbol couldn't be deleted. Try again.");
      else if (!result.ok) onError(result.error);
      else onDeleted();
    });
  };

  return (
    <div className="flex w-full items-center gap-3 rounded-card border border-dashed border-border/70 bg-surface/30 p-4">
      <SymbolPicture src={symbol.imageUrl} size={36} faded />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Code>{token}</Code>
          <span className="truncate text-sm text-foreground">{symbol.name}</span>
        </div>
        <span className="text-xs text-muted">{symbolMeaningLabel(symbol)}</span>
        {full ? (
          <span id={fullNoteId} className="text-xs text-subtle">
            You have {LIVE_SYMBOL_CAP} symbols — remove one to restore this.
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-disabled={full || undefined}
          aria-describedby={full ? fullNoteId : undefined}
          onClick={full ? undefined : restore}
          aria-label={`Restore ${token} ${symbol.name}`}
          className={cn(full && "cursor-not-allowed opacity-50")}
        >
          <RotateCcw aria-hidden />
          Restore
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={deleteForGood}
          aria-label={`Delete ${token} ${symbol.name} for good`}
          className="hover:text-danger"
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </div>
    </div>
  );
}

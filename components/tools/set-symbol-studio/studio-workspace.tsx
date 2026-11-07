"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, ImageUp, Loader2, Pencil, Scissors, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CutoutControls } from "@/components/tools/set-symbol-studio/cutout-controls";
import { forgetStudioSymbols } from "@/components/tools/set-symbol-studio/studio-symbol-picker";
import { SymbolShowcase, type SymbolLooks } from "@/components/tools/set-symbol-studio/symbol-showcase";
import { cn } from "@/lib/utils";
import { autoCutoutMode, type RgbaImage } from "@/lib/tools/set-symbol/cutout";
import { decodeForPreview, decodeUrlForPreview, previewLooks, type PreviewLooks } from "@/lib/tools/set-symbol/browser";
import {
  deleteSymbolAction,
  recutSymbolAction,
  renameSymbolAction,
  uploadSymbolAction,
} from "@/lib/tools/set-symbol/actions";
import {
  cutoutSettingsSchema,
  SYMBOL_NAME_MAX,
  SYMBOL_UPLOAD_MAX_BYTES,
  type CutoutSettings,
  type StudioSymbol,
} from "@/lib/tools/set-symbol/model";
import {
  PROMPT_PROBLEM_MESSAGES,
  SUBJECT_MAX,
  SYMBOL_STYLE_LABELS,
  SYMBOL_STYLES,
  symbolPromptProblem,
  type SymbolStyle,
} from "@/lib/tools/set-symbol/prompt";

// ---------------------------------------------------------------------------
// Set Symbol Studio (beta tool `set-symbol-studio`). Make a symbol on the
// left — drawn by FLUX from a description (1 credit), or brought by the
// maker with its background keyed away (free, no model) — and see it on the
// right the ways a card shows it. A saved symbol goes onto a NEW card as its
// set icon (following the card's rarity) or its watermark, or is picked on
// any card's Set icon step / Watermark picker ("Your symbols").
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: CutoutSettings = cutoutSettingsSchema.parse({});
const PREVIEW_DELAY_MS = 120;

type Draft =
  | { kind: "upload"; file: File; source: RgbaImage; settings: CutoutSettings; name: string }
  | { kind: "recut"; symbolId: string; source: RgbaImage; settings: CutoutSettings };

function looksOf(symbol: StudioSymbol): SymbolLooks {
  const f = symbol.files;
  return { common: f.common, uncommon: f.uncommon, rare: f.rare, mythic: f.mythic, plain: f.plain, watermark: f.watermark };
}

function nameFromFile(file: File): string {
  const base = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const name = base ? base.charAt(0).toUpperCase() + base.slice(1) : "My symbol";
  return name.slice(0, SYMBOL_NAME_MAX);
}

/** The live preview of a draft, recomputed a moment after each change. */
function useDraftPreview(draft: Draft | null): { looks: PreviewLooks | null; computing: boolean } {
  const [state, setState] = useState<{ looks: PreviewLooks | null; for: Draft | null }>({ looks: null, for: null });
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      const looks = previewLooks(draft.source, draft.settings);
      setState({ looks, for: draft });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  if (!draft) return { looks: null, computing: false };
  return { looks: state.looks, computing: state.for !== draft };
}

function Intro() {
  const steps = [
    { icon: Wand2, title: "Describe it, or bring it", text: "FLUX draws one bold shape from your words — or upload a drawing, a logo or a photo of a sketch." },
    { icon: Scissors, title: "Background gone, no AI", text: "Your picture is keyed out right here: flat colours, checkerboards, paper and shadows." },
    { icon: Sparkles, title: "Every rarity at once", text: "Black, silver, gold and mythic orange with a keyline, plus a matching watermark." },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-6 py-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-xl font-semibold text-foreground">Your set&apos;s mark, in every rarity</h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted">
          Make a symbol on the left. It shows up here on a type line, at print size and as a watermark.
        </p>
      </div>
      <ol className="grid gap-3 @xl:grid-cols-3">
        {steps.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-elevated/40 p-4">
            <span className="flex items-center gap-2 text-xs font-semibold text-gold">
              <Icon className="h-4 w-4" aria-hidden />
              {index + 1}. {title}
            </span>
            <span className="text-xs leading-5 text-muted">{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Drawing() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5 text-center">
      <div className="relative flex h-40 w-40 items-center justify-center rounded-2xl border border-gold/30 bg-gold/[0.05]">
        <div className="absolute inset-3 animate-pulse rounded-xl bg-gradient-to-br from-gold/20 via-transparent to-ember/20" />
        <Sparkles className="h-10 w-10 animate-[spin_6s_linear_infinite] text-gold" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">Drawing your symbol…</p>
        <p className="text-sm text-muted">FLUX paints it, then every rarity is cut from it. Up to a minute.</p>
      </div>
    </div>
  );
}

export function SetSymbolStudio({ initialSymbols, aiReady }: { initialSymbols: StudioSymbol[]; aiReady: boolean }) {
  const upgrade = useUpgradeModal();
  const [symbols, setSymbols] = useState<StudioSymbol[]>(initialSymbols);
  const [selectedId, setSelectedId] = useState<string | null>(initialSymbols[0]?.id ?? null);
  const [tab, setTab] = useState<"generate" | "upload">("generate");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, startSaving] = useTransition();
  const [status, setStatus] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Generate
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState<SymbolStyle>("bold");
  const [genError, setGenError] = useState<string | null>(null);
  const subjectId = useId();
  const subjectNoteId = useId();

  // Upload
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadNameId = useId();

  // Rename
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameId = useId();

  const selected = useMemo(() => symbols.find((s) => s.id === selectedId) ?? null, [symbols, selectedId]);
  const preview = useDraftPreview(draft);
  const resolvedMode = useMemo(
    () => (draft && draft.settings.mode === "auto" ? autoCutoutMode(draft.source) : null),
    [draft],
  );

  const announce = useCallback((text: string) => setStatus(text), []);

  const show = useCallback((symbol: StudioSymbol) => {
    setSymbols((prev) => [symbol, ...prev.filter((s) => s.id !== symbol.id)]);
    setSelectedId(symbol.id);
    setDraft(null);
    forgetStudioSymbols();
    if (window.matchMedia("(max-width: 1279px)").matches) {
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // --- generate ---------------------------------------------------------------
  const subjectProblem = subject.trim() ? symbolPromptProblem(subject) : null;
  const generate = async () => {
    const problem = symbolPromptProblem(subject);
    if (problem) {
      setGenError(PROMPT_PROBLEM_MESSAGES[problem]);
      return;
    }
    setGenError(null);
    setGenerating(true);
    setDraft(null);
    announce("Drawing your symbol. This takes up to a minute.");
    try {
      const response = await fetch("/api/tools/set-symbol-studio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, style }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; symbol: StudioSymbol; credits: number | null }
        | { ok: false; error?: string; code?: string; credits?: number | null }
        | null;
      if (body && typeof body.credits === "number") publishCredits(body.credits);
      if (!body || !body.ok) {
        const message = body?.error ?? "The symbol couldn't be drawn. Try again.";
        if (body?.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", "set_symbol_studio");
        setGenError(message);
        announce(message);
        return;
      }
      show(body.symbol);
      announce(`${body.symbol.name} is ready.`);
      toast.success("Symbol drawn — every rarity is ready.");
    } catch {
      const message = "We lost the answer from the image service. If a credit was taken, it comes back within the hour.";
      setGenError(message);
      announce(message);
    } finally {
      setGenerating(false);
    }
  };

  // --- upload -----------------------------------------------------------------
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setUploadError("Use a PNG, JPEG or WebP picture.");
      return;
    }
    if (file.size > SYMBOL_UPLOAD_MAX_BYTES) {
      setUploadError("Pictures can be up to 8 MB.");
      return;
    }
    try {
      const source = await decodeForPreview(file);
      setDraft({ kind: "upload", file, source, settings: DEFAULT_SETTINGS, name: nameFromFile(file) });
      announce("Picture loaded. Adjust the cut-out, then save.");
    } catch {
      setUploadError("That picture couldn't be opened.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveUpload = () => {
    if (draft?.kind !== "upload") return;
    const current = draft;
    startSaving(async () => {
      const form = new FormData();
      form.append("file", current.file);
      form.append("name", current.name);
      form.append("settings", JSON.stringify(current.settings));
      const result = await uploadSymbolAction(form).catch(() => ({ ok: false as const, error: "The symbol couldn't be saved." }));
      if (!result.ok) {
        setUploadError(result.error);
        announce(result.error);
        return;
      }
      show(result.symbol);
      announce(`${result.symbol.name} is saved.`);
      toast.success("Symbol saved — every rarity is ready.");
    });
  };

  // --- re-cut ---------------------------------------------------------------
  const [recutLoading, setRecutLoading] = useState(false);
  const startRecut = async (symbol: StudioSymbol) => {
    setRecutLoading(true);
    try {
      const source = await decodeUrlForPreview(symbol.files.source);
      setDraft({ kind: "recut", symbolId: symbol.id, source, settings: symbol.settings });
      announce("Adjust the cut-out; the preview follows.");
    } catch {
      toast.error("The original picture couldn't be loaded for a preview. Try again in a moment.");
    } finally {
      setRecutLoading(false);
    }
  };
  const saveRecut = () => {
    if (draft?.kind !== "recut") return;
    const current = draft;
    startSaving(async () => {
      const result = await recutSymbolAction({ id: current.symbolId, settings: current.settings }).catch(() => ({
        ok: false as const,
        error: "The symbol couldn't be cut again.",
      }));
      if (!result.ok) {
        toast.error(result.error);
        announce(result.error);
        return;
      }
      show(result.symbol);
      announce("Saved. Cards already using the old cut keep it.");
      toast.success("Saved as a new cut. Cards already using the old one keep it.");
    });
  };

  // --- rename / delete ------------------------------------------------------
  const rename = (symbol: StudioSymbol, name: string) => {
    const next = name.replace(/\s+/g, " ").trim();
    setRenaming(null);
    if (!next || next === symbol.name) return;
    setSymbols((prev) => prev.map((s) => (s.id === symbol.id ? { ...s, name: next } : s)));
    void renameSymbolAction({ id: symbol.id, name: next }).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setSymbols((prev) => prev.map((s) => (s.id === symbol.id ? { ...s, name: symbol.name } : s)));
      } else {
        forgetStudioSymbols();
      }
    });
  };
  const remove = (symbol: StudioSymbol) => {
    if (!window.confirm(`Remove “${symbol.name}” from your studio? Cards already using it keep their pictures.`)) return;
    startSaving(async () => {
      const result = await deleteSymbolAction({ id: symbol.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const rest = symbols.filter((s) => s.id !== symbol.id);
      setSymbols(rest);
      setSelectedId(rest[0]?.id ?? null);
      setDraft(null);
      forgetStudioSymbols();
      announce(`${symbol.name} removed.`);
      toast.success("Symbol removed.");
    });
  };

  // --- the stage ------------------------------------------------------------
  const stage = (() => {
    if (generating) return <Drawing />;
    if (draft) {
      const title = draft.kind === "upload" ? draft.name || "Your symbol" : (selected?.name ?? "Your symbol");
      const nothing = !preview.computing && !preview.looks;
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
            <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[11px] text-gold">Live preview</span>
          </div>
          {nothing ? (
            <p role="alert" className="rounded-lg border border-ember/40 bg-ember/10 p-4 text-sm text-foreground">
              Nothing is left after removing the background. Lower the tolerance or pick another way to find it.
            </p>
          ) : preview.looks ? (
            <SymbolShowcase looks={preview.looks} name={title} legibility={preview.looks.legibility} busy={preview.computing} />
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-muted">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </div>
          )}
          {draft.kind === "recut" ? (
            <div className="flex flex-col gap-5 border-t border-border/60 pt-5">
              <CutoutControls
                settings={draft.settings}
                resolvedMode={resolvedMode}
                disabled={saving}
                onChange={(settings) => setDraft({ ...draft, settings })}
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveRecut} disabled={saving || nothing}>
                  {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Scissors aria-hidden />}
                  Save this cut
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }
    if (!selected) return <Intro />;
    const createHref = (use: "icon" | "watermark") =>
      `/create?${new URLSearchParams({ setSymbol: selected.id, use }).toString()}`;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {renaming === selected.id ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement | null;
                rename(selected, input?.value ?? "");
              }}
            >
              <label htmlFor={renameId} className="sr-only">
                Symbol name
              </label>
              <input
                id={renameId}
                name="name"
                defaultValue={selected.name}
                maxLength={SYMBOL_NAME_MAX}
                autoFocus
                onBlur={(event) => rename(selected, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenaming(null);
                }}
                className={inputClass(false)}
              />
            </form>
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="truncate font-display text-lg font-semibold text-foreground">{selected.name}</h2>
              <p className="text-xs text-muted">
                {selected.source === "ai" ? "Drawn by FLUX" : "Your picture, background removed"}
                {selected.prompt ? ` · “${selected.prompt}”` : ""}
              </p>
            </div>
          )}
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={() => setRenaming(selected.id)} aria-label={`Rename ${selected.name}`}>
              <Pencil aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(selected)} disabled={saving} aria-label={`Remove ${selected.name}`}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        <SymbolShowcase
          looks={looksOf(selected)}
          name={selected.name}
          legibility={selected.legibility}
          footer={
            <div className="flex flex-col gap-3 border-t border-border/60 pt-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Put it on a card</span>
              <div className="flex flex-wrap gap-2">
                <Link href={createHref("icon")} className={buttonVariants({ variant: "primary", size: "md" })}>
                  New card with this set icon
                </Link>
                <Link href={createHref("watermark")} className={buttonVariants({ variant: "secondary", size: "md" })}>
                  New card with this watermark
                </Link>
              </div>
              <p className="text-xs leading-5 text-muted">
                The set icon follows the card&apos;s rarity. On any card you edit, pick it under “Your symbols” on the Set
                icon step or in the Watermark picker.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => void startRecut(selected)} disabled={recutLoading}>
                  {recutLoading ? <Loader2 className="animate-spin" aria-hidden /> : <Scissors aria-hidden />}
                  Fine-tune the cut
                </Button>
                <a
                  href={selected.files.plain}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <ExternalLink aria-hidden />
                  Open the PNG
                </a>
              </div>
            </div>
          }
        />
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-10">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <SurfaceCard className="flex flex-col gap-5 p-5 sm:p-6">
          <Tabs value={tab} onValueChange={(next) => setTab(next as "generate" | "upload")}>
            <TabsList ariaLabel="Make a symbol">
              <TabsTrigger value="generate">
                <Wand2 className="h-4 w-4" aria-hidden />
                Generate with AI
              </TabsTrigger>
              <TabsTrigger value="upload">
                <ImageUp className="h-4 w-4" aria-hidden />
                Bring your own
              </TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="mt-5">
              <form
                className="flex flex-col gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void generate();
                }}
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor={subjectId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
                    Describe the symbol
                  </label>
                  <textarea
                    id={subjectId}
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                      setGenError(null);
                    }}
                    rows={3}
                    maxLength={SUBJECT_MAX}
                    placeholder="A cracked moon above a lighthouse"
                    aria-describedby={subjectNoteId}
                    aria-invalid={subjectProblem || genError ? true : undefined}
                    className={textareaClass(Boolean(subjectProblem || genError))}
                    disabled={generating}
                  />
                  <span id={subjectNoteId} className={cn("text-xs", subjectProblem || genError ? "text-danger" : "text-muted")}>
                    {subjectProblem && subjectProblem !== "too_short"
                      ? PROMPT_PROBLEM_MESSAGES[subjectProblem]
                      : (genError ?? "One idea reads best: an object, a creature, a sigil. FLUX draws it as one bold shape.")}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Style</span>
                  <ChipGroup
                    ariaLabel="Style"
                    layout="grid-2"
                    value={style}
                    onChange={setStyle}
                    options={SYMBOL_STYLES.map((value) => ({ value, ...SYMBOL_STYLE_LABELS[value] }))}
                    keepCase
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Button type="submit" size="lg" disabled={generating || !aiReady || subject.trim().length < 3}>
                    {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                    {generating ? "Drawing…" : "Generate symbol"}
                    <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-normal">1 credit</span>
                  </Button>
                  <p className="text-xs leading-5 text-muted">
                    {aiReady
                      ? "One credit draws one symbol; its four rarities and the watermark are painted from it for free. A failed drawing refunds the credit."
                      : "AI images aren't configured on this deployment. Bring your own picture instead."}
                  </p>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="upload" className="mt-5">
              <div className="flex flex-col gap-5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label="Choose a picture"
                  onChange={(event) => void pickFile(event.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void pickFile(event.dataTransfer.files?.[0]);
                  }}
                  disabled={saving}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                    dragging ? "border-gold bg-gold/10" : "border-border-strong bg-elevated/30 hover:border-gold/60",
                  )}
                >
                  <ImageUp className="h-7 w-7 text-gold" aria-hidden />
                  <span className="text-sm font-medium text-foreground">
                    {draft?.kind === "upload" ? "Choose another picture" : "Choose a picture or drop it here"}
                  </span>
                  <span className="text-xs text-muted">PNG, JPEG or WebP, up to 8 MB. Free — no AI runs.</span>
                </button>
                {uploadError ? (
                  <p role="alert" className="text-sm text-danger">
                    {uploadError}
                  </p>
                ) : null}

                {draft?.kind === "upload" ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <label htmlFor={uploadNameId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
                        Name
                      </label>
                      <input
                        id={uploadNameId}
                        value={draft.name}
                        maxLength={SYMBOL_NAME_MAX}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        className={inputClass(!draft.name.trim())}
                        aria-invalid={!draft.name.trim() || undefined}
                      />
                    </div>
                    <CutoutControls
                      settings={draft.settings}
                      resolvedMode={resolvedMode}
                      disabled={saving}
                      onChange={(settings) => setDraft({ ...draft, settings })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={saveUpload}
                        disabled={saving || !draft.name.trim() || (!preview.computing && !preview.looks)}
                      >
                        {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Scissors aria-hidden />}
                        Save symbol
                      </Button>
                      <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                        Discard
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </SurfaceCard>

        <div ref={stageRef} className="scroll-mt-24">
          <SurfaceCard tone="gold" className="@container min-h-[480px] p-5 sm:p-6">
            {stage}
          </SurfaceCard>
        </div>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="studio-library-heading">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="studio-library-heading" className="font-display text-lg font-semibold text-foreground">
            My symbols
          </h2>
          <span className="text-xs text-muted">{symbols.length === 1 ? "1 symbol" : `${symbols.length} symbols`}</span>
        </div>
        {symbols.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted">
            Symbols you make are kept here, ready for any card.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {symbols.map((symbol) => {
              const active = symbol.id === selectedId && !draft;
              return (
                <li key={symbol.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedId(symbol.id);
                      setDraft(null);
                    }}
                    className={cn(
                      "group flex w-full flex-col items-center gap-2 rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                      active ? "border-gold bg-gold/10" : "border-border/70 bg-surface/60 hover:border-border-strong",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={symbol.files.rare} alt="" className="aspect-square w-full max-w-16 object-contain" loading="lazy" />
                    <span className="line-clamp-1 w-full text-center text-xs text-muted group-hover:text-foreground">
                      {symbol.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

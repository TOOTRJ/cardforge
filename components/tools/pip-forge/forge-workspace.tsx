"use client";

import { useCallback, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Hammer, Loader2, Palette, Pencil, Ruler, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { Button } from "@/components/ui/button";
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ColourCardView } from "@/components/tools/pip-forge/colour-card-view";
import { AI_DISC, DiscPicker } from "@/components/tools/pip-forge/disc-picker";
import { PipAtCardSize, PipDiscPreview } from "@/components/tools/pip-forge/pip-visuals";
import { UseAsPip } from "@/components/tools/pip-forge/use-as-pip";
import { cn } from "@/lib/utils";
import type { PipOverrides } from "@/lib/pips/override";
import { deletePipAction, recolourPipAction, renamePipAction } from "@/lib/tools/pip-forge/actions";
import { IDEA_MAX, PIP_NAME_MAX, type ForgedPip } from "@/lib/tools/pip-forge/model";
import {
  IDEA_PROBLEM_MESSAGES,
  ideaProblem,
  PIP_PROMPT_PROBLEM_MESSAGES,
  pipPromptProblem,
} from "@/lib/tools/pip-forge/prompt";
import { SUBJECT_MAX, SUBJECT_MIN } from "@/lib/tools/set-symbol/prompt";

// ---------------------------------------------------------------------------
// Pip Forge (beta tool `pip-forge`). Describe a symbol on the left — and,
// if you like, what its colour stands for and the disc's colour — and one
// credit forges a pip (FLUX draws the glyph; it is cleaned for card size and
// put on our own disc) with the colour card it stands for. On the stage:
// the pip, how it reads at 16 and 24 px beside real symbols, a new disc
// colour for free, "Use it on your cards" (one of the six custom pips) and
// the colour card. Every pip is kept below ("My pips").
// ---------------------------------------------------------------------------

function Intro() {
  const steps = [
    { icon: Wand2, title: "Describe a symbol", text: "One idea reads best: a key, a crowned eye, a spiral of smoke." },
    { icon: Ruler, title: "Built for card size", text: "FLUX draws the glyph; we clean it, set it on a disc and check it at 16 and 24 px." },
    { icon: Palette, title: "A colour to stand for", text: "Its philosophy, values, mechanics with a new keyword, limits and place on the wheel." },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-6 py-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-xl font-semibold text-foreground">A sixth colour, starting with its pip</h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted">
          Forge a pip on the left. It shows up here at card size, with the colour it stands for.
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

function Forging() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5 text-center">
      <div className="relative flex h-40 w-40 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.05]">
        <div className="absolute inset-4 animate-pulse rounded-full bg-gradient-to-br from-gold/25 via-transparent to-ember/20" />
        <Hammer className="h-10 w-10 animate-bounce text-gold" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">Forging your pip…</p>
        <p className="max-w-sm text-sm text-muted">
          FLUX draws the glyph while its colour card is written. It&apos;s checked at card size before it&apos;s kept — up to a
          minute or two.
        </p>
      </div>
    </div>
  );
}

/** The pip large, on a light table. */
function Hero({ pip, tryDisc }: { pip: ForgedPip; tryDisc: string | null }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-border/60 p-8"
      style={{
        backgroundColor: "#1a1b22",
        backgroundImage: "radial-gradient(ellipse at center, rgba(255,255,255,0.08), transparent 70%)",
      }}
    >
      {tryDisc ? (
        <PipDiscPreview glyphUrl={pip.files.glyph} disc={tryDisc} size={160} label={`${pip.name} on the new disc colour`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pip.files.pip} alt={`${pip.name} pip`} width={160} height={160} className="h-40 w-40 rounded-full" />
      )}
    </div>
  );
}

export function PipForge({
  initialPips,
  initialOverrides,
  aiReady,
}: {
  initialPips: ForgedPip[];
  initialOverrides: PipOverrides;
  aiReady: boolean;
}) {
  const upgrade = useUpgradeModal();
  const [pips, setPips] = useState<ForgedPip[]>(initialPips);
  const [selectedId, setSelectedId] = useState<string | null>(initialPips[0]?.id ?? null);
  const [overrides, setOverrides] = useState<PipOverrides>(initialOverrides);
  const [forging, setForging] = useState(false);
  const [saving, startSaving] = useTransition();
  const [status, setStatus] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // The form
  const [subject, setSubject] = useState("");
  const [idea, setIdea] = useState("");
  const [disc, setDisc] = useState<string>(AI_DISC);
  const [formError, setFormError] = useState<string | null>(null);
  const subjectId = useId();
  const subjectNoteId = useId();
  const ideaId = useId();
  const ideaNoteId = useId();

  // A disc colour being tried on the selected pip (null = its own).
  const [tryDisc, setTryDisc] = useState<string | null>(null);

  // Rename — one answer per rename (Enter's submit, then the blur of the
  // input it unmounts, must not save twice).
  const [renaming, setRenaming] = useState(false);
  const renameSettled = useRef(true);
  const renameButtonRef = useRef<HTMLButtonElement | null>(null);
  const renameId = useId();

  const selected = useMemo(() => pips.find((p) => p.id === selectedId) ?? null, [pips, selectedId]);
  const announce = useCallback((text: string) => setStatus(text), []);

  const select = (id: string) => {
    setSelectedId(id);
    setTryDisc(null);
    setRenaming(false);
  };

  const show = useCallback((pip: ForgedPip) => {
    setPips((prev) => [pip, ...prev.filter((p) => p.id !== pip.id)]);
    setSelectedId(pip.id);
    setTryDisc(null);
    if (window.matchMedia("(max-width: 1279px)").matches) {
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // --- forge ------------------------------------------------------------------
  const subjectProblem = subject.trim() ? pipPromptProblem(subject) : null;
  const ideaIssue = ideaProblem(idea);
  const forge = async () => {
    const problem = pipPromptProblem(subject);
    if (problem) {
      setFormError(PIP_PROMPT_PROBLEM_MESSAGES[problem]);
      return;
    }
    if (ideaIssue) {
      setFormError(IDEA_PROBLEM_MESSAGES[ideaIssue]);
      return;
    }
    setFormError(null);
    setForging(true);
    announce("Forging your pip. This takes up to a minute or two.");
    try {
      const response = await fetch("/api/tools/pip-forge/forge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, idea, disc: disc === AI_DISC ? null : disc }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; pip: ForgedPip; credits: number | null }
        | { ok: false; error?: string; code?: string; credits?: number | null }
        | null;
      if (body && typeof body.credits === "number") publishCredits(body.credits);
      if (!body || !body.ok) {
        const message = body?.error ?? "The pip couldn't be forged. Try again.";
        if (body?.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", "pip_forge");
        setFormError(message);
        announce(message);
        return;
      }
      show(body.pip);
      announce(`${body.pip.name} is forged.`);
      toast.success(`${body.pip.name} is forged — and checked at card size.`);
    } catch {
      const message = "We lost the answer from the AI service. If a credit was taken, it comes back within the hour.";
      setFormError(message);
      announce(message);
    } finally {
      setForging(false);
    }
  };

  // --- recolour -----------------------------------------------------------------
  const saveColour = () => {
    if (!selected || !tryDisc) return;
    const target = selected;
    const colour = tryDisc;
    startSaving(async () => {
      const result = await recolourPipAction({ id: target.id, disc: colour }).catch(() => ({
        ok: false as const,
        error: "The pip couldn't be painted. Try again.",
      }));
      if (!result.ok) {
        toast.error(result.error);
        announce(result.error);
        return;
      }
      setPips((prev) => [result.pip, ...prev.filter((p) => p.id !== result.pip.id)]);
      setTryDisc(null);
      announce(`${result.pip.name} has its new disc colour.`);
      toast.success("New disc colour saved. A pip you already use on your cards keeps its old colour until you use this one again.");
    });
  };

  // --- rename / delete ------------------------------------------------------------
  const startRename = () => {
    renameSettled.current = false;
    setRenaming(true);
  };
  const endRename = () => {
    renameSettled.current = true;
    setRenaming(false);
    requestAnimationFrame(() => renameButtonRef.current?.focus());
  };
  const rename = (pip: ForgedPip, name: string) => {
    if (renameSettled.current) return;
    const next = name.replace(/\s+/g, " ").trim();
    endRename();
    if (!next || next === pip.name) return;
    setPips((prev) => prev.map((p) => (p.id === pip.id ? { ...p, name: next } : p)));
    void renamePipAction({ id: pip.id, name: next }).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setPips((prev) => prev.map((p) => (p.id === pip.id ? { ...p, name: pip.name } : p)));
      }
    });
  };
  const remove = (pip: ForgedPip) => {
    if (!window.confirm(`Remove “${pip.name}” from your forge? If you use it as a custom pip, your cards keep it.`)) return;
    startSaving(async () => {
      const result = await deletePipAction({ id: pip.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const rest = pips.filter((p) => p.id !== pip.id);
      setPips(rest);
      setSelectedId(rest[0]?.id ?? null);
      setTryDisc(null);
      announce(`${pip.name} removed.`);
      toast.success("Pip removed.");
      // The button that was pressed is gone: the focus goes to the library.
      requestAnimationFrame(() => libraryHeadingRef.current?.focus());
    });
  };

  // --- the stage ----------------------------------------------------------------------
  const stage = (() => {
    if (forging) return <Forging />;
    if (!selected) return <Intro />;
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {renaming ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement | null;
                rename(selected, input?.value ?? "");
              }}
            >
              <label htmlFor={renameId} className="sr-only">
                Pip name
              </label>
              <input
                id={renameId}
                name="name"
                defaultValue={selected.name}
                maxLength={PIP_NAME_MAX}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => rename(selected, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    endRename();
                  }
                }}
                className={inputClass(false)}
              />
            </form>
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="truncate font-display text-lg font-semibold text-foreground">{selected.name}</h2>
              <p className="line-clamp-2 text-xs text-muted">Forged from “{selected.prompt}”</p>
            </div>
          )}
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" ref={renameButtonRef} onClick={startRename} aria-label={`Rename ${selected.name}`}>
              <Pencil aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(selected)} disabled={saving} aria-label={`Remove ${selected.name}`}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-5">
            <Hero pip={selected} tryDisc={tryDisc} />
            <DiscPicker
              value={tryDisc ?? selected.disc}
              onChange={(next) => setTryDisc(next === selected.disc ? null : next)}
              allowAi={false}
              disabled={saving}
            />
            {tryDisc ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveColour} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Palette aria-hidden />}
                  Save this colour
                </Button>
                <Button variant="ghost" onClick={() => setTryDisc(null)} disabled={saving}>
                  Keep the current colour
                </Button>
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted">A new disc colour is free — the glyph is repainted, no AI.</p>
            )}
          </div>
          <div className="flex flex-col gap-8">
            <PipAtCardSize
              src={tryDisc ? null : selected.files.pip}
              glyphUrl={selected.files.glyph}
              disc={tryDisc ?? selected.disc}
              legibility={selected.legibility}
              name={selected.name}
            />
            <UseAsPip
              pip={selected}
              overrides={overrides}
              onOverridesChange={setOverrides}
              disabled={saving || Boolean(tryDisc)}
              onAnnounce={announce}
            />
            {tryDisc ? (
              <p className="-mt-5 text-xs text-muted">Save or keep the disc colour first.</p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border/60 pt-8">
          <ColourCardView pip={selected} previewDisc={tryDisc} />
        </div>
      </div>
    );
  })();

  const formProblem =
    (subjectProblem && subjectProblem !== "too_short" ? PIP_PROMPT_PROBLEM_MESSAGES[subjectProblem] : null) ?? formError;

  return (
    <div className="flex flex-col gap-10">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <SurfaceCard className="flex h-fit flex-col gap-5 p-5 sm:p-6">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void forge();
            }}
          >
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-gold" aria-hidden />
              Forge a pip
            </h2>
            <div className="flex flex-col gap-2">
              <label htmlFor={subjectId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Describe the symbol
              </label>
              <textarea
                id={subjectId}
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                  setFormError(null);
                }}
                rows={3}
                maxLength={SUBJECT_MAX}
                placeholder="A key with an eye in its bow"
                aria-describedby={subjectNoteId}
                aria-invalid={formProblem ? true : undefined}
                className={textareaClass(Boolean(formProblem))}
                disabled={forging}
              />
              <span id={subjectNoteId} className={cn("text-xs leading-5", formProblem ? "text-danger" : "text-muted")}>
                {formProblem ?? "One bold idea reads best at card size. Magic's own five symbols are off-limits."}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={ideaId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
                What the colour stands for <span className="font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <textarea
                id={ideaId}
                value={idea}
                onChange={(event) => {
                  setIdea(event.target.value);
                  setFormError(null);
                }}
                rows={2}
                maxLength={IDEA_MAX}
                placeholder="Secrets, memory and the price of a bargain"
                aria-describedby={ideaNoteId}
                aria-invalid={ideaIssue ? true : undefined}
                className={textareaClass(Boolean(ideaIssue))}
                disabled={forging}
              />
              <span id={ideaNoteId} className={cn("text-xs leading-5", ideaIssue ? "text-danger" : "text-muted")}>
                {ideaIssue ? IDEA_PROBLEM_MESSAGES[ideaIssue] : "Leave it empty and the colour grows from the symbol."}
              </span>
            </div>

            <DiscPicker value={disc} onChange={setDisc} allowAi disabled={forging} />

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                disabled={forging || !aiReady || subject.trim().length < SUBJECT_MIN || Boolean(subjectProblem) || Boolean(ideaIssue)}
              >
                {forging ? <Loader2 className="animate-spin" aria-hidden /> : <Hammer aria-hidden />}
                {forging ? "Forging…" : "Forge pip"}
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-normal">1 credit</span>
              </Button>
              <p className="text-xs leading-5 text-muted">
                {aiReady
                  ? "One credit forges the pip and its colour card. New disc colours and using it on your cards are free. A pip that can't be made readable at card size isn't kept, and the credit comes back."
                  : "AI images aren't configured on this deployment."}
              </p>
            </div>
          </form>
        </SurfaceCard>

        <div ref={stageRef} className="scroll-mt-24">
          <SurfaceCard tone="gold" className="@container min-h-[480px] p-5 sm:p-6">
            {stage}
          </SurfaceCard>
        </div>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="forge-library-heading">
        <div className="flex items-baseline justify-between gap-2">
          <h2
            id="forge-library-heading"
            ref={libraryHeadingRef}
            tabIndex={-1}
            className="rounded-sm font-display text-lg font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            My pips
          </h2>
          <span className="text-xs text-muted">{pips.length === 1 ? "1 pip" : `${pips.length} pips`}</span>
        </div>
        {pips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted">
            Pips you forge are kept here with their colour cards.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {pips.map((pip) => {
              const active = pip.id === selectedId && !forging;
              return (
                <li key={pip.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(pip.id)}
                    className={cn(
                      "group flex w-full flex-col items-center gap-2 rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                      active ? "border-gold bg-gold/10" : "border-border/70 bg-surface/60 hover:border-border-strong",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pip.files.pip} alt="" className="aspect-square w-full max-w-14 rounded-full" loading="lazy" />
                    <span className="line-clamp-1 w-full text-center text-xs text-muted group-hover:text-foreground">
                      {pip.name}
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

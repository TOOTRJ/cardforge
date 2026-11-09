"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildPlayExportAction, type PlayExportInput } from "@/lib/tools/play-exports/actions";
import { browserToJpeg, buildPlayDownload, saveBlob, type PlayDownload, type PlaySummary } from "@/lib/tools/play-exports/files";
import { guideSteps, PLAY_GUIDES } from "@/lib/tools/play-exports/guides";
import { PLAY_TARGET_LABELS, PLAY_TARGETS, isPlayTarget, type PlayTarget } from "@/lib/tools/play-exports/model";
import { toolHref } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// The play export dialog (beta tool `play-exports`): pick Cockatrice,
// Draftmancer or Tabletop Simulator, download the file, read what is in it
// and what to do next. The model comes from the server action (the rows the
// viewer may read); the file is written here (lib/tools/play-exports/files.ts)
// — Cockatrice's ZIP fetches each card's stored picture with live progress,
// and Cancel stops it. The last target picked is remembered in this browser.
// ---------------------------------------------------------------------------

export type PlayExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PlayExportInput["source"];
  /** "Wolf Pack", "3 cards" — what the dialog says it exports. */
  label: string;
};

const TARGET_KEY = "pipglyph.play-export.target";

const TARGET_OPTIONS: ChipOption<PlayTarget>[] = PLAY_TARGETS.map((target) => ({
  value: target,
  label: PLAY_TARGET_LABELS[target],
  description: PLAY_GUIDES[target].file,
}));

type Phase =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number }
  | { kind: "done"; download: PlayDownload }
  | { kind: "error"; message: string };

function rememberedTarget(): PlayTarget {
  try {
    if (typeof window === "undefined") return "cockatrice";
    const stored = window.localStorage.getItem(TARGET_KEY);
    return isPlayTarget(stored) ? stored : "cockatrice";
  } catch {
    return "cockatrice";
  }
}

/** "A, B, C and 2 more". */
function namesOf(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The summary's lines: what went in, then what didn't and why. */
export function summaryLines(summary: PlaySummary): { inside: string; warnings: string[] } {
  const parts: string[] = [];
  if (summary.customCards > 0) parts.push(`${plural(summary.customCards, "PipGlyph card")} with their text and pictures`);
  if (summary.realCards > 0) parts.push(`${plural(summary.realCards, "real card")} by name`);
  const warnings: string[] = [];
  const leftOut = summary.target === "tts";
  const privateNames = summary.unpictured.filter((card) => card.reason === "private").map((card) => card.name);
  const pendingNames = summary.unpictured.filter((card) => card.reason === "pending").map((card) => card.name);
  if (privateNames.length > 0) {
    const one = privateNames.length === 1;
    warnings.push(
      leftOut
        ? `Left out ${namesOf(privateNames)}: private cards have no shared picture. Make ${one ? "it" : "them"} unlisted to include ${one ? "it" : "them"}.`
        : `${namesOf(privateNames)} ${one ? "is" : "are"} private, so ${one ? "it has" : "they have"} no shared picture and ${one ? "shows" : "show"} as text. Make ${one ? "it" : "them"} unlisted to include the picture.`,
    );
  }
  if (pendingNames.length > 0) {
    const one = pendingNames.length === 1;
    warnings.push(
      `${namesOf(pendingNames)} ${one ? "has" : "have"} no picture yet (${one ? "it is" : "they are"} still being drawn)${leftOut ? `, so ${one ? "it was" : "they were"} left out` : ""}. Export again in a minute.`,
    );
  }
  if (summary.picturesFailed > 0) {
    warnings.push(`${plural(summary.picturesFailed, "picture")} couldn't be fetched just now. Cockatrice can still download ${summary.picturesFailed === 1 ? "it" : "them"} if picture downloads are on.`);
  }
  if (summary.hiddenEntries > 0) {
    warnings.push(`${plural(summary.hiddenEntries, "card")} you can't see in this deck ${summary.hiddenEntries === 1 ? "was" : "were"} left out.`);
  }
  if (summary.maybeboard > 0) warnings.push(`The maybeboard (${plural(summary.maybeboard, "card")}) stays out.`);
  return { inside: parts.length > 0 ? `Inside: ${parts.join(" and ")}.` : "", warnings };
}

export function PlayExportDialog({ open, onOpenChange, source, label }: PlayExportDialogProps) {
  // The browser's last pick. The dialog mounts on its button's first press
  // (play-export-button.tsx), never on the server, so storage is there.
  const [target, setTarget] = useState<PlayTarget>(rememberedTarget);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  // The result moves the focus to its heading: the download is done and
  // the next steps are there to read.
  useEffect(() => {
    if (phase.kind === "done") resultHeading.current?.focus();
  }, [phase.kind]);

  const working = phase.kind === "working";

  const pick = (next: PlayTarget) => {
    setTarget(next);
    if (phase.kind !== "working") setPhase({ kind: "idle" });
    try {
      window.localStorage.setItem(TARGET_KEY, next);
    } catch {
      // A browser without storage simply doesn't remember.
    }
  };

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "working", done: 0, total: 0 });
    try {
      const result = await buildPlayExportAction({ target, source });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setPhase({ kind: "error", message: result.error });
        return;
      }
      const download = await buildPlayDownload(result.export, target, {
        fetchImpl: (url, init) => fetch(url, init),
        toJpeg: browserToJpeg,
        today: new Date().toISOString().slice(0, 10),
        signal: controller.signal,
        onProgress: (done, total) => {
          if (!controller.signal.aborted) setPhase({ kind: "working", done, total });
        },
      });
      if (controller.signal.aborted) return;
      saveBlob(download.blob, download.filename);
      setPhase({ kind: "done", download });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("[play-exports] build failed:", error);
      setPhase({ kind: "error", message: "The file couldn't be built. Try again in a moment." });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase({ kind: "idle" });
  };

  const onDialogChange = (next: boolean) => {
    if (!next) {
      cancel();
      setPhase({ kind: "idle" });
    }
    onOpenChange(next);
  };

  const lines = phase.kind === "done" ? summaryLines(phase.download.summary) : null;

  return (
    <Dialog open={open} onOpenChange={onDialogChange}>
      <DialogContent size="lg" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Play online</DialogTitle>
          <DialogDescription>
            {source.kind === "deck" ? (
              <>
                Download <span className="text-foreground">{label}</span> for a playtesting app. Your cards go with their
                text and pictures; real cards go by name, so the app plays them from its own database.
              </>
            ) : (
              <>
                Download <span className="text-foreground">{label}</span> for a playtesting app, with their text and
                pictures.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <ChipGroup
            options={TARGET_OPTIONS}
            value={target}
            onChange={pick}
            size="md"
            layout="grid-3"
            keepCase
            ariaLabel="Playtesting app"
          />

          {phase.kind === "done" && lines ? (
            <section aria-labelledby="play-export-done" className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
              <h3
                id="play-export-done"
                ref={resultHeading}
                tabIndex={-1}
                className="flex items-center gap-2 font-medium text-foreground focus:outline-none"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                Downloaded {phase.download.filename}
              </h3>
              {lines.inside ? <p className="text-muted">{lines.inside}</p> : null}
              {lines.warnings.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {lines.warnings.map((warning) => (
                    <li key={warning} className="flex gap-2 text-muted">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="play-export-steps" className="flex flex-col gap-2 text-sm">
            <h3 id="play-export-steps" className="font-medium text-foreground">
              Then, in {PLAY_TARGET_LABELS[target]}
            </h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted marker:text-subtle">
              {guideSteps(target, source.kind).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Link
              href={`${toolHref("play-exports")}#${target}`}
              className="self-start text-sm text-primary-bright underline-offset-2 hover:underline"
            >
              More about {PLAY_TARGET_LABELS[target]}
            </Link>
          </section>

          {phase.kind === "error" ? (
            <p role="alert" className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              {phase.message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <p aria-live="polite" className="mr-auto self-center text-xs text-muted">
            {working
              ? phase.total > 0
                ? `Adding pictures… ${phase.done} of ${phase.total}`
                : "Reading the cards…"
              : ""}
          </p>
          {working ? (
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="button" onClick={start} disabled={working}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {phase.kind === "done" ? "Download again" : `Download for ${PLAY_TARGET_LABELS[target]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

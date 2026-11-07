"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileUp, Plus, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { cn } from "@/lib/utils";
import {
  addToCollectionAction,
  finishCollectionImportAction,
  importCollectionChunkAction,
} from "@/lib/tools/collection/actions";
import { IMPORT_CHUNK_LINES, MAX_COLLECTION_QUANTITY, MAX_IMPORT_CHARS } from "@/lib/tools/collection/limits";
import {
  FINISH_LABELS,
  IMPORT_FORMAT_LABELS,
  parseCollectionImport,
  problemsCsv,
  type CollectionFinish,
  type ImportProblem,
  type ParsedImport,
} from "@/lib/tools/collection/parse-import";
import type { CollectionStats } from "@/lib/tools/collection/queries";
import { collectionViewHref } from "@/lib/tools/collection/views";
import { PrintingPicture } from "./printing-tile";

const n = (value: number) => value.toLocaleString("en-US");

type Mode = "add" | "replace";

type Progress = {
  done: number;
  total: number;
  added: number;
  updated: number;
  matched: number;
  unmatched: ImportProblem[];
};

type Phase =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress }
  | { kind: "stopped"; progress: Progress; error: string; nextChunk: number }
  | { kind: "done"; progress: Progress; removed: number; full: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function CollectionAdd({ stats }: { stats: CollectionStats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ImportPanel stats={stats} />
      <AddOnePanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import a list
// ---------------------------------------------------------------------------

function ImportPanel({ stats }: { stats: CollectionStats }) {
  const router = useRouter();
  const ids = { paste: useId(), file: useId(), status: useId(), mode: useId() };
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("add");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const batchRef = useRef<string | null>(null);
  const parsedRef = useRef<ParsedImport | null>(null);

  const parsed = text.trim() ? parseCollectionImport(text) : null;
  const running = phase.kind === "running";
  useLeaveWarning(running);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS * 2) {
      toast.error("That file is too big to read. Export fewer cards at a time.");
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    setPhase({ kind: "idle" });
  };

  const run = async (startChunk: number, base: Progress) => {
    const source = parsedRef.current;
    const batchId = batchRef.current;
    if (!source || !batchId) return;
    const progress: Progress = { ...base, unmatched: [...base.unmatched] };
    setPhase({ kind: "running", progress });
    const chunks = Math.ceil(source.lines.length / IMPORT_CHUNK_LINES);
    for (let chunk = startChunk; chunk < chunks; chunk += 1) {
      const lines = source.lines.slice(chunk * IMPORT_CHUNK_LINES, (chunk + 1) * IMPORT_CHUNK_LINES);
      let result: Awaited<ReturnType<typeof importCollectionChunkAction>> | null = null;
      // Scryfall's hiccups are waited out (three tries); a quota or a full
      // collection stops the import where it is, to go on later.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          result = await importCollectionChunkAction({ batchId, mode, lines });
        } catch {
          result = { ok: false, error: "The connection dropped.", retryAfterSeconds: 3 };
        }
        if (result.ok || !result.retryAfterSeconds || result.retryAfterSeconds > 20) break;
        await sleep(result.retryAfterSeconds * 1000);
      }
      if (!result || !result.ok) {
        setPhase({
          kind: "stopped",
          progress: { ...progress },
          error: result?.error ?? "The import stopped.",
          nextChunk: chunk,
        });
        router.refresh();
        return;
      }
      progress.done += lines.length;
      progress.added += result.added;
      progress.updated += result.updated;
      progress.matched += result.matched;
      progress.unmatched.push(...result.unmatched);
      setPhase({ kind: "running", progress: { ...progress } });
      if (result.full) {
        // Nothing more fits: the rest of the file is listed, not sent.
        for (const line of source.lines.slice((chunk + 1) * IMPORT_CHUNK_LINES)) {
          progress.unmatched.push({ line: line.line, raw: line.raw, reason: "Your collection is full." });
        }
        progress.done = progress.total;
        break;
      }
    }
    const finished = await finishCollectionImportAction({
      batchId,
      mode,
      format: source.format,
      lines: source.lines.length,
      matched: progress.matched,
      unmatched: progress.unmatched.length,
    });
    const removed = finished.ok ? finished.removed : 0;
    if (!finished.ok) toast.error(finished.error);
    setPhase({ kind: "done", progress, removed, full: progress.unmatched.some((p) => p.reason.includes("full")) });
    router.refresh();
  };

  const start = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || parsed.lines.length === 0) return;
    if (mode === "replace" && stats.cards > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    parsedRef.current = parsed;
    batchRef.current = crypto.randomUUID();
    void run(0, {
      done: 0,
      total: parsed.lines.length,
      added: 0,
      updated: 0,
      matched: 0,
      unmatched: [...parsed.problems],
    });
  };

  const reset = () => {
    setConfirming(false);
    setText("");
    setFileName(null);
    setPhase({ kind: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const progress = phase.kind === "idle" ? null : phase.progress;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section aria-labelledby="import-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="import-title" className="font-display text-xl font-semibold text-foreground">
          Import your collection
        </h2>
        <p className="text-sm leading-6 text-muted">
          Export your cards from Moxfield, ManaBox, Archidekt, Deckbox, TCGplayer or Dragon Shield and drop the CSV
          here — or paste a plain list, one card a line: <code className="text-foreground">4 Llanowar Elves (DOM) 168</code>.
        </p>
      </div>

      {phase.kind === "idle" ? (
        <form onSubmit={start} className="flex flex-col gap-4 rounded-xl border border-border bg-surface/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "relative cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-bright/50",
              )}
            >
              <input
                ref={fileRef}
                id={ids.file}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={onFile}
                className="sr-only"
              />
              <FileUp aria-hidden />
              Choose a file
            </label>
            <span className="min-w-0 truncate text-sm text-muted">{fileName ?? "CSV or text, up to 30,000 lines"}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.paste} className="text-sm font-medium text-foreground">
              Or paste your list
            </label>
            <textarea
              id={ids.paste}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setFileName(null);
              }}
              rows={8}
              spellCheck={false}
              placeholder={"1 Sol Ring (C21) 263\n4 Llanowar Elves\n1 Counterspell [MH2] *F*"}
              className={cn(textareaClass(false), "font-mono text-xs leading-5")}
              aria-describedby={parsed ? ids.status : undefined}
            />
          </div>

          {parsed ? (
            <p id={ids.status} className="text-sm text-muted">
              {parsed.lines.length === 0
                ? "No cards found in that text yet."
                : `Read as ${IMPORT_FORMAT_LABELS[parsed.format]}: ${n(parsed.lines.length)} line${parsed.lines.length === 1 ? "" : "s"}, ${n(parsed.copies)} cop${parsed.copies === 1 ? "y" : "ies"}.`}
              {parsed.problems.length > 0 ? ` ${n(parsed.problems.length)} line${parsed.problems.length === 1 ? "" : "s"} can't be read (listed after the import).` : ""}
              {parsed.truncated ? " The file is longer than the import reads — only the first part is imported." : ""}
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">What the list does</legend>
            <ChipGroup
              options={[
                { value: "add", label: "Add to my collection", description: "Copies you already have are added together." },
                {
                  value: "replace",
                  label: "Replace my collection",
                  description: "The list becomes your collection: everything else is removed.",
                },
              ]}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setConfirming(false);
              }}
              keepCase
              layout="grid-2"
              ariaLabel="What the list does"
            />
          </fieldset>

          {confirming ? (
            <p role="alert" className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-foreground">
              The {n(stats.cards)} different cards in your collection now are removed once this list is in. Lines the
              list can&apos;t match are not added. Press &ldquo;Yes, replace it&rdquo; to go on.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!parsed || parsed.lines.length === 0}>
              {confirming ? "Yes, replace it" : mode === "replace" ? "Replace my collection" : "Import"}
            </Button>
            {confirming ? (
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Keep my collection
              </Button>
            ) : null}
            {text ? (
              <Button type="button" variant="ghost" onClick={reset}>
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {progress ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface/40 p-4">
          <div className="flex flex-col gap-2">
            <div
              role="progressbar"
              aria-label="Import progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-elevated"
            >
              <div className="h-full rounded-full bg-primary-bright transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p role="status" className="text-sm text-foreground">
              {phase.kind === "running"
                ? `Matching cards with Scryfall… ${n(progress.done)} of ${n(progress.total)} lines.`
                : phase.kind === "stopped"
                  ? `Stopped after ${n(progress.done)} of ${n(progress.total)} lines: ${phase.error}`
                  : `Done. ${n(progress.added)} new card${progress.added === 1 ? "" : "s"}, ${n(progress.updated)} updated${phase.kind === "done" && phase.removed > 0 ? `, ${n(phase.removed)} removed` : ""}.${progress.unmatched.length > 0 ? ` ${n(progress.unmatched.length)} line${progress.unmatched.length === 1 ? "" : "s"} not added.` : ""}`}
            </p>
            {phase.kind === "running" ? (
              <p className="text-xs text-subtle">Keep this page open until it finishes — the cards matched so far are already saved.</p>
            ) : null}
          </div>

          {phase.kind === "stopped" ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void run(phase.nextChunk, phase.progress)}>Continue the import</Button>
              <Button variant="ghost" onClick={reset}>
                Start over
              </Button>
            </div>
          ) : null}

          {phase.kind === "done" ? (
            <div className="flex flex-wrap gap-2">
              <Link href={collectionViewHref("collection")} className={buttonVariants({ variant: "primary" })}>
                See my collection
              </Link>
              <Link href={collectionViewHref("build")} className={buttonVariants({ variant: "secondary" })}>
                Build a deck
              </Link>
              <Button variant="ghost" onClick={reset}>
                Import another list
              </Button>
            </div>
          ) : null}

          {phase.kind !== "running" && progress.unmatched.length > 0 ? <UnmatchedReview problems={progress.unmatched} /> : null}
        </div>
      ) : null}
    </section>
  );
}

const SHOWN_PROBLEMS = 200;

function UnmatchedReview({ problems }: { problems: ImportProblem[] }) {
  const sorted = [...problems].sort((a, b) => a.line - b.line);
  const download = () => {
    const blob = new Blob([problemsCsv(sorted)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "collection-import-not-added.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Not added ({n(sorted.length)})</h3>
        <Button variant="outline" size="sm" onClick={download}>
          <Download aria-hidden />
          Download the list
        </Button>
      </div>
      <p className="text-xs text-subtle">Fix these lines and import only them — the lines that went in would be added a second time.</p>
      <div className="max-h-96 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">Lines that were not added, with why</caption>
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Line
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Text
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, SHOWN_PROBLEMS).map((problem, i) => (
              <tr key={`${problem.line}-${i}`} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 tabular-nums text-muted">{problem.line || "—"}</td>
                <td className="max-w-[16rem] break-words px-3 py-2 font-mono text-xs text-foreground">{problem.raw}</td>
                <td className="px-3 py-2 text-muted">{problem.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > SHOWN_PROBLEMS ? (
        <p className="text-xs text-subtle">
          The first {SHOWN_PROBLEMS} are shown; the download has all {n(sorted.length)}.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add one card
// ---------------------------------------------------------------------------

type SearchResult = {
  id: string;
  name: string;
  set: string | null;
  set_name: string | null;
  type_line: string | null;
  print_url: string | null;
};

function AddOnePanel() {
  const router = useRouter();
  const ids = { q: useId(), qty: useId(), results: useId() };
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [finish, setFinish] = useState<CollectionFinish>("nonfoil");
  const [pending, startTransition] = useTransition();

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (!q) return;
    setSearching(true);
    setPicked(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/scryfall/search?q=${encodeURIComponent(q)}&limit=12`);
      const body = (await response.json()) as { ok: boolean; results?: SearchResult[]; error?: string };
      if (!body.ok) {
        setResults(null);
        setMessage(body.error ?? "The search didn't work. Try again.");
      } else {
        setResults(body.results ?? []);
        setMessage((body.results ?? []).length === 0 ? "No card is called that." : null);
      }
    } catch {
      setMessage("The search didn't work. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const add = () => {
    if (!picked) return;
    const count = Number.parseInt(quantity, 10);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COLLECTION_QUANTITY) {
      setMessage(`Enter a number of copies from 1 to ${n(MAX_COLLECTION_QUANTITY)}.`);
      return;
    }
    startTransition(async () => {
      const result = await addToCollectionAction({ scryfallId: picked.id, quantity: count, finish, surface: "tool" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.name} added — you own ${n(result.owned)}.`);
      setPicked(null);
      setQuantity("1");
      setFinish("nonfoil");
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="add-one-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="add-one-title" className="font-display text-xl font-semibold text-foreground">
          Add one card
        </h2>
        <p className="text-sm leading-6 text-muted">
          Search Scryfall by name. Add <code className="text-foreground">set:dom</code> to the search for one set&apos;s
          printing.
        </p>
      </div>
      <form role="search" onSubmit={search} className="flex min-w-0 gap-2">
        <label htmlFor={ids.q} className="sr-only">
          Card name
        </label>
        <input id={ids.q} name="q" type="search" maxLength={200} placeholder="Card name" className={cn(inputClass(false), "min-w-0 flex-1")} />
        <Button type="submit" variant="secondary" disabled={searching}>
          <Search aria-hidden />
          <span className="sr-only sm:not-sr-only">{searching ? "Searching…" : "Search"}</span>
        </Button>
      </form>
      <p role="status" className="text-sm text-muted empty:hidden">
        {searching ? "Searching…" : message ?? (results ? `${results.length} result${results.length === 1 ? "" : "s"}.` : "")}
      </p>

      {picked ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface/40 p-4">
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4">
            <PrintingPicture imageUrl={picked.print_url} name={picked.name} size="small" />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{picked.name}</p>
                <p className="truncate text-xs text-subtle">{picked.set_name ?? picked.set?.toUpperCase()}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={ids.qty} className="text-xs font-medium text-muted">
                  Copies
                </label>
                <input
                  id={ids.qty}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_COLLECTION_QUANTITY}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={cn(inputClass(false), "w-28")}
                />
              </div>
            </div>
          </div>
          <ChipGroup
            options={(Object.keys(FINISH_LABELS) as CollectionFinish[]).map((value) => ({ value, label: FINISH_LABELS[value] }))}
            value={finish}
            onChange={setFinish}
            keepCase
            ariaLabel="Finish"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={add} disabled={pending}>
              <Plus aria-hidden />
              {pending ? "Adding…" : "Add to my collection"}
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)} disabled={pending}>
              Back to results
            </Button>
          </div>
        </div>
      ) : results && results.length > 0 ? (
        <ul id={ids.results} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
          {results.map((card) => (
            <li key={card.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setPicked(card)}
                aria-label={`${card.name}${card.set_name ? `, ${card.set_name}` : ""}. Choose to add.`}
                className="group flex w-full flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <PrintingPicture imageUrl={card.print_url} name={card.name} size="small" className="transition-transform group-hover:-translate-y-0.5" />
                <span aria-hidden className="truncate text-xs text-foreground">
                  {card.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

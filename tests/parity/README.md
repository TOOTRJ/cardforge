# Preview parity — the baseline and how to re-record it

What the suite is, what it compares and what a red run means:
`tests/README.md` "Preview parity". This file is about the **recorded
numbers** (layer 3 of `thresholds.ts`) and the sequence that changes them.

## The baseline is one file per case per platform

```
tests/parity/baseline/
  darwin/m15__g__creature-long__symbols.json
  linux/m15__g__creature-long__symbols.json
  …
```

```json
{
 "id": "m15/g/creature-long@symbols",
 "750": {"regions":{"title":[0,0,13.7,0.112],…},"card":[3.44,0.025],"tiles":"000…"},
 "hd": {"regions":{…},"card":[…],"tiles":"…"}
}
```

The file's name is the case id with `/` and `@` as `__`
(`parityFileName`); a line per compared size; per region
`[dx, dy, mad, hot]`, the card's `[mad, hot]`, and every 25 px tile's mad as
one character. `linux/` is CI's and the one that gates a PR; `darwin/` is
what a run on a Mac is held to. A platform with no directory is held to the
limits and the known differences only.

**Why files (TODO 7.13).** #514 kept all of it in one `baseline.json`, a
line per case in a block per platform. Three renderer PRs hand-merged it in
a week: its `"recorded"` date changed on every update, every update rewrote
every line (37 lines for 22 moved cases), and two PRs that each added a case
collided whenever the two sorted next to each other — or last, where the new
line also moves a comma. With a file per case:

- two PRs that add or move **different** cases touch different files: git
  has nothing to merge;
- two PRs that move the **same** case conflict in that one file. That
  conflict is real — take either side's file whole and re-record;
- there is no date and no note: `git log -- tests/parity/baseline/` is the
  record.

Considered and not done: `merge=union` on the single file (it keeps both
sides' lines of ONE case and `JSON.parse` silently reads the last — it would
have needed the duplicate check anyway, and still not merged two edits of one
line); one file per template (two PRs on the M15 frame, the common case,
still collide); one file per case holding both platforms (the linux half
would rewrite the file the darwin half just wrote).

**The loader is strict** (`baseline.ts`, used by the run and by
`tests/unit/render/parity-matrix.test.ts`). A file is read only as the exact
text an update writes. It fails — the unit run and **Preview parity** both —
on: a line twice, a missing size, a field it does not know, a hand-formatted
file, a file under another case's name, the same case twice on a platform,
anything in the directory that is not a case file (a conflict's `.orig`),
and `tests/parity/baseline.json` come back from an older branch. Never edit
a case file by hand.

## What `--update` writes

```bash
npm run test:parity -- --update          # this platform
```

- A case's line is rewritten **only** when the case is new or today's
  measurement is outside the stored line's tolerance (`BASELINE_MARGIN`:
  ±1 px, and the difference margins) — exactly what fails a check run. Every
  other line, and every other file, stays byte for byte. The diff of a
  re-record is the list of cases that moved.
- A case the matrix no longer has: its file is deleted, on this platform
  and on the others (a removed case needs no CI round).
- It refuses to record a value over a `LIMIT` that no known difference
  names, and a stale known difference; it never touches a limit.
- The run prints what it rewrote and why, and the report
  (`tmp/parity/report.md`, CI's job summary) lists the same under "Baseline
  lines `--update` would rewrite".

`npm run test:parity -- --update --all` re-records **every** case of this
platform, also the ones inside their tolerance, and prints a banner saying
so. Its diff is the whole directory and collides with every open PR that
records a case: only when that is what the PR is for (a change to what a
line holds, a new rasteriser). A renderer change needs plain `--update`.
There is no `--all` for CI's platform by paste; run it in a linux container
if it is ever needed.

## Re-recording: the shortest correct sequence

For a change of BOTH renderers that moved recorded numbers on purpose, or a
new case (`tests/parity/cases.ts`). Two pushes, one red round:

1. **Your platform.** `npm run test:parity -- --update`, read the diff
   (only the cases you meant), commit `tests/parity/baseline/<platform>/`.
2. **Push.** *Preview parity* goes **red** — it has to: linux has no line
   for a new case ("not in tests/parity/baseline/ for this platform") or the
   old line for a moved one. The unit test `parity-matrix.test.ts` is red
   with it for a new or removed case.
3. **The linux half.** The red run printed it — in the job's log
   (`gh run view <run> --log-failed`, or the run's page) and in its
   summary, under "If both renderers were changed on purpose": a script that
   writes exactly the case files linux would re-record. Paste it at the
   repo's root, read `git diff --cached`, commit.

   The same from the artifact, if you prefer (the run prints this command
   with its own id; `gh` will not overwrite a file, hence the emptied
   `tmp/parity/ci`):

   ```bash
   rm -rf tmp/parity/ci && gh run download <run> -R TOOTRJ/cardforge -n parity-baseline -D tmp/parity/ci \
     && mkdir -p tests/parity/baseline/linux && cp -R tmp/parity/ci/linux/. tests/parity/baseline/linux/ \
     && git add tests/parity/baseline/linux
   ```

   The artifact holds only the files that differ (and `update.json` naming
   them); there is none on a green run.
4. **Push.** Green.

On a linux machine step 1 already is the linux half; `darwin/` then has no
file for a new case and the unit test stays red until someone on a Mac
records it — ask in the PR.

Not handed over: a run in which a case could not be measured at all (a
harness error — fix that first). A value over a limit IS in the script, and
still fails the next run: describe it in `KNOWN_DIFFERENCES` or fix it.

Say in the PR what moved and why. A reviewer reads the baseline diff as:
these cases, these regions, by this much.

## Merging

- `main` moved a case you did not touch: nothing to do.
- Both sides changed the same case file: `git checkout --theirs` (or
  `--ours`) that file — never a hand merge of its lines — then
  `npm run test:parity -- --update`; it rewrites the file only if the merged
  renderers left its tolerance. The linux file the same way, from the next
  red run.
- A branch from before 7.13 that changed `tests/parity/baseline.json`:
  the merge reports modify/delete. `git rm tests/parity/baseline.json` and
  run the sequence above — your cases are the only ones it writes.

import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { promptHidden } from "@/scripts/lib/hidden-prompt.mjs";

// ---------------------------------------------------------------------------
// The owner-run production scripts (frames-promote.mjs,
// strip-upload-metadata.mjs) read production's secret key at a hidden prompt
// (scripts/lib/hidden-prompt.mjs). Nothing typed may reach the terminal —
// including readline's redraw of the whole line (prompt + typed text) when
// the text crosses the terminal's right edge, which the old "let through
// what contains the question" filter printed.
// ---------------------------------------------------------------------------

/** A terminal `columns` wide that records everything written to it. */
function terminal(columns: number) {
  let written = "";
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        written += chunk.toString();
        done();
      },
    }),
    { columns, rows: 24, isTTY: true },
  );
  return { output, written: () => written };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** What the terminal shows as text: cursor moves and clears (readline's
 *  redraw of the blank answer line) removed. */
const shownText = (written: string) => written.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** No run of 4+ of the key's characters (past its public "sb_secret_"
 *  prefix) anywhere in what was written — escape sequences included. */
function expectNoKeyIn(written: string, key: string) {
  const secret = key.slice("sb_secret_".length);
  for (let i = 0; i + 4 <= secret.length; i += 1) expect(written.includes(secret.slice(i, i + 4))).toBe(false);
}

describe("promptHidden", () => {
  const question = "Production secret key (Supabase dashboard → API keys; not echoed): ";
  const key = "sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

  for (const [how, columns] of [
    ["80 columns (where prompt + key used to wrap and be redrawn)", 80],
    ["110 columns (the old prompt leaked 43 of 46 characters here)", 110],
    ["30 columns (the key alone wraps)", 30],
    ["200 columns", 200],
  ] as const) {
    it(`echoes nothing of a key typed a character at a time, with a backspace — ${how}`, async () => {
      const input = new PassThrough();
      const { output, written } = terminal(columns);
      const answer = promptHidden(question, { input, output });
      for (const ch of [...key, "X", "\x7f"]) {
        input.write(ch);
        await tick();
      }
      input.write("\r");
      expect(await answer).toBe(key);
      expectNoKeyIn(written(), key);
      expect(shownText(written())).toBe(`${question}\n\n`);
    });
  }

  it("a pasted key (one chunk) and surrounding whitespace", async () => {
    const input = new PassThrough();
    const { output, written } = terminal(80);
    const answer = promptHidden(question, { input, output });
    input.write(`  ${key}  \r`);
    expect(await answer).toBe(key);
    expectNoKeyIn(written(), key);
    expect(shownText(written())).toBe(`${question}\n\n`);
  });
});

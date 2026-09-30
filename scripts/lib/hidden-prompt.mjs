// ---------------------------------------------------------------------------
// hidden-prompt.mjs — read a secret (production's secret key, its
// CRON_SECRET, an API key) from the terminal without echoing ANY of it.
// Shared by the owner-run scripts that ask for one: frames-promote.mjs,
// strip-upload-metadata.mjs, sweep-storage-orphans.mjs, rebake-renders.mjs
// (through lib/rebake-secret.mjs).
//
// The usual trick — override readline's _writeToOutput and let through only
// the strings that contain the question — leaks: on a backspace, or when the
// typed text crosses the terminal's right edge, readline redraws the whole
// line (prompt + what was typed so far) in ONE write, and that write contains
// the question. A
// 46-character key typed into a 110-column terminal put 43 of its characters
// on the screen (2026-09-29). Here readline writes no text at all: raw mode
// (no terminal echo) goes on first, then the question is printed on its own
// line — readline's redraws (a backspace, a wrap) clear only the line being
// typed on, which stays blank — and the answer is read below it.
// ---------------------------------------------------------------------------
import readline from "node:readline";

/**
 * Ask `question` and resolve with the trimmed answer. Nothing typed or
 * pasted is written to `output` — not even readline's line redraws.
 * Ctrl+C exits (130).
 *
 * @param {string} question
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [streams]
 *   the terminal (default stdin/stdout; tests pass fakes)
 * @returns {Promise<string>}
 */
export function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    // Raw mode (no terminal echo) BEFORE the question invites typing.
    const rl = readline.createInterface({ input, output, terminal: true });
    rl._writeToOutput = () => {};
    output.write(`${question}\n`);
    rl.on("SIGINT", () => {
      rl.close();
      output.write("\n");
      process.exit(130);
    });
    rl.question("", (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer.trim());
    });
  });
}

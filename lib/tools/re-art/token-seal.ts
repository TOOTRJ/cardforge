import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// The access token a carried Re-art run borrows is kept ENCRYPTED while the
// run is carried (migration 0218, deck_reart_background_tokens — a table no
// API role reads; lib/tools/re-art/background.ts has the whole story).
//
// AES-256-GCM under a key derived from the server's own Supabase secret
// (HKDF — never that secret itself, never a key of its own in the
// database), and bound to its run: a sealed token moved to another row does
// not open. Only an ACCESS token is ever sealed — it stops working by
// itself within the hour — and never a refresh token.
//
// A leaked copy of the table alone therefore opens nothing, and a rotated
// server secret simply ends the runs being carried (they pause).
// ---------------------------------------------------------------------------

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function sealKey(): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!secret) throw new Error("No server secret to seal with (SUPABASE_SECRET_KEY).");
  return Buffer.from(hkdfSync("sha256", secret, "pipglyph", "re-art background token v1", 32));
}

/** `token`, sealed for the run `jobId`. Throws without a server secret. */
export function sealToken(token: string, jobId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  cipher.setAAD(Buffer.from(jobId, "utf8"));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The token a sealed value holds — null for anything this server did not
 *  seal for this run (another run's, a changed byte, another secret). */
export function openToken(sealed: string, jobId: string): string | null {
  try {
    if (!sealed.startsWith(`${VERSION}.`)) return null;
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(jobId, "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

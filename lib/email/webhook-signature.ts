import { createHmac, timingSafeEqual } from "node:crypto";

// Standard Webhooks / Svix signature check (what Resend signs with): HMAC-SHA256
// over `${id}.${timestamp}.${rawBody}` using the base64 secret after "whsec_",
// compared against every "v1,<base64>" entry in the signature header.
// Dependency-free so the webhook route stays a plain fetch handler.

const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
}): boolean {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!id || !timestamp || !signature) return false;

  const age = Math.abs((input.now ?? Date.now()) / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

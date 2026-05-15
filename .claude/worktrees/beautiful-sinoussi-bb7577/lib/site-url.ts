// Centralized "what's our public URL?" resolver. Used by robots.ts, sitemap.ts,
// and anywhere else that needs an absolute URL.
//
// Priority order:
//   1. NEXT_PUBLIC_SITE_URL — explicit override, set this in production.
//   2. VERCEL_PROJECT_PRODUCTION_URL — auto-set by Vercel on production deploys.
//   3. VERCEL_URL — auto-set on preview deploys.
//   4. localhost fallback for `npm run dev`.

const DEFAULT_LOCAL = "http://localhost:3000";

function normalize(url: string): string {
  let next = url.trim();
  if (!next) return "";
  if (!next.startsWith("http://") && !next.startsWith("https://")) {
    next = `https://${next}`;
  }
  return next.replace(/\/+$/, "");
}

export function getSiteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return normalize(explicit);

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return normalize(vercelProd);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return normalize(vercel);

  return DEFAULT_LOCAL;
}

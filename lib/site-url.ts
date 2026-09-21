// Centralized "what's our public URL?" resolver. Used by robots.ts, sitemap.ts,
// auth email redirects, and anywhere else that needs an absolute URL.
//
// Priority order:
//   1. NEXT_PUBLIC_SITE_URL — explicit override, set this in production.
//   2. On a Vercel PREVIEW deployment: VERCEL_BRANCH_URL (stable per git
//      branch) then VERCEL_URL. This must come BEFORE the production URL —
//      Vercel sets VERCEL_PROJECT_PRODUCTION_URL on EVERY deployment, so
//      without this a preview believes it is pipglyph.com and sends its auth
//      links (signup confirm, password reset) to production, where the dev
//      database's tokens mean nothing.
//   3. VERCEL_PROJECT_PRODUCTION_URL — production deploys.
//   4. VERCEL_URL — any other Vercel deploy.
//   5. localhost fallback for `npm run dev`.

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

  if (process.env.VERCEL_ENV === "preview") {
    const preview = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (preview) return normalize(preview);
  }

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return normalize(vercelProd);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return normalize(vercel);

  return DEFAULT_LOCAL;
}

import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Pull the origin pieces out of NEXT_PUBLIC_SUPABASE_URL so we don't
// hard-code a project ref; this works on every deploy AND against the local
// `supabase start` stack (http + port 54321) without further config.
const supabaseOrigin = (() => {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    return {
      protocol: url.protocol === "http:" ? ("http" as const) : ("https" as const),
      hostname: url.hostname,
      // "" in production (default port); "54321" on the local stack.
      port: url.port,
    };
  } catch {
    return null;
  }
})();

// The public buckets we own (created by checked-in migrations). Scoped per
// bucket instead of the broad `/storage/v1/object/public/**` so a bucket
// created ad hoc via Studio doesn't silently become an allowed pattern.
const SUPABASE_PUBLIC_BUCKETS = [
  "card-art",
  "card-exports",
  "card-renders",
  "set-covers",
  "profile-media",
  "custom-pips",
];

// NEXT_PUBLIC_SUPABASE_URL moved to the custom domain (auth.pipglyph.com)
// in 2026-07, but every storage URL minted before then is stored in the
// database as an absolute URL on the project's original hostname — which
// Supabase keeps serving forever. next/image must accept both origins or
// every pre-migration card image 400s.
const LEGACY_SUPABASE_HOSTNAME = "zkwkisxoqdhdchqyjwdc.supabase.co";

const supabaseImageOrigins = (() => {
  if (!supabaseOrigin) return [];
  const origins = [supabaseOrigin];
  if (supabaseOrigin.hostname !== LEGACY_SUPABASE_HOSTNAME) {
    origins.push({
      protocol: "https" as const,
      hostname: LEGACY_SUPABASE_HOSTNAME,
      port: "",
    });
  }
  return origins;
})();

const nextConfig: NextConfig = {
  // Phase 11 chunk 14: bump the server-action body size limit so the
  // Sharp-validated card-art upload (max 8 MB enforced server-side) can
  // actually receive 8 MB images. Default is 1 MB, which would reject
  // most uploads before our own size check runs.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Allow next/image to optimize user-uploaded card art + set covers from
  // our Supabase Storage origin (per-bucket, see SUPABASE_PUBLIC_BUCKETS).
  images: {
    remotePatterns: supabaseImageOrigins.flatMap((origin) =>
      SUPABASE_PUBLIC_BUCKETS.map((bucket) => ({
        protocol: origin.protocol,
        hostname: origin.hostname,
        ...(origin.port ? { port: origin.port } : {}),
        pathname: `/storage/v1/object/public/${bucket}/**`,
      })),
    ),
  },
};

export default nextConfig;

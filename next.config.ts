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

// Thumbnails and renders live in Supabase Storage, whose public endpoint
// answers browsers with `cache-control: no-cache` (the object's own
// max-age is honoured only edge-side), so every tile revalidated on every
// page view. `/render-cdn/*` proxies the card-renders bucket through this
// deployment with an immutable one-year header: every object under it is
// content-addressed (`?v=` stamp per bake), so it can never go stale.
// BakedCardThumbnail rewrites thumb URLs onto this path
// (lib/cards/render-cdn.ts).
const RENDER_CDN_PREFIX = "/render-cdn";
const RENDER_CDN_HEADERS = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    if (!supabaseUrl) return [];
    return [
      {
        source: `${RENDER_CDN_PREFIX}/:path*`,
        destination: `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/card-renders/:path*`,
      },
    ];
  },
  async headers() {
    return [{ source: `${RENDER_CDN_PREFIX}/:path*`, headers: RENDER_CDN_HEADERS }];
  },
  // Phase 11 chunk 14: bump the server-action body size limit so the
  // Sharp-validated card-art upload (max 8 MB enforced server-side) can
  // actually receive 8 MB images. Default is 1 MB, which would reject
  // most uploads before our own size check runs.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // public/frames (~163 MB of PNG masters) must NOT be traced into function
  // bundles. The bake reads frames through lib/render/card-frames.ts, which
  // fetches them from this deployment's own static CDN when they are not on
  // disk. Tracing them in put ~1.5 GB of functions into EVERY deployment
  // (save-time bake → nearly every page function) and blew Vercel's
  // Functions Storage quota. Fonts + watermarks (< 2 MB) stay traced.
  outputFileTracingExcludes: {
    "*": ["./public/frames/**"],
  },
  // Allow next/image to optimize user-uploaded card art + set covers from
  // our Supabase Storage origin (per-bucket, see SUPABASE_PUBLIC_BUCKETS).
  images: {
    // Every optimized source is content-addressed (`?v=` on baked renders,
    // random object names on uploads): a variant never changes under its
    // URL, so keep it for 31 days instead of re-writing it every few hours.
    // (Image Optimization cache writes sat at the plan quota.)
    minimumCacheTTL: 2678400,
    // Fewer candidate widths = fewer variants written per image. Card tiles
    // span 25–100vw; three device widths cover 1×/2× phones to desktop.
    deviceSizes: [640, 1080, 1920],
    imageSizes: [64, 128, 256, 384],
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

import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Pull the hostname out of NEXT_PUBLIC_SUPABASE_URL so we don't hard-code a
// project ref; this works locally and on every deploy without further config.
const supabaseHostname = (() => {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
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
  // our Supabase Storage origin. We currently render these with <img>
  // (Satori-compatible, no remote config pain) but configuring the
  // remotePattern here makes a future migration to <Image /> a one-line
  // swap.
  //
  // We scope to the three buckets we own explicitly instead of the broad
  // `/storage/v1/object/public/**`. If someone later creates a new public
  // bucket via Supabase Studio (outside the checked-in migrations), it
  // won't automatically become an allowed remote pattern.
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/card-art/**",
          },
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/card-exports/**",
          },
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/set-covers/**",
          },
        ]
      : [],
  },
};

export default nextConfig;

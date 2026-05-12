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
  // Allow next/image to optimize user-uploaded card art + set covers from
  // our Supabase Storage origin. We currently render these with <img>
  // (Satori-compatible, no remote config pain) but configuring the
  // remotePattern here makes a future migration to <Image /> a one-line
  // swap.
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;

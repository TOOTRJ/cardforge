import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand/constants";
import { siteConfig } from "@/lib/site-config";

// Web app manifest — browser metadata, not a PWA (no service worker).
// Gives "Add to Home Screen" the real name/icons instead of a fallback
// tile and sets mobile browser theme colors. Icons are generated into
// public/brand by scripts/generate-brand-assets.mjs.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: BRAND.navy,
    theme_color: BRAND.navy,
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

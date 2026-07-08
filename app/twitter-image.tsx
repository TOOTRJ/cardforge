import { ImageResponse } from "next/og";
import { OG_SIZE } from "@/lib/brand/constants";
import { HOME_OG_ALT, HomeOgCard } from "@/lib/og/home-card";

// Dedicated Twitter/X card (summary_large_image). Same body as the OG
// image today — a separate file so X-specific crops can be tuned without
// touching the OG art.

export const alt = HOME_OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";
export const runtime = "edge";

export default function TwitterImage() {
  return new ImageResponse(<HomeOgCard />, size);
}

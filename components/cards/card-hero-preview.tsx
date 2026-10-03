"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { FACE_PARAM, parseCardFace, type CardFace } from "@/lib/cards/card-face";

// ---------------------------------------------------------------------------
// The card page's hero — the live <CardPreview> with its corner flip — as a
// CLIENT island that opens on the face the URL names (TODO 5.3, design
// 2026-10-02 §3.4): `?face=back` shows a double-faced card flipped, so a
// link can open the back ("Front // Back" pages, share links to the other
// side). The query string is read HERE, with useSearchParams inside this
// component's own Suspense boundary — never by the server component that
// renders the page: the server HTML (the canonical, the OG image, the
// JSON-LD, the hero's markup) is the same for every `?face`, the query
// never varies a cache entry, and should the route ever go static again
// it would stay so. (The card route is server-rendered on demand today —
// the page reads the viewer's cookies for entitlements — on main before
// this island as after it: `next build` lists it ƒ either way.) The
// fallback is the same preview on the front, so nothing moves when the
// island hydrates.
//
// The flip itself is CardPreview's (the small corner button); a card with
// no back to flip to ignores the parameter. The URL is read once, on
// mount: flipping does not rewrite it.
// ---------------------------------------------------------------------------

type CardHeroPreviewProps = CardPreviewData & { className?: string };

function FaceFromUrl(props: CardHeroPreviewProps) {
  const params = useSearchParams();
  const [face, setFace] = useState<CardFace>(() => parseCardFace(params.get(FACE_PARAM)) ?? "front");
  return <CardPreview {...props} face={face} onFaceChange={setFace} />;
}

export function CardHeroPreview(props: CardHeroPreviewProps) {
  return (
    <Suspense fallback={<CardPreview {...props} />}>
      <FaceFromUrl {...props} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// /card/[username]/[slug] for SIGNED-IN visitors — the dynamic twin of the
// static card page (TODO CP2a). Reached only through the proxy.ts rewrite (a
// session cookie on a card URL); the visible URL stays /card/…, the
// canonical and every link point there, and a direct hit on this path 308s
// to it. The same module renders here with the viewer's session: their like,
// Follow, Edit, plan and an owner's private card.
// ---------------------------------------------------------------------------

export { default, generateMetadata, generateViewport } from "../../../card/[username]/[slug]/page";

export const dynamic = "force-dynamic";

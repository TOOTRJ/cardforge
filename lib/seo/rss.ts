// ---------------------------------------------------------------------------
// RSS helpers shared by the site's feeds (/articles/feed.xml, /news/feed.xml).
// ---------------------------------------------------------------------------

/** Escape text for an XML element or attribute value. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

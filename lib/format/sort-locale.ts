// ---------------------------------------------------------------------------
// The ONE collation for a list that is sorted in a component that hydrates
// (the deck page's rows, My Cards, a chart's names). `localeCompare` with no
// locale sorts by the RUNTIME's: English on the server, the reader's own in
// the browser — and a Swedish or German browser puts "Ä…" somewhere else, so
// the rows of the server's HTML and the browser's first render were in two
// orders: a hydration mismatch, and the list drawn twice. Named, it is the
// same order on both sides. Client-safe.
// ---------------------------------------------------------------------------

export const SORT_LOCALE = "en";

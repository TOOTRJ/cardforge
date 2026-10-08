// A testing-library text matcher for a sentence that spans elements — a
// date inside it is a <time> (components/ui/local-date.tsx), so `getByText`
// with a plain string no longer sees one text node. Matches the DEEPEST
// element whose whole text is (or matches) the sentence.
export function textContent(expected: string | RegExp) {
  const matches = (text: string | null | undefined) =>
    text != null && (typeof expected === "string" ? text === expected : expected.test(text));
  return (_content: string, element: Element | null): boolean =>
    element != null &&
    matches(element.textContent) &&
    Array.from(element.children).every((child) => !matches(child.textContent));
}

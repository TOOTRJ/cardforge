"use client";

// ---------------------------------------------------------------------------
// PipTextEditor — a rules-text box that DRAWS mana symbols instead of showing
// their brace codes. A plain <textarea> can only hold characters, so this is
// a contenteditable region whose DOM is: text nodes, <br> line breaks, and
// atomic (contenteditable=false) pip spans that each carry their code in
// `data-pip`. The form never sees the DOM — `value`/`onChange` are the same
// brace-code string a textarea would hold ("{T}: Add {G}."), so validation,
// the live preview, the bake and search all keep working untouched.
//
// Editing model
//   • Typing or pasting a known code ("{b}", "{2/W}") converts it to a pip
//     in place — the keyboard path still works for people who know it.
//   • The symbol toolbar calls `insertToken(code)` on the imperative handle,
//     which drops a pip at the caret (or the end when the box has no caret).
//   • Enter inserts a line break (never a <div>/<p>); paste and drop insert
//     plain text only; copy/cut put the brace-code text on the clipboard so
//     a pasted selection round-trips anywhere.
//   • A trailing line break needs a second, "filler" <br> to render as an
//     empty line (browser quirk); the filler is skipped when serialising.
//   • Every line break of ours carries `data-br`. A browser adds a <br> of
//     its own to keep a line open once its last character is deleted; that
//     one is unmarked, and at the end of the box it IS the filler — counted
//     as a break it gave the text a line nobody typed.
//   • Backspace / Delete with the caret against a pip remove it here, never
//     in the browser, and so do the two keys on a break a pip follows. To
//     Chrome a line that STARTS with a contenteditable=false node has no
//     caret place in front of it: Backspace did nothing behind a pip that
//     was all its line held ("Cc", Enter, "{t}"), Delete at the end of the
//     line above took the break AND the pip, and Home put the caret inside
//     the pip, where Delete did nothing.
//   • The same missing caret place, for typing: a character typed with the
//     caret inside a pip (where Home leaves it) went nowhere, and one typed
//     between a break and the pip behind it joined the line ABOVE — where
//     Chrome also DRAWS a caret set there, and a caret set at the pip's own
//     start types nothing at all. So the place is made: a pip a break
//     precedes has a "caret host" in front of it, a text node holding one
//     zero-width space. Typing there is the browser's own; the host is
//     never part of the value, is dropped as soon as it holds anything else
//     or no longer fronts such a pip, and ← / → step over it in one press.
//   • Deleting the text in front of a pip makes Chrome put an unmarked <br>
//     before the pip ("a{T}", Delete on the "a"). Anywhere but the end of
//     the box a <br> without `data-br` is the browser's and is removed —
//     read as a break it gave the text a line nobody typed.
//   • `value` changes from outside (AI patch, import, reset) re-render the
//     DOM; while focused the caret is restored at the same text offset.
// ---------------------------------------------------------------------------

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { INLINE_PIP_FONT_SIZE } from "@/components/cards/inline-pips";
import {
  canonicalPipCode,
  pipSuffixForCode,
  splitPipRuns,
} from "@/lib/cards/pip-runs";
import { cn } from "@/lib/utils";

export type PipTextEditorHandle = {
  focus: () => void;
  /** Insert a brace code ("{G}") as a pip at the caret. */
  insertToken: (code: string) => void;
};

type PipTextEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  /** Minimum visible lines, like a textarea's `rows`. */
  rows?: number;
  className?: string;
  id?: string;
  /** Form field name — exposed as `data-field` for tests and tooling. */
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

const PIP_ATTR = "data-pip";
const FILLER_ATTR = "data-filler";
const BREAK_ATTR = "data-br";
const CODE_PATTERN = /\{([^{}\s]{1,5})\}/g;
/** The caret host's one character (see the header): never part of the value. */
const CARET_HOST = "\u200B";

// ---------------------------------------------------------------------------
// DOM ↔ string
// ---------------------------------------------------------------------------

function makePipNode(code: string, suffix: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute(PIP_ATTR, code);
  span.contentEditable = "false";
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", code);
  span.title = code;
  span.className = "inline-block";
  const glyph = document.createElement("i");
  glyph.setAttribute("aria-hidden", "true");
  glyph.className = `ms ms-cost ms-shadow ms-${suffix}`;
  glyph.style.fontSize = INLINE_PIP_FONT_SIZE;
  glyph.style.margin = "0 0.06em";
  glyph.style.verticalAlign = "-0.08em";
  span.appendChild(glyph);
  return span;
}

/** A line break the editor made (see the header: the browser's are bare). */
function makeBreak(): HTMLBRElement {
  const br = document.createElement("br");
  br.setAttribute(BREAK_ATTR, "");
  return br;
}

function isFiller(node: Node | null | undefined): node is HTMLBRElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).tagName === "BR" &&
    (node as Element).hasAttribute(FILLER_ATTR)
  );
}

function isPlainBr(node: Node | null | undefined): node is HTMLBRElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).tagName === "BR" &&
    !(node as Element).hasAttribute(FILLER_ATTR)
  );
}

/** A text node's characters without the caret host's. */
function visibleText(node: Node): string {
  return (node.nodeValue ?? "").replaceAll(CARET_HOST, "");
}

function isPip(node: Node | null | undefined): node is HTMLElement {
  return (
    !!node && node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute(PIP_ATTR)
  );
}

function isCaretHost(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === Node.TEXT_NODE && node.nodeValue === CARET_HOST;
}

function serializePipDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return visibleText(node);
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const code = el.getAttribute(PIP_ATTR);
    if (code) return code;
    if (el.tagName === "BR") return el.hasAttribute(FILLER_ATTR) ? "" : "\n";
  }
  let out = "";
  node.childNodes.forEach((child) => {
    // Block wrappers a browser may sneak in (drag-drop of rich content)
    // read as line breaks so nothing runs together.
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      /^(DIV|P)$/.test((child as Element).tagName) &&
      child.previousSibling
    ) {
      out += "\n";
    }
    out += serializePipDom(child);
  });
  return out;
}

function renderValue(root: HTMLElement, value: string) {
  root.replaceChildren();
  for (const run of splitPipRuns(value)) {
    if (run.kind === "pip") {
      root.appendChild(makePipNode(run.code, run.suffix));
      continue;
    }
    const lines = run.value.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) root.appendChild(makeBreak());
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
  ensureFiller(root);
}

/**
 * Remove the <br>s a browser put anywhere but the end of the box (see the
 * header). The last one is ensureFiller's: it may be an emptied line's filler.
 */
function dropBrowserBreaks(root: HTMLElement) {
  Array.from(root.childNodes).forEach((child) => {
    if (child !== root.lastChild && isPlainBr(child) && !child.hasAttribute(BREAK_ATTR)) child.remove();
  });
}

/** Keep exactly one filler <br>, and only right after a trailing plain <br>. */
function ensureFiller(root: HTMLElement, composing = false) {
  // The browser's own placeholder for an emptied last line: the filler.
  const tail = root.lastChild;
  if (isPlainBr(tail) && !tail.hasAttribute(BREAK_ATTR)) tail.setAttribute(FILLER_ATTR, "");
  Array.from(root.childNodes).forEach((child) => {
    // Range.insertNode at the end of a text node SPLITS it and leaves an
    // empty text node behind the inserted <br>. That node hid the trailing
    // break from the check below — no filler, so the new line never opened
    // and the next characters were typed in front of the break (the first
    // Enter at the end of a text looked dropped).
    if (child.nodeType === Node.TEXT_NODE && !child.nodeValue) {
      child.remove();
      return;
    }
    if (isFiller(child) && (child !== root.lastChild || !isPlainBr(child.previousSibling))) {
      child.remove();
    }
  });
  const last = root.lastChild;
  if (isPlainBr(last)) {
    const filler = document.createElement("br");
    filler.setAttribute(FILLER_ATTR, "");
    root.appendChild(filler);
  }
  const hosts = ensureCaretHosts(root, composing);
  const sel = window.getSelection();
  if (!hosts.length || !sel || !sel.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return;
  // A deletion that emptied the text in front of a pip leaves Chrome's caret
  // at the end of the line ABOVE (the place had no caret yet): onto the host.
  const range = sel.getRangeAt(0);
  const next = besideCaret(root, range, "after");
  const front = sel.anchorNode === root ? root.childNodes[sel.anchorOffset] : null;
  const host = hosts.find((made) => made.previousSibling === next || made === front);
  if (host) placeCaret(host, host.length);
  // Set again once the hosts stand: Chrome reads a caret it was given before
  // a host appeared beside it as a place inside that host.
  else placeCaret(sel.anchorNode, sel.anchorOffset);
}

/**
 * Keep one caret host in front of every pip a break precedes, and its
 * character nowhere else (see the header). A text being composed is left
 * whole until the composition ends: rewriting it would end it early.
 * Returns the hosts it made.
 */
function ensureCaretHosts(root: HTMLElement, composing: boolean): Text[] {
  const fronts = (node: Node) => isPlainBr(node.previousSibling) && isPip(node.nextSibling);
  Array.from(root.childNodes).forEach((child) => {
    if (child.nodeType !== Node.TEXT_NODE || !child.nodeValue?.includes(CARET_HOST)) return;
    if ((isCaretHost(child) && fronts(child)) || composing) return;
    const text = visibleText(child);
    if (!text) {
      child.remove();
      return;
    }
    // The caret keeps its place among the characters that stay.
    const sel = window.getSelection();
    const at =
      sel && sel.isCollapsed && sel.anchorNode === child
        ? child.nodeValue.slice(0, sel.anchorOffset).replaceAll(CARET_HOST, "").length
        : null;
    child.nodeValue = text;
    if (at != null) placeCaret(child, at);
  });
  const made: Text[] = [];
  Array.from(root.childNodes).forEach((child) => {
    if (isPip(child) && isPlainBr(child.previousSibling)) {
      made.push(root.insertBefore(document.createTextNode(CARET_HOST), child));
    }
  });
  return made;
}

/** The next sibling on one side that is not a text node with nothing to read (empty, or a caret host). */
function siblingOf(node: Node, side: "before" | "after"): Node | null {
  let next = side === "before" ? node.previousSibling : node.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !visibleText(next)) {
    next = side === "before" ? next.previousSibling : next.nextSibling;
  }
  return next;
}

function caretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return serializePipDom(before.cloneContents()).length;
}

function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function setCaret(root: HTMLElement, offset: number) {
  let remaining = Math.max(0, offset);
  const children = Array.from(root.childNodes);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isFiller(child)) {
      placeCaret(root, i);
      return;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      const raw = child.nodeValue ?? "";
      const len = visibleText(child).length;
      if (remaining <= len) {
        // Past the caret host's character: in a host, the place beside the pip.
        let at = 0;
        for (let seen = 0; at < raw.length && (raw[at] === CARET_HOST || seen < remaining); at++) {
          if (raw[at] !== CARET_HOST) seen++;
        }
        placeCaret(child, at);
        return;
      }
      remaining -= len;
      continue;
    }
    const len = serializePipDom(child).length;
    if (remaining < len) {
      placeCaret(root, i);
      return;
    }
    remaining -= len;
  }
  placeCaret(root, children.length);
}

/** Turn "{g}"-style codes typed into text nodes into pip nodes, in place. */
function convertTypedCodes(root: HTMLElement): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  let changed = false;
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    if (!text.includes("{")) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let any = false;
    for (const match of text.matchAll(CODE_PATTERN)) {
      const code = canonicalPipCode(match[1]);
      const suffix = code ? pipSuffixForCode(code) : null;
      if (!code || !suffix) continue;
      const index = match.index ?? 0;
      if (index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, index)));
      frag.appendChild(makePipNode(code, suffix));
      cursor = index + match[0].length;
      any = true;
    }
    if (!any) continue;
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
    changed = true;
  }
  return changed;
}

/**
 * What a collapsed caret touches on one side: the sibling there, null at the
 * box's edge, undefined when it is a character (or the caret is nowhere we
 * know). A caret INSIDE a pip — Home on a line a pip starts leaves Chrome's
 * there — reads as the place in front of that pip.
 */
function besideCaret(
  root: HTMLElement,
  range: Range,
  side: "before" | "after",
): Node | null | undefined {
  if (!range.collapsed) return undefined;
  let container: Node = range.startContainer;
  let offset = range.startOffset;
  const inside = pipHolding(root, container);
  if (inside) {
    offset = Array.prototype.indexOf.call(root.childNodes, inside) + (offset === 0 ? 0 : 1);
    container = root;
  }
  if (container === root) {
    const node = root.childNodes[side === "before" ? offset - 1 : offset] ?? null;
    return node && node.nodeType === Node.TEXT_NODE && !visibleText(node) ? siblingOf(node, side) : node;
  }
  if (container.nodeType === Node.TEXT_NODE && container.parentNode === root) {
    // Anywhere in a caret host is both of its edges.
    const raw = container.nodeValue ?? "";
    const rest = side === "before" ? raw.slice(0, offset) : raw.slice(offset);
    return rest.replaceAll(CARET_HOST, "") ? undefined : siblingOf(container, side);
  }
  return undefined;
}

/** The pip of this box a node is, or is inside. */
function pipHolding(root: HTMLElement, node: Node): HTMLElement | null {
  const holder = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const pip = holder?.closest<HTMLElement>(`[${PIP_ATTR}]`);
  return pip && pip.parentNode === root ? pip : null;
}

/**
 * The node Backspace ("before") or Delete ("after") removes HERE rather than
 * in the browser, for a collapsed caret: the pip it touches on that side, or
 * a break of ours that a pip follows. Null for anything else — characters
 * and every other break are the browser's.
 */
function deletionTarget(
  root: HTMLElement,
  range: Range,
  side: "before" | "after",
): HTMLElement | null {
  const node = besideCaret(root, range, side);
  if (isPip(node)) return node;
  return isPlainBr(node) && node.hasAttribute(BREAK_ATTR) && isPip(siblingOf(node, "after")) ? node : null;
}

/**
 * Where ← / → put a caret that stands in a caret host: out of it in one
 * press, as if the host were not there. Null = the browser's.
 */
function arrowTarget(
  root: HTMLElement,
  range: Range,
  key: "ArrowLeft" | "ArrowRight",
): { node: Node; side: "before" | "after" } | null {
  const host = range.startContainer;
  if (!range.collapsed || !isCaretHost(host) || host.parentNode !== root) return null;
  const node = key === "ArrowLeft" ? host.previousSibling : host.nextSibling;
  return node ? { node, side: key === "ArrowLeft" ? "before" : "after" } : null;
}

/** The caret right before or right after a child of the box, in the text beside it if any. */
function placeCaretBeside(root: HTMLElement, node: Node, side: "before" | "after") {
  const text = side === "before" ? node.previousSibling : node.nextSibling;
  if (text && text.nodeType === Node.TEXT_NODE) {
    placeCaret(text, side === "before" ? (text.nodeValue?.length ?? 0) : 0);
    return;
  }
  placeCaret(root, Array.prototype.indexOf.call(root.childNodes, node) + (side === "before" ? 0 : 1));
}

/**
 * A caret Chrome left inside a pip (a click on one lands in its glyph, where
 * typing is not even announced): back to the place beside the pip.
 */
function liftCaretOutOfPip(root: HTMLElement) {
  const range = selectionInside(root);
  const pip = range?.collapsed ? pipHolding(root, range.startContainer) : null;
  if (pip) placeCaretBeside(root, pip, range!.startOffset === 0 ? "before" : "after");
}

function selectionInside(root: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PipTextEditor = forwardRef<PipTextEditorHandle, PipTextEditorProps>(
  function PipTextEditor(
    {
      value,
      onChange,
      onBlur,
      onFocus,
      placeholder,
      rows = 4,
      className,
      id,
      name,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      "aria-describedby": ariaDescribedBy,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    // The last string the DOM was known to equal — either the prop we last
    // rendered or the value we last emitted — so fast edits between renders
    // never compare against a stale prop.
    const latestRef = useRef(value);
    const composingRef = useRef(false);

    // Normalise the DOM after any edit and tell the form what it reads as.
    const commit = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      // A fully emptied box is left holding a lone <br> by some browsers —
      // clear it so the placeholder shows and the value is truly "".
      if (root.childNodes.length === 1 && isPlainBr(root.firstChild) && !root.firstChild.hasAttribute(BREAK_ATTR)) {
        root.replaceChildren();
      }
      dropBrowserBreaks(root);
      const offset = caretOffset(root);
      const converted = convertTypedCodes(root);
      ensureFiller(root, composingRef.current);
      if (converted && offset != null) setCaret(root, offset);
      const next = serializePipDom(root);
      if (next !== latestRef.current) {
        latestRef.current = next;
        onChangeRef.current(next);
      }
    }, []);

    // Insert nodes at the caret (replacing any selection), caret after them.
    const insertNodes = useCallback((nodes: Node[]) => {
      const root = rootRef.current;
      if (!root || nodes.length === 0) return;
      let range = selectionInside(root);
      if (!range) {
        root.focus();
        setCaret(root, serializePipDom(root).length);
        range = selectionInside(root);
        if (!range) return;
      }
      range.deleteContents();
      // Never land inside a pip span: bump the range out to its parent — in
      // front of the pip for a caret at its start (Home leaves Chrome's there).
      const pip = pipHolding(root, range.startContainer);
      if (pip) {
        if (range.startOffset === 0) range.setStartBefore(pip);
        else range.setStartAfter(pip);
        range.collapse(true);
      }
      let last: Node | null = null;
      for (const node of nodes) {
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        last = node;
      }
      if (last) {
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(after);
      }
      commit();
    }, [commit]);

    const insertPlainText = useCallback(
      (text: string) => {
        const nodes: Node[] = [];
        text.split("\n").forEach((line, i) => {
          if (i > 0) nodes.push(makeBreak());
          if (line) nodes.push(document.createTextNode(line));
        });
        insertNodes(nodes);
      },
      [insertNodes],
    );

    // Backspace / Delete on a pip or on the break in front of one (see the
    // header). False when the caret is against neither — the browser's.
    const deleteBesideCaret = useCallback(
      (side: "before" | "after"): boolean => {
        const root = rootRef.current;
        const range = root ? selectionInside(root) : null;
        const target = root && range ? deletionTarget(root, range, side) : null;
        if (!root || !target) return false;
        // Whichever side it was on, the caret belongs where the node stood.
        const index = Array.prototype.indexOf.call(root.childNodes, target);
        target.remove();
        placeCaret(root, index);
        const offset = caretOffset(root) ?? 0;
        // The filler first: the caret of an emptied last line sits on it.
        ensureFiller(root);
        setCaret(root, offset);
        commit();
        return true;
      },
      [commit],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => rootRef.current?.focus(),
        insertToken: (code: string) => {
          const canonical = canonicalPipCode(code.replace(/[{}]/g, ""));
          const suffix = canonical ? pipSuffixForCode(canonical) : null;
          if (canonical && suffix) insertNodes([makePipNode(canonical, suffix)]);
          else insertPlainText(code);
        },
      }),
      [insertNodes, insertPlainText],
    );

    // Line breaks that arrive as input events rather than an Enter keydown
    // (virtual keyboards, automation, some IMEs) — React has no typed
    // beforeinput, so listen natively. Multi-line text inserts (a `fill`
    // from a test runner, some paste paths) go through the plain-text path
    // so "\n" becomes a <br> instead of a bare newline character.
    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const onBeforeInput = (event: InputEvent) => {
        if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
          event.preventDefault();
          insertNodes([makeBreak()]);
        } else if (event.inputType === "insertText" && event.data?.includes("\n")) {
          event.preventDefault();
          insertPlainText(event.data);
        }
      };
      root.addEventListener("beforeinput", onBeforeInput);
      return () => root.removeEventListener("beforeinput", onBeforeInput);
    }, [insertNodes, insertPlainText]);

    // selectionchange is announced a task late; the click and the next key
    // (below) lift the caret themselves so a fast key is never lost.
    useEffect(() => {
      const onSelectionChange = () => {
        if (rootRef.current) liftCaretOutOfPip(rootRef.current);
      };
      document.addEventListener("selectionchange", onSelectionChange);
      return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, []);

    // Outside value → DOM (initial mount, AI patch, import, reset).
    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      latestRef.current = value;
      if (serializePipDom(root) === value) return;
      const focused = document.activeElement === root;
      const offset = focused ? caretOffset(root) : null;
      renderValue(root, value);
      if (focused) setCaret(root, Math.min(offset ?? value.length, value.length));
    }, [value]);

    return (
      <div
        ref={rootRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-placeholder={placeholder}
        data-field={name}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className={cn(
          "min-h-0 cursor-text whitespace-pre-wrap break-words",
          "empty:before:pointer-events-none empty:before:text-subtle empty:before:content-[attr(data-placeholder)]",
          className,
        )}
        style={{ minHeight: `calc(${rows} * 1.25rem + 1rem + 2px)` }}
        onInput={commit}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={onBlur}
        onFocus={onFocus}
        onClick={() => {
          if (rootRef.current) liftCaretOutOfPip(rootRef.current);
        }}
        onKeyDown={(event) => {
          if (rootRef.current) liftCaretOutOfPip(rootRef.current);
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            insertNodes([makeBreak()]);
            return;
          }
          // Cmd+Backspace / Cmd+Delete clear to the line's edge: the browser's.
          if (event.nativeEvent.isComposing || event.metaKey) return;
          if (event.key === "Backspace" && deleteBesideCaret("before")) event.preventDefault();
          else if (event.key === "Delete" && deleteBesideCaret("after")) event.preventDefault();
          else if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey
          ) {
            // ← / → out of a caret host (see the header).
            const root = rootRef.current;
            const range = root ? selectionInside(root) : null;
            const target = root && range ? arrowTarget(root, range, event.key) : null;
            if (!root || !target) return;
            event.preventDefault();
            placeCaretBeside(root, target.node, target.side);
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          insertPlainText(event.clipboardData.getData("text/plain"));
        }}
        onDrop={(event) => {
          event.preventDefault();
          const text = event.dataTransfer.getData("text/plain");
          if (text) insertPlainText(text);
        }}
        onCopy={(event) => {
          const root = rootRef.current;
          const range = root ? selectionInside(root) : null;
          if (!range || range.collapsed) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", serializePipDom(range.cloneContents()));
        }}
        onCut={(event) => {
          const root = rootRef.current;
          const range = root ? selectionInside(root) : null;
          if (!range || range.collapsed) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", serializePipDom(range.cloneContents()));
          range.deleteContents();
          commit();
        }}
      />
    );
  },
);

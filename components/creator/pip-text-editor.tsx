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
const CODE_PATTERN = /\{([^{}\s]{1,5})\}/g;

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

export function serializePipDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
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
      if (i > 0) root.appendChild(document.createElement("br"));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
  ensureFiller(root);
}

/** Keep exactly one filler <br>, and only right after a trailing plain <br>. */
function ensureFiller(root: HTMLElement) {
  Array.from(root.childNodes).forEach((child) => {
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
      const len = child.nodeValue?.length ?? 0;
      if (remaining <= len) {
        placeCaret(child, remaining);
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

    // Normalise the DOM after any edit and tell the form what it reads as.
    const commit = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      // A fully emptied box is left holding a lone <br> by some browsers —
      // clear it so the placeholder shows and the value is truly "".
      if (root.childNodes.length === 1 && root.firstChild && (root.firstChild as Element).tagName === "BR") {
        root.replaceChildren();
      }
      const offset = caretOffset(root);
      if (convertTypedCodes(root) && offset != null) setCaret(root, offset);
      ensureFiller(root);
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
      // Never land inside a pip span: bump the range out to its parent.
      let container = range.startContainer;
      if (container.nodeType === Node.ELEMENT_NODE && (container as Element).closest(`[${PIP_ATTR}]`)) {
        const pip = (container as Element).closest(`[${PIP_ATTR}]`)!;
        range.setStartAfter(pip);
        range.collapse(true);
        container = range.startContainer;
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
          if (i > 0) nodes.push(document.createElement("br"));
          if (line) nodes.push(document.createTextNode(line));
        });
        insertNodes(nodes);
      },
      [insertNodes],
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
          insertNodes([document.createElement("br")]);
        } else if (event.inputType === "insertText" && event.data?.includes("\n")) {
          event.preventDefault();
          insertPlainText(event.data);
        }
      };
      root.addEventListener("beforeinput", onBeforeInput);
      return () => root.removeEventListener("beforeinput", onBeforeInput);
    }, [insertNodes, insertPlainText]);

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
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            insertNodes([document.createElement("br")]);
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

import { createElement, useSyncExternalStore, type ComponentType } from "react";

// ---------------------------------------------------------------------------
// `next/dynamic` under vitest (aliased in vitest.config.ts). Next's own loads
// the chunk when the component first renders and suspends until it is in —
// a unit test would see an empty place and assert on it. Here the module is
// imported at once, when `dynamic()` is called (the importing module's own
// evaluation, before any test renders), and the component draws it as soon
// as it is in; `dynamicReady()` waits for every one. A test that needs its
// own stand-in still `vi.mock("next/dynamic")`s it.
// ---------------------------------------------------------------------------

type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

const pending: Array<Promise<unknown>> = [];

/** Resolves once every component asked for so far is loaded. */
export function dynamicReady(): Promise<unknown> {
  return Promise.all(pending);
}

export default function dynamic<P extends object>(loader: () => Promise<Loaded<P>>): ComponentType<P> {
  let component: ComponentType<P> | null = null;
  const listeners = new Set<() => void>();
  pending.push(
    loader().then((mod) => {
      component = typeof mod === "object" && mod !== null && "default" in mod ? mod.default : (mod as ComponentType<P>);
      for (const listener of listeners) listener();
    }),
  );
  function DynamicStub(props: P) {
    const Component = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => component,
      () => component,
    );
    return Component ? createElement(Component, props) : null;
  }
  return DynamicStub;
}

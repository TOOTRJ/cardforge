"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tabs — a minimal accessible tablist primitive.
//
// Why not Radix Tabs: we don't already have @radix-ui/react-tabs (the
// project deliberately keeps its dependency graph small for Phase 9). This
// 80-line component covers everything the card editor needs: controlled +
// uncontrolled value, keyboard arrow navigation, Home/End shortcuts, an
// activation model that switches on focus (the "automatic activation"
// pattern from the WAI-ARIA Tabs spec), and the standard
// role/aria-selected/aria-controls wiring.
//
// API:
//   <Tabs defaultValue="identity">
//     <TabsList>
//       <TabsTrigger value="identity">Identity</TabsTrigger>
//       ...
//     </TabsList>
//     <TabsContent value="identity">…panel…</TabsContent>
//     ...
//   </Tabs>
// ---------------------------------------------------------------------------

type TabsContextValue = {
  value: string;
  baseId: string;
  setValue: (next: string) => void;
  registerTrigger: (value: string, element: HTMLButtonElement | null) => void;
  triggerOrder: () => string[];
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(scope: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`${scope} must be used inside <Tabs>`);
  }
  return ctx;
}

type TabsProps = {
  /** Uncontrolled — used when `value` isn't provided. */
  defaultValue?: string;
  /** Controlled value. */
  value?: string;
  onValueChange?: (next: string) => void;
  className?: string;
  children: ReactNode;
};

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const baseId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;
  // Triggers register themselves on mount so we can drive keyboard nav by
  // DOM order. Using a Map keeps duplicates from leaking.
  const triggersRef = useRef(new Map<string, HTMLButtonElement>());

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const registerTrigger = useCallback(
    (triggerValue: string, element: HTMLButtonElement | null) => {
      if (element) {
        triggersRef.current.set(triggerValue, element);
      } else {
        triggersRef.current.delete(triggerValue);
      }
    },
    [],
  );

  const triggerOrder = useCallback(() => {
    return Array.from(triggersRef.current.keys());
  }, []);

  return (
    <TabsContext.Provider
      value={{ value, baseId, setValue, registerTrigger, triggerOrder }}
    >
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabsListProps = {
  className?: string;
  children: ReactNode;
  /** Optional aria-label for the tablist. */
  ariaLabel?: string;
};

export function TabsList({ className, children, ariaLabel }: TabsListProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-elevated/40 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

type TabsTriggerProps = {
  value: string;
  className?: string;
  children: ReactNode;
  /** Optional badge to show next to the label (e.g. dirty-state dot). */
  badge?: ReactNode;
};

export function TabsTrigger({
  value: triggerValue,
  className,
  children,
  badge,
}: TabsTriggerProps) {
  const { value, baseId, setValue, registerTrigger, triggerOrder } =
    useTabsContext("TabsTrigger");
  const active = value === triggerValue;

  // Keyboard nav: left/right cycle, Home/End jump to ends. Activation
  // follows focus (automatic activation), matching the conventional Tabs
  // pattern used by Radix and shadcn.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const order = triggerOrder();
    if (order.length === 0) return;
    let nextValue: string | null = null;
    const i = order.indexOf(triggerValue);
    if (event.key === "ArrowRight") {
      nextValue = order[(i + 1) % order.length];
    } else if (event.key === "ArrowLeft") {
      nextValue = order[(i - 1 + order.length) % order.length];
    } else if (event.key === "Home") {
      nextValue = order[0];
    } else if (event.key === "End") {
      nextValue = order[order.length - 1];
    }
    if (nextValue) {
      event.preventDefault();
      setValue(nextValue);
      // Focus the new trigger so screen readers narrate the change.
      const target = document.getElementById(
        `${baseId}-trigger-${nextValue}`,
      ) as HTMLButtonElement | null;
      target?.focus();
    }
  };

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-trigger-${triggerValue}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${triggerValue}`}
      tabIndex={active ? 0 : -1}
      ref={(el) => registerTrigger(triggerValue, el)}
      onClick={() => setValue(triggerValue)}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        active
          ? "bg-surface text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_4px_rgba(0,0,0,0.25)]"
          : "text-subtle hover:text-foreground",
        className,
      )}
    >
      {children}
      {badge ? <span aria-hidden>{badge}</span> : null}
    </button>
  );
}

type TabsContentProps = {
  value: string;
  className?: string;
  children: ReactNode;
};

export function TabsContent({ value: panelValue, className, children }: TabsContentProps) {
  const { value, baseId } = useTabsContext("TabsContent");
  const active = value === panelValue;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${panelValue}`}
      aria-labelledby={`${baseId}-trigger-${panelValue}`}
      hidden={!active}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {active ? children : null}
    </div>
  );
}

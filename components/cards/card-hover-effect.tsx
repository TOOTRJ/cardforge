"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardHoverEffect — wraps a CardPreview (or any rectangular child) with a
// 3D tilt that tracks the pointer + a specular highlight overlay. Pure
// CSS-variable driven so React never re-renders during a hover.
//
// Disabled automatically on:
//   - touch devices (no `(hover: hover) and (pointer: fine)` media match)
//   - users with `prefers-reduced-motion: reduce`
//
// When disabled, the component renders as a plain pass-through `<div>` so
// the bounding box still matches what the gallery layout expects.
//
// Wrapping pattern used across the gallery / dashboard / profile / set:
//   <Link href={...}>
//     <CardHoverEffect>
//       <CardPreview ... />
//     </CardHoverEffect>
//   </Link>
// ---------------------------------------------------------------------------

type CardHoverEffectProps = {
  children: ReactNode;
  /** Max tilt magnitude in degrees. Defaults to 8 — enough to read as
   *  "3D" without making the corners feel detached from the page. */
  tilt?: number;
  className?: string;
};

export function CardHoverEffect({
  children,
  tilt = 8,
  className,
}: CardHoverEffectProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Detect capability + accessibility preferences at mount. Re-run on
  // change so users who flip "Reduce motion" mid-session take effect
  // without a refresh.
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setEnabled(finePointer.matches && !noMotion.matches);
    apply();
    finePointer.addEventListener("change", apply);
    noMotion.addEventListener("change", apply);
    return () => {
      finePointer.removeEventListener("change", apply);
      noMotion.removeEventListener("change", apply);
    };
  }, []);

  // Touch + reduced-motion path: render a plain wrapper so the gallery's
  // grid math (which assumes a single child per cell) still works.
  if (!enabled) {
    return <div className={cn("card-hover-effect", className)}>{children}</div>;
  }

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // Normalize pointer to 0..1 inside the card. Clamp so a fast drag
    // through the corner doesn't ping the tilt past its target.
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    // Tilt INTO the cursor: pointer near the top → top of card lifts
    // toward the viewer (negative rotateX from origin). Pointer near the
    // right → right of card lifts (positive rotateY).
    const rx = (0.5 - y) * tilt * 2;
    const ry = (x - 0.5) * tilt * 2;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      // Direct DOM mutation. We never call setState during pointer move,
      // so React doesn't re-render and the perf cost is one rAF write.
      node.style.setProperty("--card-rx", `${rx.toFixed(2)}deg`);
      node.style.setProperty("--card-ry", `${ry.toFixed(2)}deg`);
      node.style.setProperty("--card-gx", `${(x * 100).toFixed(1)}%`);
      node.style.setProperty("--card-gy", `${(y * 100).toFixed(1)}%`);
      node.style.setProperty("--card-active", "1");
    });
  };

  const handleLeave = () => {
    const node = ref.current;
    if (!node) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    // Reset everything; the 300ms CSS transition handles the ease back.
    node.style.setProperty("--card-rx", "0deg");
    node.style.setProperty("--card-ry", "0deg");
    node.style.setProperty("--card-active", "0");
  };

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cn("card-hover-effect card-hover-effect-active", className)}
    >
      <div className="card-hover-rotor">
        {children}
        <span aria-hidden className="card-hover-glare" />
      </div>
    </div>
  );
}

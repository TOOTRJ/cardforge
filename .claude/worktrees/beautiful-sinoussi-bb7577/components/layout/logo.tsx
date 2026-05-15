import Link from "next/link";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  href?: string;
  showWordmark?: boolean;
};

export function Logo({ className, href = "/", showWordmark = true }: LogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-2.5 font-semibold tracking-tight",
        className,
      )}
      aria-label="CardForge home"
    >
      <span
        aria-hidden
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-primary to-accent shadow-[0_0_24px_-8px_var(--color-primary)] transition-transform group-hover:scale-105"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-primary-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 4h14l-2 6 2 10H5l2-10z" />
          <path d="M9 10h6" />
        </svg>
      </span>
      {showWordmark ? (
        <span className="font-display text-lg leading-none tracking-wider text-foreground">
          CardForge
        </span>
      ) : null}
    </Link>
  );
}

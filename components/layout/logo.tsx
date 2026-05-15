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
      aria-label="Spellwright home"
    >
      {/* Pentagon icon mark — evokes the 5-color wheel, quill nib at center */}
      <span
        aria-hidden
        className="relative inline-flex h-8 w-8 items-center justify-center transition-transform group-hover:scale-105"
      >
        <svg
          viewBox="0 0 32 32"
          className="h-8 w-8 drop-shadow-[0_0_10px_rgba(200,168,75,0.55)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Gold gradient for the pentagon fill */}
            <linearGradient id="sw-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#e8c96b" />
              <stop offset="100%" stopColor="#a07828" />
            </linearGradient>
            {/* Subtle WUBRG 5-color stroke around the edges */}
            <linearGradient id="sw-wubrg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#f9faf9" />
              <stop offset="25%"  stopColor="#4a90d9" />
              <stop offset="50%"  stopColor="#9b72cf" />
              <stop offset="75%"  stopColor="#e05252" />
              <stop offset="100%" stopColor="#4caf72" />
            </linearGradient>
          </defs>
          {/* Pentagon background — 5 points, flat-top orientation */}
          <polygon
            points="16,2 29,11 24,27 8,27 3,11"
            fill="#1a1420"
            stroke="url(#sw-wubrg)"
            strokeWidth="1.5"
          />
          {/* Quill nib — S-shaped quill tip forming the mark */}
          {/* Quill barrel */}
          <line x1="16" y1="7" x2="16" y2="22" stroke="url(#sw-gold)" strokeWidth="1.4" strokeLinecap="round" />
          {/* Quill tip — left nib */}
          <path d="M16 22 L11 19" stroke="url(#sw-gold)" strokeWidth="1.3" strokeLinecap="round" />
          {/* Quill tip — right nib */}
          <path d="M16 22 L21 19" stroke="url(#sw-gold)" strokeWidth="1.3" strokeLinecap="round" />
          {/* Quill vane — left */}
          <path d="M16 9 Q10 12 12 17" stroke="url(#sw-gold)" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.75" />
          {/* Quill vane — right */}
          <path d="M16 9 Q22 12 20 17" stroke="url(#sw-gold)" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.75" />
        </svg>
      </span>

      {showWordmark ? (
        <span className="font-display text-lg leading-none tracking-wider text-foreground">
          Spellwright
        </span>
      ) : null}
    </Link>
  );
}

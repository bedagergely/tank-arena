import { Pumpkin } from "./Pumpkin.tsx";

/** A drifting bat silhouette. */
function Bat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 32" className={className} aria-hidden="true" focusable="false">
      <path
        d="M2 16c8-1 10-10 14-10 3 0 3 6 6 6s4-8 8-8 5 8 8 8 4-6 7-6c4 0 6 9 14 10-8 2-10 9-14 9-3 0-3-6-6-6s-4 8-8 8-5-8-8-8-4 6-7 6c-4 0-6-7-14-9z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Fixed, non-interactive Halloween backdrop: a hazy moon, floating pumpkins,
 * drifting bats and rising embers. Sits behind the app content (which uses z-10).
 */
export function SpookyBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 select-none overflow-hidden">
      {/* hazy moon */}
      <div className="absolute -top-16 right-[8%] h-48 w-48 rounded-full bg-[#f6e7c1] opacity-[0.10] blur-[1px] shadow-[0_0_120px_60px_rgba(246,231,193,0.10)]" />

      {/* floating pumpkins along the edges */}
      <Pumpkin className="absolute -left-6 top-1/4 h-40 w-40 opacity-20 animate-float-slow" />
      <Pumpkin className="absolute -right-10 bottom-[12%] h-56 w-56 opacity-15 animate-float" />
      <Pumpkin className="absolute left-[14%] bottom-[6%] h-24 w-24 opacity-25 animate-float-slow" />
      <Pumpkin className="absolute right-[22%] top-[10%] h-16 w-16 opacity-20 animate-float" />

      {/* bats */}
      <Bat className="absolute left-[28%] top-[18%] h-5 w-10 text-secondary/40 animate-drift" />
      <Bat className="absolute right-[30%] top-[34%] h-4 w-8 text-secondary/30 animate-drift [animation-delay:-12s]" />
      <Bat className="absolute left-[60%] top-[8%] h-6 w-12 text-secondary/25 animate-drift [animation-delay:-25s]" />

      {/* rising embers */}
      {[
        { left: "18%", delay: "0s" },
        { left: "42%", delay: "-3s" },
        { left: "67%", delay: "-6s" },
        { left: "86%", delay: "-1.5s" },
      ].map((s) => (
        <span
          key={s.left}
          style={{ left: s.left, animationDelay: s.delay }}
          className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-primary/60 blur-[1px] animate-rise"
        />
      ))}

      {/* low fog */}
      <div className="absolute -left-[10%] bottom-0 h-40 w-[120%] bg-gradient-to-t from-secondary/10 to-transparent blur-2xl animate-drift" />
    </div>
  );
}

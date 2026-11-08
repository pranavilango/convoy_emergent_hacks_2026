import { cn } from "@/lib/utils";

/**
 * The Convoy logo mark: a trapezium body, wide at the top, on two wheels, all in white. Drawn on
 * a 32×24 grid. The browser-tab icon (src/app/icon.svg) is the same drawing in navy with a thin
 * black outline.
 */
export function ConvoyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      aria-hidden
      className={cn("aspect-[4/3] h-4 w-auto shrink-0 fill-white stroke-white", className)}
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d="M2 2.5H30L26.5 14.5H5.5Z" />
      <circle cx="10" cy="18.85" r="2.6" />
      <circle cx="22" cy="18.85" r="2.6" />
    </svg>
  );
}

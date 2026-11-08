import { cn } from "@/lib/utils";

/**
 * The Convoy logo mark: a trapezium body, wide at the top, on two wheels, all in the brand accent. Drawn on
 * a 32×24 grid; src/app/icon.svg is the same drawing on a black tile for the browser tab.
 */
export function ConvoyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      aria-hidden
      className={cn("aspect-[4/3] h-4 w-auto shrink-0 fill-brand stroke-brand", className)}
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d="M2 2.5H30L26.5 14.5H5.5Z" />
      <circle cx="10" cy="18.85" r="2.6" />
      <circle cx="22" cy="18.85" r="2.6" />
    </svg>
  );
}

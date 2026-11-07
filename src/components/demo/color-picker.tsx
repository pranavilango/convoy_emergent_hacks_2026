"use client";

import { useRef, type KeyboardEvent } from "react";

import { TYPE_COLORS } from "@/lib/demo/colors";
import { cn } from "@/lib/utils";

/** Radio group of color swatches with roving focus (arrow keys move and select). */
export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    TYPE_COLORS.findIndex((c) => c.value === value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (current + delta + TYPE_COLORS.length) % TYPE_COLORS.length;
    const color = TYPE_COLORS[next];
    if (color) {
      onChange(color.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-2"
    >
      {TYPE_COLORS.map((color, i) => {
        const checked = i === current;
        return (
          <button
            key={color.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={color.name}
            title={color.name}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(color.value)}
            className={cn(
              "h-6 w-6 rounded-sm border border-foreground transition-transform outline-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
              checked && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: color.value }}
          />
        );
      })}
    </div>
  );
}

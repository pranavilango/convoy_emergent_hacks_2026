"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { focusRing, Swatch } from "./controls";

export type SelectOption = { value: string; label: string; color?: string };

/**
 * Single-select listbox styled like the rest of the site (native <select> menus can't be
 * styled). Implements the WAI-ARIA "select-only combobox" keyboard model: arrows, Home/End,
 * Enter/Space, Escape, Tab, and first-letter typeahead.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "Choose…",
  hideLabel = false,
  className,
}: {
  label: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function openList() {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    close(true);
  }

  // Focus the list when it opens so it receives keyboard events.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Keep the active option visible.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, last));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        setOpen(false);
        return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const key = event.key.toLowerCase();
      const start = activeIndex + 1;
      const order = [...options.slice(start), ...options.slice(0, start)];
      const match = order.find((o) => o.label.toLowerCase().startsWith(key));
      if (match) setActiveIndex(options.indexOf(match));
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <span
        id={labelId}
        className={cn(
          "block font-mono text-[11px] uppercase tracking-wider opacity-70",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={cn(
          "flex w-full items-center justify-between gap-3 border-b border-foreground py-2 text-left text-base disabled:opacity-50",
          focusRing,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.color && <Swatch color={selected.color} />}
          <span className={cn("truncate", !selected && "text-foreground/50")}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <span
          aria-hidden
          className={cn("font-mono text-xs transition-transform", open && "rotate-180")}
        >
          ↓
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optionId(activeIndex)}
          onKeyDown={onListKeyDown}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-sm bg-ink py-1 text-ink-foreground shadow-lg outline-none"
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActiveIndex(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
                  i === activeIndex && "bg-ink-foreground/10",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.color && (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
                {isSelected && (
                  <span aria-hidden className="font-mono text-xs">
                    ↘
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

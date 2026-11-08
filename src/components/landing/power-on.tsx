"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Text that flickers on, like a light on a weak grid, the first time it scrolls into view.
 * Without JavaScript (or without IntersectionObserver) it's simply shown. See `.power-on-view`
 * in globals.css.
 */
export function PowerOn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    el.dataset["armed"] = "";
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset["on"] = "";
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={cn("power-on-view", className)}>
      {children}
    </span>
  );
}

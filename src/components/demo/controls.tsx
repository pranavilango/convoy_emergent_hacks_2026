import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Visual vocabulary borrowed from the landing page: mono uppercase labels, hairline rules,
 *  near-square corners, solid foreground buttons. */

export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function SectionLabel({
  index,
  children,
  aside,
}: {
  index: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-wider">
      <span>
        _{index} {children}
      </span>
      {aside !== undefined && <span className="opacity-70">{aside}</span>}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  id,
  children,
}: {
  htmlFor?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      className="block font-mono text-[11px] uppercase tracking-wider opacity-70"
    >
      {children}
    </label>
  );
}

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:opacity-85",
  outline: "border border-foreground hover:bg-foreground hover:text-background",
  ghost: "underline-offset-4 hover:underline",
  danger: "border border-foreground bg-ink text-ink-foreground hover:opacity-85",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm transition-[opacity,background-color,color] disabled:pointer-events-none disabled:opacity-40",
        size === "md"
          ? "px-4 py-2 text-sm"
          : "px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider",
        variant === "ghost" && "px-0 py-0",
        buttonVariants[variant],
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-none border-0 border-b border-foreground bg-transparent px-0 py-2 text-base placeholder:text-foreground/50 disabled:opacity-50",
        // Thicken the underline on focus without shifting layout.
        "outline-none focus-visible:shadow-[0_1px_0_0_var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** A small row of mutually exclusive toggle buttons (e.g. Sea / Air), styled like the hours
 *  editor's Open/Closed switch. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-sm border border-foreground px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors",
              active ? "bg-foreground text-background" : "opacity-70 hover:opacity-100",
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-3 shrink-0 rounded-sm border border-foreground", className)}
      style={{ backgroundColor: color }}
    />
  );
}

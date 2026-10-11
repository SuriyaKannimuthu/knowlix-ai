import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "solid" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full text-[0.9rem] font-medium tracking-[-0.01em] transition duration-300 ease-out active:scale-[0.98]";

const variants: Record<Variant, string> = {
  solid:
    "bg-ink px-5 py-2.5 text-surface shadow-[0_10px_24px_-10px_rgba(0,0,0,0.65)] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-12px_rgba(0,0,0,0.6)]",
  ghost: "border border-line-strong px-5 py-2.5 text-ink hover:border-ink hover:bg-panel",
};

export function pillClasses(variant: Variant = "solid", extra = "") {
  return `${base} ${variants[variant]} ${extra}`;
}

export function PillLink({
  variant = "solid",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={pillClasses(variant, className)} {...props} />;
}

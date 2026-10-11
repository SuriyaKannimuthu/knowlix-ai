"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { PillLink } from "./PillLink";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { href: "#top", label: "Home" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#stack", label: "Stack" },
  { href: "#faqs", label: "FAQs" },
];

export function Nav() {
  const [active, setActive] = useState("#top");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sections = links
      .map((link) => document.querySelector(link.href))
      .filter((el): el is Element => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="relative z-20">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 pt-6 md:justify-center md:gap-12 md:pt-8"
      >
        <Logo />

        <ul className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={active === link.href ? "true" : undefined}
                className="group relative py-1.5 text-[0.9rem] tracking-[-0.01em] text-ink-soft transition-colors hover:text-ink aria-[current]:text-ink"
              >
                {link.label}
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-ink transition-transform duration-300 group-hover:scale-x-100 group-aria-[current]:scale-x-100" />
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 md:flex">
          <PillLink href="/assistant">Open Assistant</PillLink>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle className="h-10 w-10" />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong md:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <span className="relative block h-3 w-4">
              <span
                className={`absolute left-0 h-px w-4 bg-ink transition-transform duration-300 ${open ? "top-1.5 rotate-45" : "top-0"}`}
              />
              <span
                className={`absolute left-0 top-1.5 h-px w-4 bg-ink transition-opacity ${open ? "opacity-0" : ""}`}
              />
              <span
                className={`absolute left-0 h-px w-4 bg-ink transition-transform duration-300 ${open ? "top-1.5 -rotate-45" : "top-3"}`}
              />
            </span>
          </button>
        </div>
      </nav>

      {/* Decorative dotted fragments, echoing the reference's nav row. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full hidden text-faint md:block">
        <span className="dot-rule absolute left-[3%] top-7 w-10" />
        <span className="dot-rule absolute left-[11%] top-7 w-14" />
        <span className="dot-rule absolute left-[21%] top-7 w-14" />
        <span className="dot-rule absolute left-[30%] top-7 w-16" />
        <span className="dot-rule absolute right-[29%] top-2 w-12" />
        <span className="dot-rule absolute right-[17%] top-2 w-16" />
        <span className="dot-rule absolute right-[5%] top-2 w-16" />
      </div>

      <div
        id="mobile-menu"
        hidden={!open}
        className="absolute inset-x-4 top-full mt-3 rounded-3xl border border-line bg-panel p-3 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] md:hidden"
      >
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-[0.95rem] text-ink hover:bg-surface"
              >
                {link.label}
                <span className="font-mono text-xs text-muted">→</span>
              </a>
            </li>
          ))}
        </ul>
        <PillLink href="/assistant" className="mt-2 w-full">
          Open Assistant
        </PillLink>
      </div>
    </header>
  );
}

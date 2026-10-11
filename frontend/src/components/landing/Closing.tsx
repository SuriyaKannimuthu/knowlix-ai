import Link from "next/link";
import { DotGlyph } from "@/components/site/DotGlyph";
import { LogoMark } from "@/components/site/Logo";
import { PillLink } from "@/components/site/PillLink";
import { Reveal } from "@/components/site/Reveal";

export function CallToAction() {
  return (
    <section className="relative overflow-hidden rounded-card bg-surface px-6 py-24 text-center md:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-between px-6 text-ink/10 md:px-16">
        <DotGlyph name="document" size={160} className="hidden md:block" />
        <DotGlyph name="embedding" size={160} className="hidden md:block" />
      </div>
      <Reveal className="relative">
        <h2 className="text-[clamp(2rem,4.6vw,3.4rem)] font-medium leading-[1.04] tracking-[-0.04em]">
          <span className="block text-muted">Your documents are waiting.</span>
          <span className="block">Ask them anything.</span>
        </h2>
        <div className="mt-9 flex justify-center">
          <PillLink href="/assistant">Open the assistant</PillLink>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="rounded-card bg-ink px-6 py-12 text-surface md:px-14">
      <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[1.35rem] font-medium tracking-[-0.03em]">
              Knowlix<span className="text-muted"> AI</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-faint">
            An enterprise RAG knowledge assistant. FastAPI backend, Next.js frontend.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-faint">
          <a href="#how-it-works" className="hover:text-surface">How it works</a>
          <a href="#features" className="hover:text-surface">Features</a>
          <a href="#stack" className="hover:text-surface">Stack</a>
          <a href="#faqs" className="hover:text-surface">FAQs</a>
          <Link href="/assistant" className="hover:text-surface">Assistant</Link>
        </nav>
      </div>
      <div className="dot-rule mt-12 text-ink-soft" aria-hidden="true" />
      <div className="mt-6 flex flex-col gap-2 font-mono text-xs text-muted sm:flex-row sm:justify-between">
        <span>Designed &amp; built by Suriya</span>
        <span>[ Software Engineer · AI Engineering ]</span>
      </div>
    </footer>
  );
}

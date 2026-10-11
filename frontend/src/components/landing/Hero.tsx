import { AsciiField } from "@/components/hero/AsciiField";
import { Nav } from "@/components/site/Nav";
import { PillLink } from "@/components/site/PillLink";

export function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-card bg-surface md:min-h-[calc(100svh-4rem)]"
    >
      <Nav />

      <AsciiField className="pointer-events-none absolute inset-0 h-full w-full" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-start px-5 pt-[14vh] text-center md:justify-center md:pt-0">
        <p className="animate-rise font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted [animation-delay:80ms]">
          [ Retrieval-augmented knowledge assistant ]
        </p>
        <h1 className="mt-5 text-[clamp(2.3rem,5vw,3.6rem)] font-medium leading-[1.02] tracking-[-0.04em]">
          <span className="block animate-rise text-muted [animation-delay:160ms]">
            Ask Your Documents
          </span>
          <span className="block animate-rise text-ink [animation-delay:280ms]">
            and Get Grounded Answers
          </span>
        </h1>
        <p className="mt-5 max-w-[26rem] animate-rise text-[0.92rem] leading-snug text-muted [animation-delay:400ms]">
          Upload PDFs, Word files and notes, ask in plain language, and get answers drawn from your own
          content, each one traced back to its source.
        </p>
        <div className="mt-7 flex animate-rise items-center gap-3 [animation-delay:520ms]">
          <PillLink href="/assistant">Start asking</PillLink>
          <span className="hidden sm:inline-flex">
            <PillLink href="#how-it-works" variant="ghost">
              See how it works
            </PillLink>
          </span>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-1 gap-3 px-6 pb-7 text-[0.85rem] text-muted md:grid-cols-3 md:items-end md:px-10 md:pb-9">
        <p className="hidden md:block">Every answer begins with a source.</p>
        <p className="mx-auto hidden max-w-[19rem] text-center leading-snug text-ink-soft/70 md:block">
          A quiet space for your knowledge. No guesswork. Just answers you can verify.
        </p>
        <a
          href="#how-it-works"
          className="hidden justify-self-end font-mono text-[0.78rem] transition-colors hover:text-ink md:block"
        >
          [Scroll to Explore]
        </a>
      </div>
    </section>
  );
}

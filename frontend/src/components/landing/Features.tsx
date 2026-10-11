import { DotGlyph, type GlyphName } from "@/components/site/DotGlyph";
import { Reveal } from "@/components/site/Reveal";
import { SectionHeading } from "@/components/site/SectionHeading";

const features: { glyph: GlyphName; title: string; body: string }[] = [
  {
    glyph: "document",
    title: "Document parsing",
    body: "PDF, DOCX, text and Markdown. Text is extracted and cleaned, and PDF page numbers are kept for citations.",
  },
  {
    glyph: "chunks",
    title: "Page-aware chunking",
    body: "Recursive splitting on paragraphs, then sentences, with overlap. Chunks never span pages.",
  },
  {
    glyph: "embedding",
    title: "Embedding pipeline",
    body: "Local FastEmbed models by default, or OpenAI and Gemini embeddings, stored in Qdrant.",
  },
  {
    glyph: "search",
    title: "Hybrid retrieval",
    body: "Dense semantic search and BM25-style sparse search, merged with reciprocal rank fusion.",
  },
  {
    glyph: "rank",
    title: "Reranking",
    body: "A cross-encoder rescores the best candidates, judging question and passage together.",
  },
  {
    glyph: "filter",
    title: "Metadata filtering",
    body: "Narrow any question to a document, file types or tags, enforced inside the vector search.",
  },
  {
    glyph: "citation",
    title: "Source citations",
    body: "Every claim carries a marker that maps to the exact passage, document and page.",
  },
  {
    glyph: "refuse",
    title: "Refuses without evidence",
    body: "If no passage clears the relevance threshold, the assistant says so instead of guessing.",
  },
  {
    glyph: "lock",
    title: "Authentication",
    body: "JWT sign-in with bcrypt-hashed passwords. Every document and question is tied to a user.",
  },
  {
    glyph: "shield",
    title: "Document-level access",
    body: "Private, shared with named people, or organization-wide, checked on every retrieval.",
  },
  {
    glyph: "api",
    title: "Typed REST API",
    body: "FastAPI with Pydantic validation, async SQLAlchemy on PostgreSQL, and docs at /docs.",
  },
  {
    glyph: "observe",
    title: "Observability",
    body: "Request IDs, latency, token usage and refusals are logged for every question.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-4 rounded-card bg-surface px-6 py-20 md:px-14 md:py-28">
      <SectionHeading
        index="02"
        label="Features"
        lead="Everything between a file"
        title="and a trustworthy answer."
      />

      <ul className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <Reveal
            as="li"
            key={feature.title}
            delay={(i % 3) * 90}
            className="group relative bg-surface p-7 transition-colors duration-300 hover:bg-panel md:p-8"
          >
            <div className="flex items-start justify-between">
              <DotGlyph
                name={feature.glyph}
                size={42}
                className="text-ink transition-transform duration-500 group-hover:scale-110"
              />
              <span className="font-mono text-[0.68rem] text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-8 text-[1.05rem] font-medium tracking-[-0.015em]">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

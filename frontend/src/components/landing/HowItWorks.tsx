import { Reveal } from "@/components/site/Reveal";
import { SectionHeading } from "@/components/site/SectionHeading";

const pipelines = [
  {
    name: "Ingestion",
    caption: "Runs when you press Calibrate",
    steps: [
      { title: "Upload", detail: "PDF, DOCX or text, checked for type, size and content." },
      { title: "Parse", detail: "Text is extracted, keeping PDF page numbers." },
      { title: "Clean", detail: "Whitespace and artifacts are normalized." },
      { title: "Chunk", detail: "Page-aware passages with overlap." },
      { title: "Embed", detail: "A dense vector and a sparse BM25 vector per chunk." },
      { title: "Store", detail: "Vectors and metadata go to Qdrant." },
    ],
  },
  {
    name: "Query",
    caption: "Runs for every question",
    steps: [
      { title: "Scope", detail: "Limited to documents you may read, plus any filters." },
      { title: "Search", detail: "Dense and sparse search, fused with RRF." },
      { title: "Rerank", detail: "A cross-encoder rescores the candidates." },
      { title: "Gate", detail: "Too little evidence? It refuses here." },
      { title: "Generate", detail: "The LLM answers from that context only." },
      { title: "Cite", detail: "Markers map to the exact passages used." },
    ],
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-4 rounded-card bg-surface px-6 py-20 md:px-14 md:py-28">
      <SectionHeading
        index="01"
        label="How it works"
        lead="Two pipelines,"
        title="one grounded answer."
        description="Documents are prepared ahead of time so questions can be answered in seconds. Every answer is assembled from passages you can open and check."
      />

      <div className="mt-16 space-y-14">
        {pipelines.map((pipeline, p) => (
          <Reveal key={pipeline.name} delay={p * 120}>
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
              <h3 className="text-xl font-medium tracking-[-0.02em]">{pipeline.name} pipeline</h3>
              <span className="font-mono text-xs text-muted">{pipeline.caption}</span>
            </div>
            <ol className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {pipeline.steps.map((step, i) => (
                <li key={step.title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-panel font-mono text-[0.7rem] text-ink">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {i < pipeline.steps.length - 1 ? (
                      <span aria-hidden="true" className="dot-rule hidden flex-1 text-faint lg:block" />
                    ) : null}
                  </div>
                  <p className="mt-4 font-medium tracking-[-0.01em]">{step.title}</p>
                  <p className="mt-1.5 text-sm leading-snug text-muted">{step.detail}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

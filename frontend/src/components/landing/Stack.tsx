import { Reveal } from "@/components/site/Reveal";
import { SectionHeading } from "@/components/site/SectionHeading";

const stack = [
  ["Language", "Python"],
  ["API framework", "FastAPI"],
  ["Validation", "Pydantic"],
  ["ORM", "SQLAlchemy (async)"],
  ["Auth", "JWT + bcrypt"],
  ["Relational DB", "PostgreSQL"],
  ["Vector DB", "Qdrant (dense + sparse)"],
  ["Embeddings", "FastEmbed / OpenAI / Gemini"],
  ["Reranking", "Cross-encoder (FastEmbed)"],
  ["LLM", "Claude / OpenAI / Gemini"],
  ["Evaluation", "Ragas (planned)"],
  ["Experiments", "MLflow (planned)"],
  ["Observability", "Request IDs + structured logs"],
  ["Frontend", "Next.js + Tailwind CSS"],
  ["Containers", "Docker"],
  ["Testing", "Pytest"],
];

const metrics = [
  ["Context precision", "How relevant the retrieved passages are."],
  ["Context recall", "How much of the needed information was retrieved."],
  ["Faithfulness", "Whether the answer is supported by the context."],
  ["Answer relevancy", "Whether the answer addresses the question."],
  ["Latency", "Time to process and answer a query."],
  ["Cost", "LLM and embedding spend per request."],
];

export function Stack() {
  return (
    <section
      id="stack"
      className="scroll-mt-4 grid gap-16 rounded-card bg-surface px-6 py-20 md:px-14 md:py-28 lg:grid-cols-2 lg:gap-20"
    >
      <div>
        <SectionHeading
          index="03"
          label="Stack"
          lead="Python on the backend,"
          title="built to be measured."
        />
        <Reveal as="dl" className="mt-12 font-mono text-[0.82rem]">
          {stack.map(([component, tech]) => (
            <div key={component} className="flex items-baseline gap-3 py-2">
              <dt className="shrink-0 text-muted">{component}</dt>
              <span aria-hidden="true" className="dot-leader h-3 flex-1" />
              <dd className="shrink-0 text-right text-ink">{tech}</dd>
            </div>
          ))}
        </Reveal>
      </div>

      <div id="evaluation" className="lg:pt-[7.5rem]">
        <Reveal className="rounded-3xl border border-line bg-panel p-7 md:p-9">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              RAG evaluation
            </p>
            <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[0.68rem] text-muted">
              benchmarks pending
            </span>
          </div>
          <p className="mt-5 text-[1.35rem] font-medium leading-snug tracking-[-0.02em]">
            Chunking strategies, embedding models, and retrieval settings are compared on a
            fixed question set.
          </p>
          <ul className="mt-8 divide-y divide-line">
            {metrics.map(([name, description]) => (
              <li key={name} className="flex items-start justify-between gap-6 py-3.5">
                <div>
                  <p className="text-[0.95rem] font-medium">{name}</p>
                  <p className="mt-0.5 text-sm text-muted">{description}</p>
                </div>
                <span className="mt-0.5 font-mono text-sm text-faint" title="Not yet measured">
                  —.——
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-muted">
            Scores will be published here once the experiments have been run.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

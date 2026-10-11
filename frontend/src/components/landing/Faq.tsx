import { Reveal } from "@/components/site/Reveal";
import { SectionHeading } from "@/components/site/SectionHeading";

const faqs = [
  {
    q: "What kinds of files can I upload?",
    a: "PDF, DOCX, plain-text and Markdown files. Uploads are checked for type, size and file signature before they are parsed, and the size limit is configurable.",
  },
  {
    q: "How does Knowlix AI avoid making things up?",
    a: "It retrieves passages with hybrid search, reranks them, and only answers when a passage clears a relevance threshold. Otherwise it says it doesn't have enough evidence. The model is told to use the passages only, and every answer cites them.",
  },
  {
    q: "Can I ask about a single document?",
    a: "Yes. In the assistant, pick a document from the scope menu and the question is answered using only that document's passages.",
  },
  {
    q: "Who can see my documents?",
    a: "Only you, unless you share a document with specific people or make it organization-wide. Access is checked in PostgreSQL and enforced as a filter inside every Qdrant search, so other people's passages are never retrieved.",
  },
  {
    q: "Which language models are supported?",
    a: "The backend is provider-agnostic. Anthropic Claude, OpenAI and Google Gemini are supported. Gemini is the server default, and in the assistant you can switch model per question using your own API key.",
  },
  {
    q: "How is answer quality measured?",
    a: "The evaluation plan uses Ragas-style metrics (context precision, context recall, faithfulness and answer relevancy) alongside latency and cost. The /search endpoint already exposes every intermediate score (dense, sparse, fused and rerank) to support it.",
  },
];

export function Faq() {
  return (
    <section
      id="faqs"
      className="scroll-mt-4 grid gap-12 rounded-card bg-surface px-6 py-20 md:px-14 md:py-28 lg:grid-cols-[1fr_1.4fr]"
    >
      <SectionHeading
        index="04"
        label="FAQs"
        lead="Questions,"
        title="answered plainly."
        description="Still curious? The assistant itself is a good place to ask."
      />
      <Reveal as="div" className="divide-y divide-line border-y border-line">
        {faqs.map((faq, i) => (
          <details key={faq.q} name="faq" className="group" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.02rem] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
              {faq.q}
              <span
                aria-hidden="true"
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong transition-colors group-open:border-ink group-open:bg-ink"
              >
                <span className="absolute h-px w-3 bg-ink group-open:bg-surface" />
                <span className="absolute h-3 w-px bg-ink transition-transform duration-300 group-open:rotate-90 group-open:bg-surface" />
              </span>
            </summary>
            <p className="max-w-xl pb-6 pr-10 text-[0.95rem] leading-relaxed text-muted">{faq.a}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

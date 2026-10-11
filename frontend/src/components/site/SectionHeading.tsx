import { Reveal } from "./Reveal";

/** Two-tone heading: a grey lead line over an ink line, as in the hero. */
export function SectionHeading({
  index,
  label,
  lead,
  title,
  description,
  align = "left",
}: {
  index: string;
  label: string;
  lead: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <Reveal className={centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
        [{index}] {label}
      </p>
      <h2 className="mt-5 text-[clamp(2rem,4.2vw,3.25rem)] font-medium leading-[1.04] tracking-[-0.035em]">
        <span className="block text-muted">{lead}</span>
        <span className="block text-ink">{title}</span>
      </h2>
      {description ? (
        <p
          className={`mt-5 max-w-xl text-[0.98rem] leading-relaxed text-ink-soft/80 ${centered ? "mx-auto" : ""}`}
        >
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}

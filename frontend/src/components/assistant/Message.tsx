"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";
import type { ChatMessage } from "./types";

function DotLoader() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full rounded-2xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-strong"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 font-mono text-[0.62rem] text-surface">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.82rem] font-medium">{source.document}</span>
          {source.page !== undefined && source.page !== null ? (
            <span className="shrink-0 font-mono text-[0.68rem] text-muted">p. {source.page}</span>
          ) : null}
          {typeof source.score === "number" ? (
            <span className="shrink-0 font-mono text-[0.68rem] text-muted" title="Relevance score">
              {source.score.toFixed(2)}
            </span>
          ) : null}
        </span>
        <span
          className={`mt-2 block text-[0.82rem] leading-relaxed text-ink-soft/80 ${open ? "" : "line-clamp-2"}`}
        >
          {source.content}
        </span>
      </button>
    </li>
  );
}

export function Message({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-ink px-5 py-3 text-[0.94rem] leading-relaxed text-surface">
          {message.content}
        </p>
      </div>
    );
  }

  if (message.status === "pending") {
    return (
      <div className="flex items-center gap-3 py-2 text-sm text-muted" role="status">
        <DotLoader />
        Searching your documents…
      </div>
    );
  }

  if (message.status === "error" || message.status === "cancelled") {
    return (
      <div className="rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
        <p className={message.status === "error" ? "text-danger" : "text-muted"}>
          {message.content}
        </p>
        <button
          type="button"
          onClick={() => onRetry(message)}
          className="mt-2 font-mono text-xs underline underline-offset-4 hover:text-ink"
        >
          Retry
        </button>
      </div>
    );
  }

  const sources = message.sources ?? [];
  const meta = [
    message.meta?.model,
    message.meta?.latency_ms !== undefined ? `${(message.meta.latency_ms / 1000).toFixed(1)}s` : null,
    message.meta?.usage?.total_tokens ? `${message.meta.usage.total_tokens} tokens` : null,
  ].filter(Boolean);

  if (message.refused) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong px-5 py-4">
        <div className="mb-2 flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full border border-ink" aria-hidden="true" />
          Not enough evidence
        </div>
        <p className="text-[0.94rem] leading-relaxed text-ink-soft">{message.content}</p>
        {meta.length ? <p className="mt-3 font-mono text-[0.65rem] text-faint">{meta.join(" · ")}</p> : null}
      </div>
    );
  }

  return (
    <div className="group">
      <div className="mb-2 flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-ink" aria-hidden="true" />
        Knowlix
        {meta.length ? (
          <span className="normal-case tracking-normal text-faint">· {meta.join(" · ")}</span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-[0.96rem] leading-relaxed text-ink">{message.content}</p>

      {sources.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
            Sources · {sources.length}
          </p>
          <ol className="grid gap-2">
            {sources.map((source, i) => (
              <SourceCard key={`${source.document}-${source.page ?? "x"}-${i}`} source={source} index={i} />
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-3 flex gap-3 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard can be unavailable (insecure context); nothing to do.
            }
          }}
          className="font-mono text-[0.7rem] text-muted hover:text-ink"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

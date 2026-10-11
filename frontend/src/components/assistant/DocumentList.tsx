"use client";

import { useState } from "react";
import { fileExtension, formatBytes, formatDate } from "@/lib/format";
import type { DocumentRecord } from "@/lib/types";

const ACCESS_LABEL = { shared: "shared with you", organization: "organization" } as const;

export function DocumentList({
  documents,
  loading,
  error,
  onDelete,
  onManage,
  onRetry,
}: {
  documents: DocumentRecord[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => Promise<void>;
  onManage: (doc: DocumentRecord) => void;
  onRetry: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  if (loading && documents.length === 0) {
    return (
      <ul className="space-y-2" aria-label="Loading documents">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-14 animate-pulse rounded-xl bg-line/60" />
        ))}
      </ul>
    );
  }

  if (error && documents.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-panel p-4 text-sm">
        <p className="text-ink-soft">{error}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-mono text-xs underline underline-offset-4">
          Try again
        </button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-xl border border-line px-4 py-5 text-center text-sm text-muted">
        No documents yet. Upload one to get started.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {documents.map((doc) => {
        const isOwner = (doc.access ?? "owner") === "owner";
        const extension = doc.file_type ?? fileExtension(doc.filename).slice(1);
        const meta = [
          extension.toUpperCase(),
          formatBytes(doc.size_bytes),
          doc.chunk_count ? `${doc.chunk_count} ${doc.chunk_count === 1 ? "chunk" : "chunks"}` : "",
          formatDate(doc.created_at),
        ].filter(Boolean);

        return (
          <li key={doc.id} className="group relative">
            <div className="flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 pr-16 transition-colors hover:border-line hover:bg-panel">
              <span className="mt-0.5 flex h-8 w-7 shrink-0 items-end justify-center rounded-[5px] border border-line-strong bg-surface pb-1 font-mono text-[0.5rem] text-muted">
                {extension.slice(0, 4) || "doc"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.85rem] font-medium">{doc.filename}</span>
                {doc.status === "uploaded" ? (
                  <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.65rem] text-muted">
                    <span className="h-1.5 w-1.5 rounded-full border border-ink" aria-hidden="true" />
                    not calibrated · {formatBytes(doc.size_bytes)}
                  </span>
                ) : doc.status === "processing" ? (
                  <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.65rem] text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" aria-hidden="true" />
                    calibrating…
                  </span>
                ) : doc.status === "failed" ? (
                  <span className="mt-0.5 block text-[0.72rem] leading-snug text-danger">
                    {doc.error || "Processing failed."}
                  </span>
                ) : (
                  <span className="mt-0.5 block truncate font-mono text-[0.65rem] text-muted">
                    {meta.join(" · ")}
                  </span>
                )}
                {!isOwner || (doc.tags?.length ?? 0) > 0 || doc.visibility === "organization" ? (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {!isOwner ? (
                      <span className="rounded-full bg-ink px-1.5 py-px font-mono text-[0.58rem] text-surface">
                        {ACCESS_LABEL[doc.access as keyof typeof ACCESS_LABEL]}
                      </span>
                    ) : doc.visibility === "organization" ? (
                      <span className="rounded-full border border-ink px-1.5 py-px font-mono text-[0.58rem]">
                        org-wide
                      </span>
                    ) : null}
                    {doc.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-line-strong px-1.5 py-px font-mono text-[0.58rem] text-muted"
                      >
                        #{tag}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </div>

            {isOwner && confirming === doc.id ? (
              <div className="absolute inset-y-1 right-1 flex items-center gap-1 rounded-lg bg-panel px-1.5 shadow-sm">
                <button
                  type="button"
                  disabled={deleting === doc.id}
                  onClick={async () => {
                    setDeleting(doc.id);
                    try {
                      await onDelete(doc.id);
                    } finally {
                      setDeleting(null);
                      setConfirming(null);
                    }
                  }}
                  className="rounded-md bg-ink px-2 py-1 text-[0.7rem] text-surface disabled:opacity-50"
                >
                  {deleting === doc.id ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="rounded-md px-2 py-1 text-[0.7rem] text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : isOwner ? (
              <div className="absolute right-1.5 top-2 flex gap-0.5 opacity-100 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onManage(doc)}
                  aria-label={`Manage access to ${doc.filename}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <circle cx="6" cy="5.5" r="2.5" />
                    <path d="M1.5 13.5c.6-2.4 2.3-3.7 4.5-3.7s3.9 1.3 4.5 3.7M11 4v4M9 6h4" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(doc.id)}
                  aria-label={`Delete ${doc.filename}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

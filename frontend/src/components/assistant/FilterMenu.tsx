"use client";

import { useEffect, useRef, useState } from "react";
import type { FileType } from "@/lib/types";

const FILE_TYPES: FileType[] = ["pdf", "docx", "txt", "md"];

/** Metadata filters sent with each question: file types and tags. */
export function FilterMenu({
  availableTags,
  fileTypes,
  tags,
  onChange,
}: {
  availableTags: string[];
  fileTypes: FileType[];
  tags: string[];
  onChange: (next: { fileTypes: FileType[]; tags: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = fileTypes.length + tags.length;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 font-mono text-[0.7rem] transition-colors ${
      active ? "border-ink bg-ink text-surface" : "border-line-strong hover:border-ink"
    }`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
          count ? "border-ink bg-panel" : "border-line-strong hover:border-ink"
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 3.5h12L9.5 9v4l-3 1.5V9z" strokeLinejoin="round" />
        </svg>
        <span className="hidden sm:inline">Filters</span>
        {count ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 font-mono text-[0.6rem] text-surface">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Search filters"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-3xl border border-line bg-panel p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)]"
        >
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted">File type</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={fileTypes.includes(type)}
                onClick={() => onChange({ fileTypes: toggle(fileTypes, type), tags })}
                className={chip(fileTypes.includes(type))}
              >
                {type}
              </button>
            ))}
          </div>

          <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted">Tags</p>
          {availableTags.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tags.includes(tag)}
                  onClick={() => onChange({ fileTypes, tags: toggle(tags, tag) })}
                  className={chip(tags.includes(tag))}
                >
                  #{tag}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">Add tags when uploading to filter by them.</p>
          )}

          <div className="mt-4 flex justify-between border-t border-line pt-3">
            <button
              type="button"
              onClick={() => onChange({ fileTypes: [], tags: [] })}
              disabled={!count}
              className="font-mono text-[0.7rem] text-muted hover:text-ink disabled:opacity-40"
            >
              clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-ink px-3 py-1 text-xs text-surface"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

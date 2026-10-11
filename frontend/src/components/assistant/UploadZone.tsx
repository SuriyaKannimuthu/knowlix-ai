"use client";

import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import type { Visibility } from "@/lib/types";
import type { UploadItem } from "./types";

export interface UploadSettings {
  tags: string[];
  visibility: Visibility;
}

export function UploadZone({
  uploads,
  onFiles,
  onDismiss,
}: {
  uploads: UploadItem[];
  onFiles: (files: File[], settings: UploadSettings) => void;
  onDismiss: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");

  const send = (files: File[]) => {
    if (files.length === 0) return;
    const tagList = tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    onFiles(files, { tags: [...new Set(tagList)], visibility });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          send(Array.from(event.dataTransfer.files));
        }}
        className={`group relative flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? "border-ink bg-panel" : "border-line-strong hover:border-ink hover:bg-panel"
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-surface transition-transform group-hover:-translate-y-0.5">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="mt-3 text-sm font-medium">
          {dragging ? "Drop to upload" : "Upload documents"}
        </span>
        <span className="mt-1 font-mono text-[0.68rem] text-muted">
          PDF DOCX TXT MD · max {MAX_UPLOAD_MB} MB
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={[...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME_TYPES].join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          send(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <label className="sr-only" htmlFor="upload-tags">
          Tags for new uploads
        </label>
        <input
          id="upload-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="tags, comma separated"
          className="min-w-0 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[0.68rem] outline-none placeholder:text-faint focus:border-ink focus-visible:outline-none"
        />
        <label className="sr-only" htmlFor="upload-visibility">
          Who can see new uploads
        </label>
        <select
          id="upload-visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as Visibility)}
          className="rounded-full border border-line bg-panel px-2.5 py-1.5 font-mono text-[0.68rem] outline-none focus:border-ink"
        >
          <option value="private">only me</option>
          <option value="organization">organization</option>
        </select>
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.id} className="rounded-xl border border-line bg-panel px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[0.8rem]">{upload.name}</span>
                {upload.error ? (
                  <button
                    type="button"
                    onClick={() => onDismiss(upload.id)}
                    className="shrink-0 font-mono text-[0.68rem] text-muted hover:text-ink"
                  >
                    dismiss
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-[0.68rem] text-muted">
                    {Math.round(upload.progress * 100)}%
                  </span>
                )}
              </div>
              {upload.error ? (
                <p className="mt-1 text-[0.75rem] leading-snug text-danger">{upload.error}</p>
              ) : (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-ink transition-[width] duration-200"
                    style={{ width: `${Math.max(4, upload.progress * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

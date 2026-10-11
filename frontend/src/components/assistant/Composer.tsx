"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_TYPES, MAX_QUESTION_LENGTH } from "@/lib/config";

export function Composer({
  busy,
  disabled,
  placeholder,
  onSend,
  onStop,
  onAttach,
}: {
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (question: string) => void;
  onStop: () => void;
  /** Called with the files picked through the paperclip button. */
  onAttach?: (files: File[]) => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !busy && !disabled;

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(resize);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`flex items-end gap-2 rounded-[1.6rem] border border-line-strong bg-panel p-2 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.5)] transition-colors focus-within:border-ink ${
        onAttach ? "pl-2" : "pl-5"
      }`}
    >
      {onAttach ? (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach documents"
            title="Attach documents (PDF, DOCX, TXT, MD)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path
                d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l5.8-5.8a2.3 2.3 0 0 1 3.3 3.3L6.3 11.3a1.2 1.2 0 0 1-1.7-1.7L9.8 4.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={[...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME_TYPES].join(",")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) onAttach(files);
              event.target.value = "";
            }}
          />
        </>
      ) : null}
      <label htmlFor="question" className="sr-only">
        Ask a question
      </label>
      <textarea
        id="question"
        ref={textareaRef}
        rows={1}
        value={value}
        maxLength={MAX_QUESTION_LENGTH}
        placeholder={placeholder}
        onChange={(event) => {
          setValue(event.target.value);
          resize();
        }}
        onKeyDown={onKeyDown}
        className="max-h-[180px] min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-[0.95rem] leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none"
      />
      {value.length > MAX_QUESTION_LENGTH * 0.8 ? (
        <span className="mb-3 font-mono text-[0.65rem] text-muted">
          {value.length}/{MAX_QUESTION_LENGTH}
        </span>
      ) : null}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink text-ink transition hover:bg-ink hover:text-surface"
        >
          <span className="h-3 w-3 rounded-[2px] bg-current" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send question"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-surface shadow-[0_8px_18px_-8px_rgba(0,0,0,0.6)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:bg-faint disabled:shadow-none"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </form>
  );
}

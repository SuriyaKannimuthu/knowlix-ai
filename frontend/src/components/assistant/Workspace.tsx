"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DotGlyph } from "@/components/site/DotGlyph";
import { Logo } from "@/components/site/Logo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { api, API_MODE, errorMessage, isAbortError } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { getLlmSettings } from "@/lib/llm-settings";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  API_BASE_URL,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} from "@/lib/config";
import { fileExtension } from "@/lib/format";
import { uid } from "@/lib/id";
import type { ChatRequest, DocumentRecord, FileType, LLMProvidersResponse, User } from "@/lib/types";
import { AccessDialog } from "./AccessDialog";
import { CalibratePanel } from "./CalibratePanel";
import { Composer } from "./Composer";
import { DocumentList } from "./DocumentList";
import { FilterMenu } from "./FilterMenu";
import { effectiveProvider, ModelMenu, needsKey, useLlmSettings } from "./ModelMenu";
import { Message } from "./Message";
import { StatusBadge } from "./StatusBadge";
import type { ChatMessage, HealthState, UploadItem } from "./types";
import { UploadZone, type UploadSettings } from "./UploadZone";

const SUGGESTIONS =
  API_MODE === "mock"
    ? [
        "How does hybrid retrieval work?",
        "What does faithfulness measure?",
        "How should uploads be validated?",
        "What happens when evidence is insufficient?",
      ]
    : [
        "What are the main topics covered?",
        "Summarize the key points in a few bullets.",
        "What does the policy say about security?",
        "List any deadlines or dates mentioned.",
      ];

const POLL_MS = 2000;

function validateFile(file: File): string | null {
  const extension = fileExtension(file.name);
  const typeOk =
    (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension) ||
    (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  if (!typeOk) return "Only PDF, DOCX, TXT and Markdown files are supported.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return `Files must be ${MAX_UPLOAD_MB} MB or smaller.`;
  return null;
}

export function Workspace({ user }: { user: User | null }) {
  const [health, setHealth] = useState<HealthState>("checking");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [calibrationBatch, setCalibrationBatch] = useState<string[]>([]);
  const [calibrationStarting, setCalibrationStarting] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [fileTypes, setFileTypes] = useState<FileType[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [managing, setManaging] = useState<DocumentRecord | null>(null);
  const [llmProviders, setLlmProviders] = useState<LLMProvidersResponse | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const llmSettings = useLlmSettings();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = messages.some((message) => message.status === "pending");
  const readyDocuments = documents.filter((doc) => (doc.status ?? "ready") === "ready");
  const processing = documents.some((doc) => doc.status === "processing");
  // Calibration state comes from the server's statuses, never from local
  // bookkeeping, so deletes, replacements and backend restarts can't wedge it.
  const ownDocuments = documents.filter((doc) => (doc.access ?? "owner") === "owner");
  const pendingDocuments = ownDocuments.filter((doc) => doc.status === "uploaded" || doc.status === "failed");
  const calibratingDocuments = ownDocuments.filter((doc) => doc.status === "processing");
  const calibrating = calibratingDocuments.length > 0;
  // The last batch this tab started, minus anything deleted since.
  const batchDocuments = ownDocuments.filter((doc) => calibrationBatch.includes(doc.id));
  const batchFinished = batchDocuments.filter((doc) => doc.status === "ready" || doc.status === "failed");
  const calibrationTotal = Math.max(batchDocuments.length, calibratingDocuments.length);
  const calibrationDone = Math.min(batchFinished.length, calibrationTotal - calibratingDocuments.length);
  const allTags = [...new Set(readyDocuments.flatMap((doc) => doc.tags ?? []))].sort();
  const filterCount = fileTypes.length + tags.length;

  const refreshDocuments = useCallback(() => {
    return api
      .listDocuments()
      .then((docs) => {
        setDocuments(docs);
        setDocsError(null);
      })
      .catch((error) => setDocsError(errorMessage(error)))
      .finally(() => setDocsLoading(false));
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  // Ingestion runs in the background on the server; poll until it settles.
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(() => void refreshDocuments(), POLL_MS);
    return () => clearTimeout(timer);
  }, [processing, documents, refreshDocuments]);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then(() => !cancelled && setHealth("online"))
        .catch(() => !cancelled && setHealth("offline"));
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  useEffect(() => {
    let cancelled = false;
    api
      .llmProviders()
      .then((catalog) => !cancelled && setLlmProviders(catalog))
      .catch(() => {
        // The picker then shows only the server default and the no-LLM option.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildRequest = (question: string): ChatRequest => {
    const request: ChatRequest = { question };
    if (filterCount) request.filters = { file_types: fileTypes, tags };
    const { choice } = getLlmSettings();
    if (choice.provider !== "default") {
      request.llm = choice.model ? { provider: choice.provider, model: choice.model } : { provider: choice.provider };
    }
    return request;
  };

  const ask = async (request: ChatRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const answerId = uid("msg");

    setMessages((list) => [
      ...list,
      { id: uid("msg"), role: "user", content: request.question },
      { id: answerId, role: "assistant", content: "", status: "pending", request },
    ]);

    try {
      // Read the key at send time so retries pick up a corrected key.
      // No selection means the server default, whose provider may also need the user's key.
      const provider = request.llm?.provider ?? effectiveProvider({ provider: "default", model: null }, llmProviders)?.id;
      const llmKey = provider ? getLlmSettings().keys[provider] : undefined;
      const response = await api.chat(request, { signal: controller.signal, llmKey });
      updateMessage(answerId, {
        status: undefined,
        content: response.answer || "The assistant returned an empty answer.",
        sources: response.sources,
        refused: response.refused,
        meta: { model: response.model, latency_ms: response.latency_ms, usage: response.usage },
      });
    } catch (error) {
      updateMessage(
        answerId,
        isAbortError(error)
          ? { status: "cancelled", content: "Stopped before an answer was returned." }
          : { status: "error", content: errorMessage(error) },
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const retry = (failed: ChatMessage) => {
    const index = messages.findIndex((m) => m.id === failed.id);
    const prompt = messages[index - 1];
    if (!prompt || prompt.role !== "user") return;
    setMessages((list) => list.filter((m) => m.id !== failed.id && m.id !== prompt.id));
    void ask(failed.request ?? { question: prompt.content });
  };

  const handleFiles = (files: File[], settings: UploadSettings) => {
    setNotice(null);
    for (const file of files) {
      const id = uid("upload");
      const problem = validateFile(file);
      setUploads((list) => [...list, { id, name: file.name, progress: 0, error: problem ?? undefined }]);
      if (problem) continue;

      api
        .uploadDocument(file, {
          tags: settings.tags,
          visibility: settings.visibility,
          onProgress: (progress) =>
            setUploads((list) => list.map((u) => (u.id === id ? { ...u, progress } : u))),
        })
        .then((doc) => {
          setUploads((list) => list.filter((u) => u.id !== id));
          setDocuments((list) => [doc, ...list.filter((d) => d.id !== doc.id)]);
        })
        .catch((error) =>
          setUploads((list) => list.map((u) => (u.id === id ? { ...u, error: errorMessage(error) } : u))),
        );
    }
  };

  const handleCalibrate = async (all = false) => {
    setCalibrationError(null);
    setCalibrationStarting(true);
    try {
      const result = await api.calibrateDocuments(all);
      setCalibrationBatch(result.document_ids);
      // Show progress immediately; polling picks up each document as it finishes.
      setDocuments((list) =>
        list.map((d) => (result.document_ids.includes(d.id) ? { ...d, status: "processing", error: null } : d)),
      );
      if (result.queued === 0) void refreshDocuments();
    } catch (error) {
      setCalibrationError(errorMessage(error));
    } finally {
      setCalibrationStarting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDocument(id);
      setDocuments((list) => list.filter((d) => d.id !== id));
      setNotice(null);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <Logo />
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line md:hidden"
          aria-label="Close documents panel"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>

      <div className="px-5 pt-6">
        <UploadZone
          uploads={uploads}
          onFiles={handleFiles}
          onDismiss={(id) => setUploads((list) => list.filter((u) => u.id !== id))}
        />
        <div className="mt-3">
          <CalibratePanel
            calibrating={calibrating}
            total={calibrationTotal}
            done={calibrationDone}
            pendingCount={pendingDocuments.length}
            readyCount={ownDocuments.filter((doc) => doc.status === "ready").length}
            lastCalibrated={batchDocuments.filter((doc) => doc.status === "ready").length}
            lastFailed={batchDocuments.filter((doc) => doc.status === "failed").length}
            starting={calibrationStarting}
            error={calibrationError}
            onCalibrate={(all) => void handleCalibrate(all)}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between px-5">
        <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
          Documents · {documents.length}
        </h2>
        <button
          type="button"
          onClick={() => {
            setDocsLoading(true);
            void refreshDocuments();
          }}
          className="font-mono text-[0.68rem] text-muted hover:text-ink"
        >
          refresh
        </button>
      </div>
      {notice ? (
        <p role="alert" className="mx-5 mt-3 rounded-xl bg-panel px-3 py-2 text-[0.78rem] text-danger">
          {notice}
        </p>
      ) : null}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <DocumentList
          documents={documents}
          loading={docsLoading}
          error={docsError}
          onDelete={handleDelete}
          onManage={setManaging}
          onRetry={() => {
            setDocsLoading(true);
            void refreshDocuments();
          }}
        />
      </div>

      <div className="border-t border-line px-5 py-4">
        {user && api.requiresAuth ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.full_name || user.email}</span>
              {user.full_name ? (
                <span className="block truncate font-mono text-[0.65rem] text-muted">{user.email}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setToken(null)}
              className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-xs hover:border-ink"
            >
              Sign out
            </button>
          </div>
        ) : null}
        <StatusBadge health={health} mode={API_MODE} />
        <p className="mt-2 truncate font-mono text-[0.65rem] text-muted">
          {API_MODE === "mock" ? "sample data · keyword retrieval" : `endpoint ${API_BASE_URL}`}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100svh] gap-3 p-3 md:gap-4 md:p-4">
      {/* Sidebar: static on desktop, a drawer on mobile. */}
      <aside
        aria-label="Documents"
        className={`fixed inset-y-3 left-3 z-40 w-[min(320px,86vw)] rounded-card bg-surface shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] transition-transform duration-300 md:static md:z-auto md:w-[300px] md:shrink-0 md:translate-x-0 md:shadow-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-[110%]"
        }`}
      >
        {sidebar}
      </aside>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close documents panel"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-scrim backdrop-blur-[2px] md:hidden"
        />
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card bg-surface">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3 md:gap-3 md:px-8 md:py-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 items-center gap-2 rounded-full border border-line-strong px-3 text-sm md:hidden"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 2.5h5.5L12 5v8.5H4z M9.5 2.5V5H12" strokeLinejoin="round" />
            </svg>
            Docs
          </button>


          <ModelMenu providers={llmProviders} open={modelMenuOpen} onOpenChange={setModelMenuOpen} />

          <FilterMenu
            availableTags={allTags}
            fileTypes={fileTypes}
            tags={tags}
            onChange={(next) => {
              setFileTypes(next.fileTypes);
              setTags(next.tags);
            }}
          />

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <span className="hidden lg:inline-flex">
              <StatusBadge health={health} mode={API_MODE} />
            </span>
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                setMessages([]);
              }}
              disabled={messages.length === 0}
              aria-label="New chat"
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong px-3 text-sm transition-colors hover:border-ink disabled:opacity-40 disabled:hover:border-line-strong sm:px-3.5"
            >
              <span aria-hidden="true" className="text-base leading-none sm:hidden">+</span>
              <span className="hidden sm:inline">New chat</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-8 md:px-8">
            {calibrating || pendingDocuments.length > 0 ? (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm">
                <p className="text-ink-soft">
                  {calibrating
                    ? `Calibrating ${calibratingDocuments.length} document${calibratingDocuments.length === 1 ? "" : "s"}. Chat will include ${calibratingDocuments.length === 1 ? "it" : "them"} when it finishes.`
                    : `${pendingDocuments.length} document${pendingDocuments.length === 1 ? " isn't" : "s aren't"} calibrated yet, so chat can't search ${pendingDocuments.length === 1 ? "it" : "them"}.`}
                </p>
                {!calibrating ? (
                  <button
                    type="button"
                    onClick={() => void handleCalibrate()}
                    disabled={calibrationStarting}
                    className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-surface disabled:opacity-60"
                  >
                    Calibrate now
                  </button>
                ) : (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" aria-hidden="true" />
                )}
              </div>
            ) : null}

            {API_MODE === "live" && health === "offline" ? (
              <div role="alert" className="mb-6 rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
                <p className="font-medium">Can&apos;t reach the FastAPI backend.</p>
                <p className="mt-1 text-muted">
                  Start it with{" "}
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.78rem] text-ink">
                    uvicorn app.main:app --reload
                  </code>{" "}
                  in <code className="font-mono text-[0.78rem]">backend/</code> and make sure{" "}
                  <code className="font-mono text-[0.78rem]">BACKEND_URL</code> points at it.
                </p>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="m-auto flex flex-col items-center py-10 text-center">
                <DotGlyph name="search" size={64} className="text-ink" />
                <h1 className="mt-8 text-[clamp(1.8rem,3.6vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.035em]">
                  <span className="block text-muted">What would you like</span>
                  <span className="block">to know?</span>
                </h1>
                <p className="mt-4 max-w-sm text-sm text-muted">
                  {filterCount
                      ? "Answers will come only from documents matching your filters."
                      : "Answers draw on all your calibrated documents together, with sources."}
                </p>
                {needsKey(llmSettings.choice, llmSettings.keys, llmProviders) ? (
                  <button
                    type="button"
                    onClick={() => setModelMenuOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-line-strong px-4 py-2 text-sm text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    Add your {effectiveProvider(llmSettings.choice, llmProviders)?.name ?? "model"} API key to get answers.
                    <span className="font-medium text-ink underline underline-offset-4">Add key</span>
                  </button>
                ) : null}
                <ul className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => void ask(buildRequest(suggestion))}
                        className="h-full w-full rounded-2xl border border-line bg-panel px-4 py-3 text-left text-sm text-ink-soft transition hover:-translate-y-0.5 hover:border-line-strong hover:text-ink"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-8" aria-live="polite">
                {messages.map((message) => (
                  <Message key={message.id} message={message} onRetry={retry} />
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="px-3 pb-3 md:px-8 md:pb-6">
          <div className="mx-auto max-w-3xl">
            {uploads.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-live="polite">
                {uploads.map((upload) => (
                  <li
                    key={upload.id}
                    className={`flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                      upload.error ? "border-danger/40 text-danger" : "border-line-strong bg-panel"
                    }`}
                  >
                    <span className="truncate">{upload.name}</span>
                    {upload.error ? (
                      <button
                        type="button"
                        onClick={() => setUploads((list) => list.filter((u) => u.id !== upload.id))}
                        className="shrink-0 font-mono text-[0.65rem]"
                        title={upload.error}
                      >
                        failed ×
                      </button>
                    ) : (
                      <span className="shrink-0 font-mono text-[0.65rem] text-muted">
                        {Math.round(upload.progress * 100)}%
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <Composer
              busy={busy}
              placeholder={
                readyDocuments.length > 1
                  ? `Ask anything across your ${readyDocuments.length} documents…`
                  : "Ask anything about your documents…"
              }
              onSend={(question) => void ask(buildRequest(question))}
              onStop={() => abortRef.current?.abort()}
              onAttach={(files) => handleFiles(files, { tags: [], visibility: "private" })}
            />
            <p className="mt-2 text-center font-mono text-[0.65rem] text-muted">
              Answers come only from retrieved passages. Check the sources.
            </p>
          </div>
        </div>
      </main>

      {managing ? (
        <AccessDialog
          document={managing}
          onClose={() => setManaging(null)}
          onUpdated={(doc) => {
            setDocuments((list) => list.map((d) => (d.id === doc.id ? { ...d, ...doc } : d)));
            setManaging((current) => (current ? { ...current, ...doc } : current));
          }}
        />
      ) : null}
    </div>
  );
}

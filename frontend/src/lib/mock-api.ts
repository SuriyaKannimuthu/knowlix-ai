// In-browser stand-in for the FastAPI backend, used when NEXT_PUBLIC_API_MODE
// is not "live". It does simple keyword retrieval over seeded passages and any
// uploaded .txt/.md files. No language model is involved, and the answers say so.

import { uid } from "./id";
import type {
  ChatRequest,
  ChatResponse,
  DocumentRecord,
  FileType,
  KnowlixApi,
  LLMProvidersResponse,
  RequestOptions,
  Share,
  Source,
  UploadOptions,
  User,
} from "./types";

interface Chunk {
  page: number | null;
  content: string;
}

interface MockDocument extends DocumentRecord {
  chunks: Chunk[];
  shares: Share[];
}

const DEMO_PROVIDERS: LLMProvidersResponse = {
  default: { provider: "gemini", model: "gemini-2.5-flash" },
  allow_user_keys: true,
  providers: [
    {
      id: "anthropic",
      name: "Anthropic Claude",
      default_model: "claude-opus-5-5",
      models: [
        { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
        { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
        { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      ],
      server_key_configured: false,
      key_prefix: "sk-ant-",
      key_url: "https://console.anthropic.com/settings/keys",
    },
    {
      id: "openai",
      name: "OpenAI",
      default_model: "gpt-4.1-mini",
      models: [
        { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
        { id: "gpt-4.1", label: "GPT-4.1" },
      ],
      server_key_configured: false,
      key_prefix: "sk-",
      key_url: "https://platform.openai.com/api-keys",
    },
    {
      id: "gemini",
      name: "Google Gemini",
      default_model: "gemini-2.5-flash",
      models: [
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      ],
      server_key_configured: false,
      key_prefix: "",
      key_url: "https://aistudio.google.com/apikey",
    },
  ],
};

const DEMO_USER: User = { id: "demo-user", email: "demo@knowlix.ai", full_name: "Demo user" };

function seed(
  id: string,
  filename: string,
  file_type: FileType,
  size_bytes: number,
  created_at: string,
  tags: string[],
  chunks: Chunk[],
  extra: Partial<MockDocument> = {},
): MockDocument {
  return {
    id,
    filename,
    file_type,
    size_bytes,
    created_at,
    tags,
    chunks,
    status: "ready",
    visibility: "private",
    access: "owner",
    shares: [],
    ...extra,
  };
}

const store: MockDocument[] = [
  seed("doc-knowlix-overview", "knowlix-overview.md", "md", 4_812, "2026-10-01T09:30:00Z", ["product"], [
    {
      page: null,
      content:
        "Knowlix AI is a retrieval-augmented knowledge assistant. Users upload PDF, DOCX and text documents and ask natural-language questions; the system retrieves relevant passages and answers from them with source citations.",
    },
    {
      page: null,
      content:
        "Ingestion pipeline: a document is uploaded, parsed, cleaned and split into page-aware chunks. Each chunk gets a dense embedding and a BM25-style sparse vector, and both are stored in Qdrant with document metadata.",
    },
    {
      page: null,
      content:
        "Query pipeline: dense and sparse searches run in parallel, are merged with reciprocal rank fusion, and a cross-encoder reranks the candidates. If no passage clears the evidence threshold, the assistant refuses instead of guessing.",
    },
    {
      page: null,
      content:
        "The backend is built with Python and FastAPI, with Pydantic validation, async SQLAlchemy on PostgreSQL, JWT authentication and document-level access control. The LLM provider is configurable: Anthropic Claude, OpenAI or Google Gemini.",
    },
  ]),
  seed(
    "doc-rag-evaluation",
    "rag-evaluation-guide.pdf",
    "pdf",
    248_330,
    "2026-10-03T14:05:00Z",
    ["research"],
    [
      {
        page: 2,
        content:
          "Context precision measures how relevant the retrieved passages are to the question. Context recall measures how much of the information required to answer was actually retrieved.",
      },
      {
        page: 3,
        content:
          "Faithfulness checks whether every claim in the answer is supported by the retrieved context. Answer relevancy checks whether the answer actually addresses the user's question.",
      },
      {
        page: 5,
        content:
          "Operational metrics matter too: latency is the time required to process and answer a query, and cost is the estimated spend on LLM and embedding API usage per request.",
      },
    ],
    { visibility: "organization", access: "organization" },
  ),
  seed(
    "doc-security-policy",
    "security-policy.docx",
    "docx",
    32_104,
    "2026-10-06T11:12:00Z",
    ["it", "policy"],
    [
      {
        page: null,
        content:
          "Validate every upload: allow only supported file types such as PDF, DOCX and plain text, and reject files above the configured size limit before they reach the parser.",
      },
      {
        page: null,
        content:
          "Protect the API with authentication and rate limiting. Apply timeouts and retries to external LLM calls, and keep API keys in environment variables rather than source control.",
      },
      {
        page: null,
        content:
          "Enforce document-level access control so users can only retrieve passages from documents they are allowed to see: their own, documents shared with them, and organization-wide documents.",
      },
    ],
    { access: "shared" },
  ),
];

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from how i in is it of on or the this to what when where which who why with you your about into that there their".split(
    " ",
  ),
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function chunkText(text: string, target = 700): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: Chunk[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > target) {
      chunks.push({ page: null, content: current });
      current = "";
    }
    current = current ? `${current} ${paragraph}` : paragraph;
  }
  if (current) chunks.push({ page: null, content: current });
  return chunks;
}

function strip(doc: MockDocument): DocumentRecord {
  const { chunks, shares, ...rest } = doc;
  void shares;
  return { ...rest, chunk_count: chunks.length };
}

function find(id: string): MockDocument {
  const doc = store.find((d) => d.id === id);
  if (!doc) throw new Error("Document not found");
  return doc;
}

/** The sentence sharing the most terms with the question (earliest wins ties). */
function bestSentence(text: string, terms: Set<string>): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  let best = sentences[0];
  let bestHits = -1;
  for (const sentence of sentences) {
    const hits = tokenize(sentence).filter((token) => terms.has(token)).length;
    if (hits > bestHits) {
      best = sentence;
      bestHits = hits;
    }
  }
  return best.trim();
}

const REFUSAL =
  "I couldn't find enough evidence in the documents you can access to answer that. Try rephrasing the question, widening the document filters, or uploading a document that covers it.";

export const mockApi: KnowlixApi = {
  requiresAuth: false,

  async health() {
    await wait(150);
    return { status: "ok", mode: "demo" };
  },

  async login() {
    return { access_token: "demo", token_type: "bearer", expires_in: 0, user: DEMO_USER };
  },

  async register() {
    return { access_token: "demo", token_type: "bearer", expires_in: 0, user: DEMO_USER };
  },

  async me() {
    return DEMO_USER;
  },

  async listDocuments(options?: RequestOptions) {
    await wait(250, options?.signal);
    return store.map(strip);
  },

  async uploadDocument(file: File, options: UploadOptions = {}) {
    for (let step = 1; step <= 10; step += 1) {
      await wait(70, options.signal);
      options.onProgress?.(step / 10);
    }
    const extension = (file.name.split(".").pop() ?? "").toLowerCase() as FileType;
    const isText = extension === "txt" || extension === "md";
    const chunks = isText
      ? chunkText(await file.text())
      : [
          {
            page: extension === "pdf" ? 1 : null,
            content: `Demo mode cannot extract text from ${file.name}. Connect the FastAPI backend to parse ${extension.toUpperCase()} files.`,
          },
        ];
    const doc: MockDocument = {
      id: uid("doc"),
      filename: file.name,
      file_type: extension,
      content_type: file.type,
      size_bytes: file.size,
      status: "uploaded",
      created_at: new Date().toISOString(),
      tags: options.tags ?? [],
      visibility: options.visibility ?? "private",
      access: "owner",
      chunks,
      shares: [],
    };
    // Same name as one of your documents: replace it, like the real backend.
    const existing = store.findIndex((d) => d.filename === file.name && (d.access ?? "owner") === "owner");
    if (existing !== -1) {
      if (store[existing].status === "processing") {
        throw new Error(`${file.name} is being calibrated. Upload the new version when it finishes.`);
      }
      const previous = store[existing];
      store[existing] = { ...doc, id: previous.id, visibility: previous.visibility, shares: previous.shares };
      return strip(store[existing]);
    }
    store.unshift(doc);
    return strip(doc);
  },

  async updateDocument(id, patch) {
    await wait(150);
    const doc = find(id);
    if (patch.visibility) doc.visibility = patch.visibility;
    if (patch.tags) doc.tags = patch.tags;
    return strip(doc);
  },

  async calibrateDocuments(all = false) {
    await wait(200);
    const pending = store.filter(
      (d) =>
        (d.access ?? "owner") === "owner" &&
        (d.status === "uploaded" || d.status === "failed" || (all && d.status === "ready")),
    );
    for (const doc of pending) doc.status = "processing";
    // Finish one document at a time so the UI can show progress.
    pending.forEach((doc, i) => {
      setTimeout(() => {
        doc.status = "ready";
      }, 900 * (i + 1));
    });
    return { queued: pending.length, document_ids: pending.map((d) => d.id) };
  },

  async deleteDocument(id: string) {
    await wait(200);
    const index = store.findIndex((doc) => doc.id === id);
    if (index !== -1) store.splice(index, 1);
  },

  async listShares(id: string) {
    await wait(150);
    return [...find(id).shares];
  },

  async shareDocument(id: string, email: string) {
    await wait(200);
    const doc = find(id);
    const normalized = email.trim().toLowerCase();
    if (doc.shares.some((s) => s.email === normalized)) throw new Error("Already shared with this user");
    const share: Share = {
      user_id: uid("user"),
      email: normalized,
      full_name: null,
      created_at: new Date().toISOString(),
    };
    doc.shares.push(share);
    return share;
  },

  async revokeShare(id: string, userId: string) {
    await wait(150);
    const doc = find(id);
    doc.shares = doc.shares.filter((s) => s.user_id !== userId);
  },

  async chat(request: ChatRequest, options?: RequestOptions): Promise<ChatResponse> {
    const started = performance.now();
    await wait(900, options?.signal);
    const terms = new Set(tokenize(request.question));
    const ids = new Set([
      ...(request.filters?.document_ids ?? []),
      ...(request.document_id ? [request.document_id] : []),
    ]);
    const types = new Set(request.filters?.file_types ?? []);
    const tags = new Set(request.filters?.tags ?? []);
    const scoped = store.filter(
      (doc) =>
        doc.status === "ready" &&
        (ids.size === 0 || ids.has(doc.id)) &&
        (types.size === 0 || (doc.file_type && types.has(doc.file_type))) &&
        (tags.size === 0 || (doc.tags ?? []).some((t) => tags.has(t))),
    );

    // Mirror the backend's evidence gate: most of the question's terms must appear.
    const ranked = scoped
      .flatMap((doc) =>
        doc.chunks.map((chunk) => {
          const tokens = new Set(tokenize(chunk.content));
          const coverage = terms.size ? [...terms].filter((t) => tokens.has(t)).length / terms.size : 0;
          return { doc, chunk, coverage };
        }),
      )
      .filter((item) => item.coverage >= 0.5)
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, 3);

    const latency_ms = Math.round(performance.now() - started);
    if (ranked.length === 0) {
      const waiting = store.some((d) => d.status === "uploaded");
      return {
        answer: waiting && !store.some((d) => d.status === "ready")
          ? "There are no calibrated documents to search yet. Upload your documents, press Calibrate, and ask again once it finishes."
          : REFUSAL,
        sources: [],
        refused: true,
        model: "demo",
        latency_ms,
      };
    }

    const sources: Source[] = ranked.map(({ doc, chunk, coverage }, i) => ({
      index: i + 1,
      document_id: doc.id,
      document: doc.filename,
      page: chunk.page,
      content: chunk.content,
      score: Math.round(coverage * 100) / 100,
    }));
    const summary = ranked.map(({ chunk }, i) => `${bestSentence(chunk.content, terms)} [${i + 1}]`);
    return {
      answer: `Based on the retrieved passages:\n\n${summary.join("\n\n")}\n\n(Demo mode: keyword retrieval with quoted passages. Connect the FastAPI backend for hybrid search, reranking and LLM answers.)`,
      sources,
      refused: false,
      model: "demo",
      latency_ms,
    };
  },

  async llmProviders() {
    await wait(150);
    return DEMO_PROVIDERS;
  },

  async verifyLlmKey() {
    await wait(300);
    throw new Error("Demo mode can't check keys. Run the FastAPI backend (NEXT_PUBLIC_API_MODE=live) to use your own model.");
  },
};

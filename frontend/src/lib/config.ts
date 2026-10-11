// Client-visible configuration. See `.env.example` for the full list.

/** "live" talks to the FastAPI backend; anything else runs the in-browser demo. */
export const API_MODE: "live" | "mock" =
  process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

/** Base path for API calls. `/api` is rewritten to the backend by next.config.ts. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/+$/, "");

export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 20) || 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export const MAX_QUESTION_LENGTH = 2000;

import type { ChatRequest, ChatResponse, Source } from "@/lib/types";

export type HealthState = "checking" | "online" | "offline";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  status?: "pending" | "error" | "cancelled";
  refused?: boolean;
  meta?: Pick<ChatResponse, "model" | "latency_ms" | "usage">;
  /** The request that produced this answer, so a failed one can be retried as-is. */
  request?: ChatRequest;
}

export interface UploadItem {
  id: string;
  name: string;
  progress: number;
  error?: string;
}

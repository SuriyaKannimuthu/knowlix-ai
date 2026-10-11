// Shapes exchanged with the Knowlix AI FastAPI backend (see backend/app/schemas).

/** uploaded = stored, waiting for Calibrate; processing = being calibrated. */
export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";
export type FileType = "pdf" | "docx" | "txt" | "md";
export type Visibility = "private" | "organization";
export type AccessLevel = "owner" | "shared" | "organization";

export interface DocumentRecord {
  id: string;
  filename: string;
  file_type?: FileType;
  content_type?: string;
  size_bytes?: number;
  status?: DocumentStatus;
  error?: string | null;
  chunk_count?: number;
  page_count?: number | null;
  tags?: string[];
  visibility?: Visibility;
  access?: AccessLevel;
  created_at?: string;
}

export interface Source {
  index?: number;
  document_id?: string;
  document: string;
  page?: number | null;
  chunk_index?: number;
  content: string;
  score?: number | null;
}

export interface MetadataFilters {
  document_ids?: string[];
  file_types?: FileType[];
  tags?: string[];
}

export interface ChatRequest {
  question: string;
  document_id?: string;
  filters?: MetadataFilters;
  llm?: LLMSelection;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  refused?: boolean;
  model?: string;
  latency_ms?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export interface HealthResponse {
  status: string;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Share {
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  tags?: string[];
  visibility?: Visibility;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ChatOptions extends RequestOptions {
  /** The user's own key for the selected provider, sent as X-LLM-API-Key. */
  llmKey?: string;
}

export interface KnowlixApi {
  /** False for the in-browser demo, which has no accounts. */
  requiresAuth: boolean;
  health(options?: RequestOptions): Promise<HealthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  register(email: string, password: string, fullName?: string): Promise<AuthResponse>;
  me(): Promise<User>;
  listDocuments(options?: RequestOptions): Promise<DocumentRecord[]>;
  uploadDocument(file: File, options?: UploadOptions): Promise<DocumentRecord>;
  updateDocument(id: string, patch: { visibility?: Visibility; tags?: string[] }): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<void>;
  /** Parse, chunk and index every uploaded (or failed) document you own; `all` rebuilds ready ones too. */
  calibrateDocuments(all?: boolean): Promise<CalibrateResponse>;
  listShares(id: string): Promise<Share[]>;
  shareDocument(id: string, email: string): Promise<Share>;
  revokeShare(id: string, userId: string): Promise<void>;
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
  llmProviders(): Promise<LLMProvidersResponse>;
  verifyLlmKey(provider: LLMProviderId, key: string): Promise<VerifyKeyResponse>;
}

// --- Model selection (bring your own key) -----------------------------------

export type LLMProviderId = "anthropic" | "openai" | "gemini";

export interface LLMSelection {
  provider: LLMProviderId;
  model?: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface LLMProviderInfo {
  id: LLMProviderId;
  name: string;
  default_model: string;
  models: ModelOption[];
  server_key_configured: boolean;
  key_prefix: string;
  key_url: string;
}

export interface LLMProvidersResponse {
  default: { provider: string; model: string };
  allow_user_keys: boolean;
  providers: LLMProviderInfo[];
}

export interface VerifyKeyResponse {
  provider: LLMProviderId;
  valid: boolean;
  models: string[];
}

export interface CalibrateResponse {
  queued: number;
  document_ids: string[];
}

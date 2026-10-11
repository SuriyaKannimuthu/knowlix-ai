# Knowlix AI — Backend

FastAPI service that ingests documents and answers questions about them with retrieval-augmented generation, citations, and refusal when the evidence is weak.

## What it does

| Area | Implementation |
|---|---|
| Parsing | PDF (`pypdf`, page numbers kept), DOCX (`python-docx`, headings and tables), TXT and Markdown. Text is normalized and line-break hyphenation is undone. |
| Validation | Extension allowlist, size limit, magic-byte check, per-user duplicate detection (SHA-256). |
| Chunking | Recursive splitting (paragraph → line → sentence → word) with overlap. Chunks never span PDF pages. |
| Embeddings | Dense: FastEmbed (`BAAI/bge-small-en-v1.5`, local ONNX), OpenAI, or Gemini. Sparse: BM25-style term weights, with IDF applied by Qdrant. |
| Hybrid retrieval | Dense and sparse searches run in parallel and are merged with reciprocal rank fusion. |
| Reranking | Cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2` via FastEmbed) rescores the top candidates. |
| Metadata filtering | Document ids, file types and tags, applied as Qdrant payload filters. |
| Refusal | Passages must clear a rerank-score threshold (or a dense/lexical one when reranking is off). The LLM can also refuse with a sentinel. |
| Citations | The LLM cites `[n]`. Markers are renumbered to match the returned `sources`, which list document, page and passage. |
| Auth | Register and log in with the OAuth2 password flow. JWT access tokens; bcrypt password hashes with SHA-256 pre-hashing. |
| Access control | Documents are private, shared with named users, or organization-wide. Readable ids come from PostgreSQL and are enforced as a filter inside every vector search, then re-checked on results. |
| Reliability | LLM timeouts and retries, per-user chat rate limit, request IDs, latency and token logging, `/health` with dependency checks. |

## Run locally (no Docker needed)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # optional
uvicorn app.main:app --reload
```

- API docs: http://127.0.0.1:8000/docs. Click **Authorize** and log in with your email as the username.
- With the default settings, the database is SQLite at `data/knowlix.db` and Qdrant runs embedded at `data/qdrant`.
- The first start downloads the embedding and reranking models (~150 MB) into `data/models`.
- The default model is **Gemini 2.5 Flash** (`LLM_PROVIDER=gemini`). Set `GEMINI_API_KEY` to answer for everyone with the server's key. Without it, each user enters their own Gemini key in the app. To use another default, set `LLM_PROVIDER=anthropic` or `openai` (and optionally `LLM_MODEL`).

Then run the frontend against it:

```bash
cd frontend
echo NEXT_PUBLIC_API_MODE=live > .env.local
npm run dev
```

## Using Claude for answers

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
EMBEDDING_PROVIDER=fastembed   # Anthropic has no embeddings API
```

| Setting | Default | Notes |
|---|---|---|
| `LLM_MODEL` | `claude-opus-5-5` | `claude-sonnet-5-5` or `claude-haiku-5-5` for lower cost and latency. |
| `ANTHROPIC_EFFORT` | `medium` | `low` … `max`. Opus 5.5 always thinks, and effort sets how much. `LLM_TEMPERATURE` is not sent, because Opus 5.5 rejects sampling parameters. |
| `ANTHROPIC_MAX_TOKENS` | `16000` | Includes thinking tokens, so it is larger than `LLM_MAX_OUTPUT_TOKENS`. |
| `ANTHROPIC_REFUSAL_FALLBACK` | `true` | Sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If a safety classifier declines, the API re-runs the request on Anthropic's recommended fallback model in the same call. |

How outcomes are reported:

- **Not enough evidence:** the evidence gate or the model's `INSUFFICIENT_EVIDENCE` sentinel produces the usual refusal.
- **Safety decline:** a decline from Claude's safety classifiers (`stop_reason: "refusal"`) returns `refused: true` with a message saying the model declined, so it isn't mistaken for missing evidence.
- **Provider failure:** timeouts, outages and bad credentials return **502** after the SDK's retries (`LLM_MAX_RETRIES`).

Token usage, including cached input tokens, is reported in `usage`.

## Choosing a model per question (bring your own key)

In the assistant, the model menu lets each user choose:

- the server default
- Claude, OpenAI or Gemini, with a model from the list or a custom model ID

For a hosted provider, the user pastes their own API key.

- `GET /llm/providers` returns the catalog (suggested models, default model, and whether the server holds a key for each provider).
- `POST /llm/verify {provider}` with header `X-LLM-API-Key` checks a key by listing the models it can use. Model listing costs no tokens.
- `POST /chat` accepts `"llm": {"provider": "anthropic", "model": "claude-sonnet-5-5"}` plus the `X-LLM-API-Key` header.

Key handling:

- **Per request:** the key is used for that single request through a short-lived client, which is closed afterwards.
- **Never stored or logged:** a test asserts that keys don't appear in the logs. Only `own_key=true/false` is recorded.
- **Fallback:** without a user key, the server's own key for that provider is used. If there isn't one, the API returns a clear 400.
- **Clear errors:** a rejected key or unknown model returns 400, and provider rate limits return 429. 401 is never used here, so a bad provider key doesn't sign the user out.
- **Browser storage:** the frontend keeps keys in `sessionStorage`, or in `localStorage` only when the user ticks "Remember on this device".
- **Turning it off:** set `ALLOW_USER_LLM_KEYS=false` to accept server keys only.

## Run with PostgreSQL and a Qdrant server

```bash
JWT_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(48))") docker compose up --build
```

`docker-compose.yml` at the repo root starts `postgres:17-alpine`, `qdrant/qdrant:v1.19.2` and this API on port 8000.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{email, password, full_name?}` → token + user |
| POST | `/auth/login` | form: `username` (email), `password` → token + user |
| GET | `/auth/me` | current user |
| POST | `/documents/upload` | multipart `file`, optional `tags` (comma-separated), `visibility` (`private`/`organization`). Stores the file with status `uploaded`; it is not searchable yet. Re-uploading a file with the **same name** replaces that document: it keeps its id, shares and visibility, and its old content leaves the index immediately. |
| POST | `/documents/calibrate` | Parses, cleans, chunks and embeds every `uploaded` (or `failed`) document you own, in the background. Returns **202** with the queued ids; poll `GET /documents` until each is `ready`. `?all=true` rebuilds already-calibrated documents too. If the server restarts mid-run, interrupted documents return to `uploaded`. |
| GET | `/documents` | everything you can read, each with `access`: `owner`/`shared`/`organization` |
| GET · PATCH · DELETE | `/documents/{id}` | PATCH `{tags?, visibility?}`. Only the owner can modify or delete. |
| GET · POST | `/documents/{id}/shares` | owner only. POST `{email}`. |
| DELETE | `/documents/{id}/shares/{user_id}` | revoke |
| POST | `/chat` | `{question, document_id?, filters?: {document_ids, file_types, tags}, top_k?}` |
| POST | `/search` | retrieval only, with dense, sparse, fused and rerank scores per hit |
| GET | `/health` | database and vector store status |

`/chat` response:

```json
{
  "answer": "Hotel stays are reimbursed up to 180 dollars per night in major cities [1].",
  "sources": [
    { "index": 1, "document_id": "…", "document": "travel-policy.docx", "page": null,
      "chunk_index": 0, "content": "…", "score": 0.99 }
  ],
  "refused": false,
  "model": "claude-opus-5-5",
  "usage": { "prompt_tokens": 812, "completion_tokens": 41, "total_tokens": 853 },
  "latency_ms": 1240
}
```

When the evidence is insufficient: `"refused": true`, `"sources": []`, and an explanatory `answer`.

## Tests

```bash
pytest                              # 48 offline tests: SQLite, in-memory Qdrant, hashing embedder
RUN_MODEL_TESTS=1 pytest -m models  # real FastEmbed embedder + cross-encoder
ruff check app tests
```

The offline suite covers:

- parsing for each format
- chunking invariants
- auth
- upload validation
- sharing and visibility
- cross-user isolation in `/chat` and `/search`
- exact-identifier recall via sparse search
- tag and file-type filters
- refusals
- citation renumbering
- rate limiting

The model tests check that the refusal threshold separates answerable paraphrases from off-topic questions.

### Refusal threshold calibration

`MIN_RERANK_SCORE=-4.0` was calibrated on `ms-marco-MiniLM-L-6-v2`. Answerable paraphrases scored between −1.1 and 6.3, and off-topic questions between −6.6 and −11.2.

Known limitation: this small reranker misses some synonyms. For example, "give back my computer" against a passage about a "laptop" scores −7.9, and "leftover PTO" scores −10.4. Those questions are refused rather than answered. That case is kept as an expected failure in `tests/test_models.py`. A larger reranker (`RERANKER_MODEL=BAAI/bge-reranker-base`) or query rewriting would improve recall; recalibrate the threshold if you change models.

## Design notes and limits

- **Schema management:** tables are created on startup (`AUTO_CREATE_TABLES`). Add Alembic migrations before evolving the schema in production.
- **Access filter scale:** retrieval filters by the explicit list of readable document ids. That's simple and always consistent with the database, and fine up to thousands of documents per user. Beyond that, filter on owner, visibility and group payload fields instead.
- **Background ingestion** uses FastAPI `BackgroundTasks` in-process. With several API replicas, move it to a job queue.
- **Rate limiting** is in-memory and per process. Use Redis or a gateway when scaling out.
- **Scanned PDFs** have no text layer and are marked `failed` with an explanation. OCR is not enabled.
- **Evaluation** with Ragas and MLflow is planned. `/search` exposes the per-stage scores needed for it.

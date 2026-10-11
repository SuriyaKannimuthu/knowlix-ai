# Knowlix AI — Frontend

Next.js frontend for the Knowlix AI knowledge assistant. It talks to the Python/FastAPI backend in [`../backend`](../backend).

- `/`: landing page (hero, how it works, features, stack and evaluation, FAQs)
- `/assistant`:
  - sign in or register
  - upload documents with tags and visibility
  - manage sharing
  - filter by file type and tag, or scope to one document
  - chat with cited answers and clearly marked refusals

Stack: Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, TypeScript.

## Getting started

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

## Demo mode vs. live backend

| `NEXT_PUBLIC_API_MODE` | Behaviour |
|---|---|
| unset / `mock` | Runs entirely in the browser with sample documents and keyword retrieval. No accounts, no LLM. The UI shows a "Demo mode" badge. |
| `live` | Calls the FastAPI backend. Sign-in is required. |

To use the real backend, start it (see `backend/README.md`), then:

```bash
echo NEXT_PUBLIC_API_MODE=live > .env.local
npm run dev
```

`next.config.ts` proxies `/api/*` to `BACKEND_URL` (default `http://127.0.0.1:8000`), so the browser stays same-origin. To call the API directly instead, set `NEXT_PUBLIC_API_BASE_URL` to its URL and add that origin to the backend's `CORS_ORIGINS`.

`NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

## How it talks to the API

- **Auth:** OAuth2 password login (`POST /auth/login`, form-encoded). The bearer token is kept in `localStorage`, and any 401 signs the user out.
- **Uploads and Calibrate:** XHR with progress, sending `file`, `tags` and `visibility`. Uploaded files are stored as `uploaded`. The **Calibrate** button (`POST /documents/calibrate`) processes all of them together, and the list polls while documents are `processing` and shows progress.
- **Model choice:** the header's model menu (`GET /llm/providers`) picks the provider and model per question. A user's own key goes only in the `X-LLM-API-Key` header and is held in `sessionStorage`, or in `localStorage` if they opt in. "Verify key" calls `POST /llm/verify`.
- **Chat:** sends `{question, document_id?, filters: {file_types, tags}, llm?: {provider, model}}` and renders `sources` (numbered to match `[n]` markers), `refused`, `model`, `latency_ms` and `usage`.
- **Sharing:** `/documents/{id}/shares` and `PATCH /documents/{id}` for visibility. These are only offered to the owner.

Types live in `src/lib/types.ts`. The client is `src/lib/api.ts`, and the demo implementation is `src/lib/mock-api.ts`.

## Project layout

```text
src/
├── app/                 # routes: / and /assistant, global theme
├── components/
│   ├── hero/            # AsciiField: animated ASCII/dot-matrix canvas
│   ├── landing/         # landing page sections
│   ├── assistant/       # auth, workspace, uploads, documents, sharing, filters, chat
│   └── site/            # logo, nav, buttons, dot-matrix icons
└── lib/                 # API client, auth token store, demo mock, config, types
```

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
```

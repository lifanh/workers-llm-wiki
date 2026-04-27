# Multi-Format Source Ingestion — Design

**Status:** Draft for review
**Date:** 2026-04-26
**Goal:** Support ingesting PDFs and web URLs (alongside the existing text/Markdown/CSV/JSON), persisting both the original artifact and a parsed plain-text/Markdown rendering for every source.

---

## 1. Scope

In scope (v1):
- **PDF files** uploaded via the existing 📎 picker.
- **Web URLs** entered via a new 🔗 button (and a new agent tool).
- **Text formats** already supported (`.md`, `.txt`, `.csv`, `.json`) — keep working, no behaviour change.
- Persist both the **original** (raw bytes / raw HTML) and a **parsed Markdown** rendering for each source.
- Same code path is reachable from the UI, REST endpoints, and an agent tool.

Out of scope (v1, may be added later):
- DOCX / RTF / HTML-from-disk / images with OCR.
- JS-rendered URLs (no headless browser).
- Robots.txt obedience.
- Background / queued ingestion (everything is synchronous within reasonable size limits).
- Re-ingestion / refresh of URL sources.

---

## 2. Architecture

A single shared `ingest` module owns the full pipeline for every entry point:

```
UI (📎 file)   ──►  POST /api/ingest/file ─┐
UI (🔗 URL)    ──►  POST /api/ingest/url  ─┼──►  WikiAgent RPC ──►  ingest module
Agent tool     ──►  ingestUrl({url})       ─┘                          │
                                                                       ├─► R2 originals/
                                                                       ├─► env.AI.toMarkdown
                                                                       ├─► R2 parsed/
                                                                       └─► sql INSERT/REPLACE sources
```

**Why route through the WikiAgent Durable Object?**
The `sql` template tag and `state` mutators live on the DO instance. Going through the DO via RPC means there is one writer per wiki and we don't have to invent a parallel D1 connection. The DO already owns `env.WIKI_BUCKET`, `this.sql`, and `this.state`.

---

## 3. Data Model

### Schema migration (idempotent, runs in `initDb`)

```sql
ALTER TABLE sources ADD COLUMN source_type        TEXT NOT NULL DEFAULT 'text';
ALTER TABLE sources ADD COLUMN source_url         TEXT;
ALTER TABLE sources ADD COLUMN original_r2_key    TEXT;
ALTER TABLE sources ADD COLUMN original_mime_type TEXT;
ALTER TABLE sources ADD COLUMN parsed_r2_key      TEXT;

-- Backfill old rows so they remain readable through the new column.
UPDATE sources
   SET parsed_r2_key = r2_key
 WHERE parsed_r2_key IS NULL;
```

`r2_key` is left in place for backwards compatibility; new code reads `parsed_r2_key`.

### Final row shape

| Column               | Type    | Example                                             |
|----------------------|---------|-----------------------------------------------------|
| `id`                 | TEXT PK | `2026-04-26-some-article`                           |
| `filename`           | TEXT    | `some-article.pdf` (display name)                   |
| `source_type`        | TEXT    | `text` \| `pdf` \| `url`                            |
| `source_url`         | TEXT?   | `https://example.com/foo` (only for `url`)          |
| `original_r2_key`    | TEXT?   | `default/sources/originals/2026-04-26-...pdf`       |
| `original_mime_type` | TEXT?   | `application/pdf`                                   |
| `parsed_r2_key`      | TEXT?   | `default/sources/parsed/2026-04-26-....md`          |
| `r2_key`             | TEXT    | (legacy) — same as `parsed_r2_key` for new rows     |
| `status`             | TEXT    | `pending` \| `ingested` \| `failed`                 |
| `ingested_at`        | TEXT?   | ISO timestamp                                       |
| `page_count`         | INT     | unchanged                                           |

### R2 layout

```
{wikiId}/sources/originals/{id}.{ext}     ← raw bytes (PDF, HTML, text, ...)
{wikiId}/sources/parsed/{id}.md           ← Markdown produced by toMarkdown
```

---

## 4. Ingestion Pipeline

### 4.1 File pipeline (`ingestFile(name, bytes, mimeType)`)

1. **Validate**
   - `bytes.length ≤ 25 MB` else `400`.
   - `mimeType` ∈ allowlist (`application/pdf`, `text/*`, `application/json`, `text/csv`, `text/markdown`); fall back to extension sniff if mime is empty/`application/octet-stream`.
2. **Generate id**: `${YYYY-MM-DD}-${slug(name without ext)}`. Truncate slug to 60 chars.
3. **Write original**: `r2WriteBytes(originals/{id}.{ext}, bytes, mimeType)`.
4. **Parse**:
   - If `mimeType` is text-y → markdown is the bytes decoded as UTF-8.
   - Else → `const [out] = await env.AI.toMarkdown([{ name: filename, blob: new Blob([bytes], {type: mimeType}) }])`; markdown is `out.data`.
5. **Write parsed**: `r2Write(parsed/{id}.md, markdown)`.
6. **Upsert row**:
   ```sql
   INSERT OR REPLACE INTO sources
     (id, filename, source_type, source_url, original_r2_key, original_mime_type,
      parsed_r2_key, r2_key, status, ingested_at, page_count)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'ingested', ?, 0);
   ```
7. **Return** the row.

### 4.2 URL pipeline (`ingestUrl(url)`)

1. **Validate URL**: must be `http(s):`, hostname non-empty, no `localhost`/private IPs (basic SSRF guard).
2. **Fetch**:
   ```ts
   const res = await fetch(url, {
     redirect: 'follow',
     headers: { 'user-agent': 'workers-llm-wiki/1.0 (+https://github.com/lifanh/workers-llm-wiki)' },
   });
   ```
   Reject non-2xx. Reject `Content-Length` > 10 MB (and stream-cap when missing). Reject content-type not in (`text/html`, `application/xhtml+xml`, `text/plain`).
3. **Generate id**: `${YYYY-MM-DD}-${slug(hostname + '-' + path-tail)}`.
4. **Write original**: `r2WriteBytes(originals/{id}.html, bodyBytes, contentType)`.
5. **Parse**: `env.AI.toMarkdown([{ name: '{id}.html', blob }])` → markdown.
6. **Write parsed**: `r2Write(parsed/{id}.md)`.
7. **Upsert row** with `source_type='url'`, `source_url=url`.

### 4.3 Failure mode

If step 4–5 throws, still write the original (so the user can retry/inspect) and upsert the row with `status='failed'`, `parsed_r2_key=NULL`, `ingested_at=NULL`. Return `{ ok: false, error }` from the endpoint; UI surfaces a toast.

---

## 5. HTTP Endpoints

| Method | Path                              | Body / Params                            | Returns                                   |
|--------|-----------------------------------|------------------------------------------|-------------------------------------------|
| POST   | `/api/ingest/file`                | `multipart/form-data` with field `file`  | `{ ok, source }` or `{ ok:false, error }` |
| POST   | `/api/ingest/url`                 | `application/json` `{ url }`             | `{ ok, source }` or `{ ok:false, error }` |
| GET    | `/api/originals/:id`              | —                                        | original bytes with `Content-Type: original_mime_type` |
| GET    | `/api/sources/:filename`          | (existing, **modified**)                 | parsed Markdown for the source whose `id` matches `filename` *with extension stripped* |

**Route ordering note:** `/api/originals/...` uses a distinct prefix to avoid colliding with `/api/sources/...`.

**Legacy `/api/sources/:filename` semantics change:** the route used to read `{wikiId}/sources/{filename}` directly from R2. New sources don't write to that path. The endpoint is updated to look up the source row by `id = filename.replace(/\.[^.]+$/, '')` (or by `filename` exact match as a fallback for old rows whose id may not match) and stream the bytes at `parsed_r2_key`. Old rows whose `parsed_r2_key` was backfilled to the legacy `r2_key` continue to work.

All ingest endpoints look up the WikiAgent DO (named `default` to match `WIKI_ID`) and call its `ingestFileRpc` / `ingestUrlRpc` method. The `GET /api/originals/:id` endpoint resolves the row in the DO too (to read `original_r2_key`), then streams the R2 object back.

---

## 6. Agent Tools

| Tool          | Status   | Input                  | Behaviour |
|---------------|----------|------------------------|-----------|
| `saveSource`  | existing | `{filename, content}`  | Unchanged (raw text path). Updated to write through the new pipeline so `source_type='text'`. |
| `readSource`  | existing | `{filename}`           | Unchanged. Reads parsed Markdown. |
| `listSources` | existing | `{status?}`            | Unchanged shape; returned objects gain `source_type` and `source_url` fields. |
| `ingestUrl`   | **new**  | `{url}`                | Calls `ingestUrl` shared module. Returns `{ id, filename, source_url, status }`. |

No `ingestFile` agent tool in v1: the LLM doesn't have raw bytes to hand off, and the UI handles the file path directly.

---

## 7. Frontend Changes

### `ChatPanel.tsx`
- 📎 picker: replace the `FileReader.readAsText` body with `fetch('/api/ingest/file', { method:'POST', body: formData })`. Show a spinner. On success, send a chat message `Ingested file: {name}` so the agent picks it up; on failure, show an alert.
- New 🔗 button next to 📎: toggles a small inline URL input + submit. On submit, `POST /api/ingest/url` with `{url}`. Same success/failure pattern.
- Both buttons are disabled while a request is in flight.

### `Sidebar.tsx`
- Source list shows a type icon: 📄 PDF, 🔗 URL, 📝 text.
- Each row shows two links: "view parsed" (existing) and, if `original_r2_key` is set, "open original" → `/api/originals/:id`.

### `FileUpload.tsx`
- Delete (dead code; only ChatPanel handles uploads).

---

## 8. Error Handling Summary

| Failure                           | HTTP       | DB row                          | UI                          |
|-----------------------------------|------------|---------------------------------|-----------------------------|
| Oversize file / response          | 413        | not inserted                    | alert with size info        |
| Unsupported mime / content-type   | 415        | not inserted                    | alert listing supported     |
| Bad URL / non-2xx / SSRF          | 400 / 502  | not inserted                    | alert with reason           |
| `toMarkdown` throws               | 200        | inserted with `status='failed'` | row appears with ✗; alert   |
| R2 write fails                    | 500        | not inserted                    | alert                       |

Endpoints always return JSON. The UI always handles the error case so the page never crashes.

---

## 9. Testing

### Unit (`src/agent/ingest.test.ts`)

Mock bucket (`{ put, get }`), mock `sql` (capture inserts), mock `Ai.toMarkdown`.

- `ingestFile` happy path with PDF → original written, `toMarkdown` called once, parsed written, row inserted with `source_type='pdf'`, `status='ingested'`.
- `ingestFile` with `text/markdown` → skips `toMarkdown`, parsed body equals input.
- `ingestFile` oversize → throws `IngestError` with code `too_large`; nothing written.
- `ingestFile` unsupported mime → throws `IngestError` with code `unsupported_mime`.
- `ingestFile` when `toMarkdown` throws → original still in bucket, row inserted with `status='failed'`.
- `ingestUrl` happy path → fetch mocked, original HTML written, parsed Markdown written, `source_type='url'`.
- `ingestUrl` SSRF guard → `localhost`, `127.0.0.1`, IPv6 loopback, `10.0.0.0/8` all rejected.
- `ingestUrl` non-2xx → rejected.
- `ingestUrl` wrong content-type (e.g. `image/png`) → rejected.

### Manual integration

`npm run dev`, then:
1. Upload a small text-y `.md` → row appears, parsed view works.
2. Upload a PDF (a couple of MB) → row appears with 📄, parsed view shows extracted Markdown, "open original" downloads the PDF unchanged.
3. Click 🔗 and paste a real article URL → row appears with 🔗, parsed view shows extracted text, "open original" returns the captured HTML.
4. Try a 30 MB PDF → user-friendly error, no crash.
5. Try `https://localhost/whatever` → rejected with reason.

---

## 10. Open Questions / Follow-ups

- Re-ingesting / refreshing a URL source — out of scope; user can delete and re-add.
- Streaming the response body to enforce size cap when `Content-Length` is missing — implement using `Response.body` reader, abort once threshold exceeded.
- DOCX / images with OCR — easy follow-on once the original/parsed dual-storage pattern is in place; `toMarkdown` already supports both.

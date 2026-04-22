# LLM Wiki Agent — Design Spec

A Cloudflare Workers-hosted LLM Wiki agent that incrementally builds and maintains a persistent, interlinked knowledge base through conversational AI.

## Decisions

- **Approach:** Single monolithic WikiAgent (Approach A)
- **Multi-tenancy:** Flexible — single user day-one, wiki ID isolation ready for multi-user
- **LLM providers:** Hybrid — Workers AI for fast/cheap ops, external provider via AI Gateway for heavy lifting
- **Ingestion:** File upload + chat (pasted text or uploaded files)
- **Storage:** R2 for markdown files, SQLite for index/metadata
- **Search:** Index-file based (no Vectorize for now)
- **Frontend:** React SPA using `useAgentChat`

---

## Architecture

```
Client (React SPA / useAgentChat)
  │ WebSocket
  ▼
Worker Router (routeAgentRequest)
  │
  ▼
Durable Object: WikiAgent (AIChatAgent)
  ├── SQLite (index, metadata, sources, model config)
  ├── R2 Bucket (wiki markdown files, source files)
  ├── Workers AI (fast/cheap model — direct binding)
  └── AI Gateway → External Provider (capable model — cached, logged)
```

Each wiki instance maps to a separate Durable Object, identified by `wikiId`. All wiki instances share one R2 bucket, isolated by key prefix `{wikiId}/`.

### Mapping from LLM Wiki concepts

| LLM Wiki Concept | Cloudflare Implementation |
|---|---|
| Raw sources | Uploaded via chat UI, stored in R2 under `{wikiId}/sources/` |
| The wiki | Markdown files in R2 under `{wikiId}/wiki/` |
| The schema | System prompt + `{wikiId}/wiki/schema.md` in R2 |
| index.md | `{wikiId}/wiki/index.md` in R2, cached in SQLite |
| log.md | `{wikiId}/wiki/log.md` in R2, append-only |

---

## Data Model

### R2 bucket structure

```
{wikiId}/
├── sources/
│   ├── 2026-04-22-article-title.md
│   ├── 2026-04-22-uploaded-doc.pdf
│   └── ...
├── wiki/
│   ├── schema.md
│   ├── index.md
│   ├── log.md
│   ├── overview.md
│   ├── entities/
│   │   └── entity-name.md
│   ├── concepts/
│   │   └── concept-name.md
│   └── topics/
│       └── topic-name.md
```

### SQLite tables

```sql
-- Fast lookup cache of the wiki index
CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY,        -- e.g. "entities/entity-name"
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL,     -- "entity", "concept", "topic", "source"
  r2_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tags TEXT                   -- JSON array
);

-- Source tracking
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  ingested_at TEXT,
  status TEXT NOT NULL,       -- "pending", "ingested", "failed"
  page_count INTEGER DEFAULT 0
);

-- Model configuration
CREATE TABLE model_config (
  key TEXT PRIMARY KEY,       -- "fast" or "capable"
  provider TEXT NOT NULL,     -- "workers-ai", "openai", "anthropic", "gemini"
  model TEXT NOT NULL,
  gateway_enabled INTEGER DEFAULT 0
);

-- AIChatAgent handles chat message persistence automatically
```

---

## Agent Tools

The WikiAgent defines server-side tools via AI SDK's `tool()`. The LLM orchestrates them based on conversation context.

### Wiki CRUD tools

| Tool | Input | Description |
|---|---|---|
| `readPage` | `{ path: string }` | Read a wiki page from R2 by path |
| `writePage` | `{ path: string, title: string, content: string, category: string, tags?: string[] }` | Create or update a wiki page in R2 + update SQLite index |
| `deletePage` | `{ path: string }` | Remove a page from R2 + SQLite |
| `listPages` | `{ category?: string, tag?: string }` | Query SQLite index with optional filters |
| `readIndex` | `{}` | Read the full `index.md` for broad context |

### Source tools

| Tool | Input | Description |
|---|---|---|
| `saveSource` | `{ filename: string, content: string }` | Store uploaded file or pasted text to R2 `sources/` |
| `readSource` | `{ filename: string }` | Read a source file from R2 |
| `listSources` | `{ status?: string }` | List all sources with ingestion status from SQLite |

### Schema & logging tools

| Tool | Input | Description |
|---|---|---|
| `readSchema` | `{}` | Read `schema.md` |
| `updateSchema` | `{ content: string }` | Update `schema.md` |
| `appendLog` | `{ entry: string }` | Append a timestamped entry to `log.md` |

### Config tool

| Tool | Input | Description |
|---|---|---|
| `modelConfig` | `{ action: "read" \| "update", tier?: string, provider?: string, model?: string, gatewayEnabled?: boolean }` | Read or update model configuration |

---

## Operation Flows

### Ingest

1. User uploads a file or pastes text in chat
2. Agent calls `saveSource` to store in R2
3. Agent reads the source content
4. Agent discusses key takeaways with user
5. Agent calls `writePage` multiple times — summary page, entity updates, concept updates
6. Agent calls `appendLog` with ingest record
7. Agent updates `index.md` via `writePage`
8. `stepCountIs(15)` as safety cap on tool call loops

### Query

1. User asks a question
2. Agent calls `readIndex` or `listPages` to find relevant pages
3. Agent calls `readPage` on best matches
4. Agent synthesizes answer with citations
5. If answer is worth keeping, agent calls `writePage` to file it into the wiki

### Lint

1. User asks for a health check
2. Agent calls `listPages` and reads several pages
3. Agent identifies orphans, contradictions, stale claims, missing cross-references
4. Agent reports findings
5. Optionally fixes issues via `writePage`

---

## AI Gateway & Model Configuration

### Dynamic model config

Models are configured at runtime, stored in SQLite, and changeable via chat or settings.

```typescript
type ModelConfig = {
  fastModel: {
    provider: "workers-ai" | "openai" | "anthropic" | "gemini";
    model: string;
    gatewayEnabled: boolean;
  };
  capableModel: {
    provider: "workers-ai" | "openai" | "anthropic" | "gemini";
    model: string;
    gatewayEnabled: boolean;
  };
  gatewayId: string | null;
};
```

**Defaults:**
- Fast: Workers AI `@cf/meta/llama-3.1-8b-instruct`, gateway disabled
- Capable: configurable external provider, gateway enabled

### Model routing via `prepareStep()`

The agent resolves the provider adapter dynamically based on the config. Simple tool call steps (index reads, listing) use the fast model. Synthesis, writing, and complex reasoning use the capable model.

### AI Gateway features used

- **Caching** — repeated similar queries get cache hits, reducing cost
- **Logging** — full request/response logs for debugging
- **Rate limiting** — protect against runaway tool loops
- **Fallback** — if primary provider is down, fall back to another

---

## Frontend

React SPA using `useAgentChat` from `@cloudflare/ai-chat/react`, bundled with Vite, served as static assets from the same Worker.

### Layout

```
┌─────────────────────────────────────────────────┐
│  LLM Wiki                        [Wiki: my-kb]  │
├──────────────┬──────────────────────────────────┤
│  Sidebar     │   Chat Area                       │
│  ▸ Pages     │   (streaming messages, tool call  │
│  ▸ Sources   │    updates, file attachments)      │
│  ▸ Log       │                                   │
├──────────────┴──────────────────────────────────┤
│  [📎 Upload] [Type a message...        ] [Send]  │
└─────────────────────────────────────────────────┘
```

### Components

| Component | Purpose |
|---|---|
| `ChatPanel` | Main chat using `useAgentChat`, streaming + tool call display |
| `Sidebar` | Wiki page index from agent state, links to page viewer |
| `PageViewer` | Renders wiki markdown page (read-only, fetched from agent) |
| `FileUpload` | Drag-and-drop or click, sends file as base64 via `options.body` |
| `WikiSelector` | Switch between wiki instances (different DO names) |

### Agent state (synced to UI via WebSocket)

```typescript
type WikiState = {
  wikiId: string;
  pageCount: number;
  sourceCount: number;
  lastActivity: string;
  currentOperation: string | null;
  pageIndex: PageEntry[];
};
```

Sidebar re-renders as the agent updates `pageIndex` during ingestion. Full markdown content fetched on-demand when user clicks a page.

---

## Auth & Multi-tenancy

### Day-one: no auth

Single default wiki instance (`wikiId = "default"`). Suitable for personal use.

### Multi-user ready

URL routing: `/{wikiId}/chat` → WikiAgent Durable Object (name = wikiId). Each wiki is fully isolated (separate DO, separate R2 prefix, independent chat history).

| Concern | Day-one | Future |
|---|---|---|
| Identity | None | Cloudflare Access or API key |
| Wiki routing | `wikiId = "default"` | Extracted from auth token |
| Permissions | Full access | Owner / Viewer roles |
| API key storage | `wrangler secret` (shared) | Per-wiki secrets in SQLite |

---

## Project Structure

```
workers-llm-wiki/
├── docs/
│   ├── llm-wiki.md
│   └── specs/
│       └── 2026-04-22-llm-wiki-agent-design.md
├── src/
│   ├── agent/
│   │   ├── wiki-agent.ts           # AIChatAgent subclass
│   │   ├── tools/
│   │   │   ├── wiki-tools.ts       # readPage, writePage, deletePage, listPages, readIndex
│   │   │   ├── source-tools.ts     # saveSource, readSource, listSources
│   │   │   ├── schema-tools.ts     # readSchema, updateSchema
│   │   │   ├── log-tools.ts        # appendLog
│   │   │   └── config-tools.ts     # modelConfig
│   │   ├── models.ts               # dynamic model resolver
│   │   ├── prompts.ts              # system prompt builder
│   │   └── r2.ts                   # R2 read/write helpers
│   ├── app/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── ChatPanel.tsx
│   │       ├── Sidebar.tsx
│   │       ├── PageViewer.tsx
│   │       ├── FileUpload.tsx
│   │       └── WikiSelector.tsx
│   └── index.ts                    # Worker entry, routeAgentRequest
├── public/
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Dependencies

| Package | Purpose |
|---|---|
| `agents` | Cloudflare Agents SDK |
| `@cloudflare/ai-chat` | AIChatAgent + useAgentChat |
| `ai` | Vercel AI SDK |
| `workers-ai-provider` | Workers AI adapter for AI SDK |
| `@ai-sdk/openai` | OpenAI adapter |
| `@ai-sdk/anthropic` | Anthropic adapter |
| `@ai-sdk/google` | Gemini adapter |
| `zod` | Tool input validation |
| `react` / `react-dom` | Frontend |
| `react-markdown` | Render wiki pages |

### Wrangler config

```jsonc
{
  "name": "llm-wiki",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "ai": { "binding": "AI" },
  "r2_buckets": [
    { "binding": "WIKI_BUCKET", "bucket_name": "llm-wiki" }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "WIKI_AGENT", "class_name": "WikiAgent" }
    ]
  },
  "vars": {
    "AI_GATEWAY_ID": "llm-wiki-gateway"
  }
}
```

External API keys set via `wrangler secret put OPENAI_API_KEY` etc.

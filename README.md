# LLM Wiki

A Cloudflare Workers-hosted LLM Wiki agent that incrementally builds and maintains a persistent, interlinked knowledge base through conversational AI.

Based on the [LLM Wiki pattern](docs/llm-wiki.md) — instead of retrieving from raw documents at query time (RAG), the LLM **incrementally builds and maintains a persistent wiki** of structured, interlinked markdown files.

## How it works

- **Ingest** — Upload a source (article, notes, PDF). The agent reads it, creates wiki pages (entities, concepts, topics), updates cross-references, and maintains an index.
- **Query** — Ask questions against the wiki. The agent finds relevant pages, synthesizes answers with citations, and optionally saves valuable answers as new pages.
- **Lint** — Request a health check. The agent finds contradictions, orphan pages, stale claims, and missing cross-references.

## Architecture

```
React SPA (useAgentChat) ←→ WebSocket ←→ WikiAgent (Durable Object)
                                              ├── SQLite (index, metadata, config)
                                              ├── R2 Bucket (markdown files)
                                              ├── Workers AI (fast model)
                                              └── AI Gateway → External LLM (capable model)
```

Each wiki instance runs as a separate Durable Object with its own SQLite database. Wiki pages are stored as markdown files in R2, preserving the file-based wiki philosophy.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (installed as a dev dependency)

## Local Development

### 1. Clone and install

```bash
git clone <repo-url>
cd workers-llm-wiki
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser to authenticate. Required for Workers AI and R2 access during local dev.

### 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create workers-llm-wiki
```

### 4. Start the dev server

```bash
npm run dev
```

This starts a local Vite dev server (typically at `http://localhost:5173`). The Cloudflare Vite plugin runs the Worker and Durable Object locally with access to your remote R2 bucket and Workers AI.

### 5. Use it

Open the URL in your browser. You'll see a chat interface with a sidebar. Try:

- Type "Hello" to test basic chat
- Upload a `.md` or `.txt` file via the 📎 button to ingest a source
- Ask "List all pages" to see the wiki index
- Ask "Run a lint check" to health-check the wiki

## Configuration Reference

All configurable values in one place:

### `wrangler.jsonc` — Infrastructure config

| Setting | Default | Description |
|---|---|---|
| `name` | `"workers-llm-wiki"` | Worker name. Determines your deploy URL (`https://<name>.<subdomain>.workers.dev`) |
| `r2_buckets[0].bucket_name` | `"workers-llm-wiki"` | R2 bucket name. Must match what you created with `wrangler r2 bucket create` |
| `durable_objects.bindings[0].name` | `"WikiAgent"` | Durable Object binding name. Must match the code references |
| `compatibility_date` | `"2026-04-22"` | Cloudflare Workers compatibility date |

### Environment variables / Secrets

Set in `.dev.vars` for local dev, or via `npx wrangler secret put <NAME>` for production.

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | No | OpenAI API key. Only needed if you switch a model tier to `openai` |
| `ANTHROPIC_API_KEY` | No | Anthropic API key. Only needed if you switch a model tier to `anthropic` |
| `GOOGLE_API_KEY` | No | Google Gemini API key. Only needed if you switch a model tier to `gemini` |
| `AI_GATEWAY_ID` | No | AI Gateway identifier (`<account-id>/<gateway-name>`). Enables caching, logging, rate limiting |

### Agent defaults — Runtime config (stored in SQLite)

These are seeded on first run and changeable via chat at any time.

| Setting | Default | Description |
|---|---|---|
| Fast model provider | `workers-ai` | Provider for simple operations (index lookups, listing) |
| Fast model name | `@cf/meta/llama-4-scout-17b-16e-instruct` | Model ID for the fast tier |
| Capable model provider | `workers-ai` | Provider for synthesis, ingestion, complex queries |
| Capable model name | `@cf/meta/llama-4-scout-17b-16e-instruct` | Model ID for the capable tier |
| Gateway enabled | `false` (both tiers) | Whether to route through AI Gateway |
| Wiki ID | `"default"` | Wiki instance identifier. Determines R2 key prefix (`{wikiId}/wiki/...`) |

### Model configuration

By default, the agent uses Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`) for both fast and capable tiers. You can change models at runtime through chat:

- *"Switch the capable model to openai gpt-4o"*
- *"Show me the current model config"*
- *"Set the fast model to workers-ai @cf/meta/llama-3.1-8b-instruct"*

### External LLM providers (optional)

To use OpenAI, Anthropic, or Google Gemini:

```bash
# For local development, create a .dev.vars file:
cat > .dev.vars << 'EOF'
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...
EOF
```

Then tell the agent to switch models via chat.

### AI Gateway with BYOK (recommended)

[AI Gateway](https://developers.cloudflare.com/ai-gateway/) adds caching, logging, rate limiting, and fallback for external LLM calls. With [BYOK (Bring Your Own Keys)](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/), your provider API keys are stored securely in the Cloudflare dashboard — no secrets needed in your Worker or `.dev.vars`.

**Setup:**

1. Go to [Cloudflare Dashboard → AI → AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/general)
2. Create a gateway (e.g. `workers-llm-wiki-gateway`)
3. Go to the **Provider Keys** section in your gateway
4. Click **Add API Key**, select the provider (OpenAI, Anthropic, Google), paste your key, and save
5. (Optional) [Enable Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) for security — Worker bindings are pre-authenticated, so no extra headers needed in your code
6. Add the gateway ID to `.dev.vars` for local dev:
   ```
   AI_GATEWAY_ID=<your-account-id>/workers-llm-wiki-gateway
   ```
7. Enable per model tier via chat: *"Enable AI Gateway for the capable model"*

**With BYOK you do NOT need** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` as Worker secrets — the gateway injects them automatically. You can remove those from `.dev.vars` and skip the `wrangler secret put` steps.

**Key rotation** is done entirely in the dashboard — no redeployment needed. You can also store multiple keys per provider with [aliases](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/#key-aliases) for dev/prod separation.

## Deployment

### 1. Set secrets

```bash
# Always needed if using AI Gateway
npx wrangler secret put AI_GATEWAY_ID

# Only needed if NOT using BYOK (passing keys directly to providers)
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_API_KEY
```

> **With BYOK:** You only need `AI_GATEWAY_ID`. Provider keys are stored in the AI Gateway dashboard and injected automatically.

### 2. Deploy

```bash
npm run deploy
```

This builds the frontend and deploys the Worker. On first deploy, Wrangler automatically:
- Creates the Durable Object namespace
- Runs SQLite migrations
- Configures the R2 bucket binding

Your app will be live at `https://workers-llm-wiki.<your-subdomain>.workers.dev`.

## Project Structure

```
src/
├── server.ts                    # Worker entry point + routing
├── client.tsx                   # React entry point
├── agent/
│   ├── wiki-agent.ts            # AIChatAgent subclass (core agent)
│   ├── db.ts                    # SQLite schema + type helpers
│   ├── models.ts                # Dynamic model resolver (Workers AI, OpenAI, etc.)
│   ├── prompts.ts               # System prompt builder
│   ├── r2.ts                    # R2 read/write helpers
│   └── tools/
│       ├── wiki-tools.ts        # readPage, writePage, deletePage, listPages, readIndex
│       ├── source-tools.ts      # saveSource, readSource, listSources
│       ├── schema-tools.ts      # readSchema, updateSchema
│       ├── log-tools.ts         # appendLog, readLog
│       └── config-tools.ts      # modelConfig (read/update)
└── app/
    ├── App.tsx                  # Layout shell
    ├── styles.css               # Tailwind styles
    └── components/
        ├── ChatPanel.tsx        # Chat interface with streaming
        ├── Sidebar.tsx          # Wiki page index
        ├── PageViewer.tsx       # Markdown page viewer
        ├── FileUpload.tsx       # Drag-and-drop file upload
        └── WikiSelector.tsx     # Wiki instance switcher
```

## Storage

- **R2** — Wiki pages and source files stored as markdown under `{wikiId}/wiki/` and `{wikiId}/sources/`
- **SQLite** (per Durable Object) — Page index, source tracking, model config. Used for fast lookups; R2 is the source of truth for content.
- **Chat history** — Automatically persisted by `AIChatAgent` in SQLite

## Tech Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Agents SDK](https://developers.cloudflare.com/agents/)
- [AIChatAgent](https://developers.cloudflare.com/agents/api-reference/chat-agents/) for streaming chat with message persistence
- [R2](https://developers.cloudflare.com/r2/) for object storage
- [Workers AI](https://developers.cloudflare.com/workers-ai/) for built-in LLM inference
- [AI Gateway](https://developers.cloudflare.com/ai-gateway/) for observability and control
- [Vercel AI SDK](https://sdk.vercel.ai/) for unified model interface
- React + Vite + Tailwind CSS for the frontend

## License

MIT

# LLM Wiki

A Cloudflare Workers-hosted LLM Wiki agent that incrementally builds and maintains a persistent, interlinked knowledge base through conversational AI.

Based on the [LLM Wiki pattern](docs/llm-wiki.md) — instead of retrieving from raw documents at query time (RAG), the LLM **incrementally builds and maintains a persistent wiki** of structured, interlinked markdown files.

## How it works

- **Ingest** — Upload a source (article, notes, PDF). The agent reads it, creates wiki pages (entities, concepts, topics), updates cross-references, and maintains an index.
- **Query** — Ask questions against the wiki. The agent finds relevant pages, synthesizes answers with citations, and optionally saves valuable answers as new pages.
- **Lint** — Request a health check. The agent finds contradictions, orphan pages, stale claims, and missing cross-references.

## Key Concepts

### Model Tiers: Fast vs Capable

The agent uses two model tiers for different workloads:

| Tier | Used for | Default |
|---|---|---|
| **Fast** | Simple operations — listing pages, classification, index lookups | `@cf/moonshotai/kimi-k2.6` (Workers AI) |
| **Capable** | Heavy lifting — ingestion, synthesis, complex queries | `@cf/moonshotai/kimi-k2.6` (Workers AI) |

Both default to Workers AI, which requires **zero API keys** — it's built into Cloudflare Workers. You can switch either tier to an external provider (OpenAI, Anthropic, Gemini) at any time via chat:

- *"Switch the capable model to openai gpt-4o"*
- *"Set the fast model to workers-ai @cf/meta/llama-3.1-8b-instruct"*
- *"Show me the current model config"*

Model config is stored per wiki instance and persists across restarts. Changing models never requires a redeploy.

### Storage

- **R2** — Wiki pages and source files stored as markdown under `{wikiId}/wiki/` and `{wikiId}/sources/`
- **SQLite** (per Durable Object) — Page index, source tracking, model config. Used for fast lookups; R2 is the source of truth for content.
- **Chat history** — Automatically persisted by `AIChatAgent` in SQLite

## Architecture

```
React SPA (useAgentChat) ←→ WebSocket ←→ WikiAgent (Durable Object)
                                              ├── SQLite (index, metadata, config)
                                              ├── R2 Bucket (markdown files)
                                              ├── Workers AI (fast model)
                                              └── AI Gateway → External LLM (capable model)
```

Each wiki instance runs as a separate Durable Object with its own SQLite database.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

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

Opens at `http://localhost:5173`. The Cloudflare Vite plugin runs the Worker and Durable Object locally with access to your remote R2 bucket and Workers AI.

### 5. Try it out

- Type "Hello" to test basic chat
- Upload a `.md` or `.txt` file via the 📎 button to ingest a source
- Ask "List all pages" to see the wiki index
- Ask "Run a lint check" to health-check the wiki

## Deployment

### Path A: Workers AI only (zero config)

If you're using the default Workers AI models for both tiers, no secrets are needed:

```bash
npm run deploy
```

That's it. Your app is live at `https://workers-llm-wiki.<your-subdomain>.workers.dev`.

### Path B: External provider (bring your own API key)

To use OpenAI, Anthropic, or Google Gemini, set the relevant API key as a secret:

```bash
# Set whichever key(s) you need:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_API_KEY
```

Then deploy and switch the model tier via chat:

```bash
npm run deploy
```

> *"Switch the capable model to anthropic claude-sonnet-4-20250514"*

For local dev, put API keys in `.dev.vars` instead:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...
```

### Path C: AI Gateway + BYOK (recommended for production)

[AI Gateway](https://developers.cloudflare.com/ai-gateway/) adds caching, logging, rate limiting, and fallback for external LLM calls. With [BYOK (Bring Your Own Keys)](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/), your provider API keys are stored in the Cloudflare dashboard — **no secrets needed in your Worker**.

This project routes through AI Gateway using the [Vercel AI SDK integration](https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/) (`ai-gateway-provider`) and the [unified OpenAI-compatible `/compat` endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/), so a single configuration works for OpenAI, Anthropic, Google Gemini, Workers AI, and more.

1. Go to [Cloudflare Dashboard → AI → AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/general) and create a gateway (e.g. `workers-llm-wiki-gateway`)
2. In the gateway's **Provider Keys** section, click **Add API Key**, select the provider, paste your key, and save
3. Set the gateway identifiers as secrets:
   ```bash
   npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   # Your Cloudflare account ID (32-char hex)
   npx wrangler secret put AI_GATEWAY_NAME
   # e.g. workers-llm-wiki-gateway
   npx wrangler secret put AI_GATEWAY_TOKEN
   # Optional: only if you configured the gateway with an auth token
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
5. Enable per tier via chat: *"Enable AI Gateway for the capable model"*

With BYOK you do **not** need `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` as Worker secrets — the gateway injects them automatically. Key rotation is done entirely in the dashboard with no redeployment.

> **Under the hood:** when AI Gateway is enabled for a tier, the agent builds the model with
> ```ts
> const aigateway = createAiGateway({ accountId, gateway, apiKey });
> const unified = createUnified();
> aigateway(unified(`${provider}/${model}`)); // e.g. "google-ai-studio/gemini-2.5-pro"
> ```

## Configuration Reference

### `wrangler.jsonc` — Infrastructure

| Setting | Default | Description |
|---|---|---|
| `name` | `"workers-llm-wiki"` | Worker name. Determines your deploy URL |
| `r2_buckets[0].bucket_name` | `"workers-llm-wiki"` | R2 bucket name. Must match what you created |
| `compatibility_date` | `"2026-04-22"` | Cloudflare Workers compatibility date |

### Environment Variables / Secrets

Set in `.dev.vars` for local dev, or via `npx wrangler secret put <NAME>` for production.

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Only for Path B with OpenAI | OpenAI API key |
| `ANTHROPIC_API_KEY` | Only for Path B with Anthropic | Anthropic API key |
| `GOOGLE_API_KEY` | Only for Path B with Gemini | Google Gemini API key |
| `CLOUDFLARE_ACCOUNT_ID` | Only for Path C | Your Cloudflare account ID |
| `AI_GATEWAY_NAME` | Only for Path C | The AI Gateway name |
| `AI_GATEWAY_ID` | Legacy (Path C) | `<account-id>/<gateway-name>` — used as a fallback if the two vars above are unset |
| `AI_GATEWAY_TOKEN` | Optional | `cf-aig-authorization` token if your gateway requires auth |
| `DEFAULT_FAST_MODEL_PROVIDER` | Optional | Initial provider for the fast model |
| `DEFAULT_FAST_MODEL_NAME` | Optional | Initial name for the fast model |
| `DEFAULT_FAST_GATEWAY_ENABLED` | Optional | Set `"true"` to initially enable AI Gateway for fast model |
| `DEFAULT_CAPABLE_MODEL_PROVIDER` | Optional | Initial provider for the capable model |
| `DEFAULT_CAPABLE_MODEL_NAME` | Optional | Initial name for the capable model |
| `DEFAULT_CAPABLE_GATEWAY_ENABLED`| Optional | Set `"true"` to initially enable AI Gateway for capable model |

### Runtime Config (changeable via chat)

These are seeded on first run. Change them anytime by chatting with the agent.

| Setting | Default | Description |
|---|---|---|
| Fast model | `workers-ai` / `@cf/moonshotai/kimi-k2.6` | Model for simple operations |
| Capable model | `workers-ai` / `@cf/moonshotai/kimi-k2.6` | Model for synthesis and complex queries |
| Gateway enabled | `false` (both tiers) | Whether to route through AI Gateway |
| Wiki ID | `"default"` | Wiki instance identifier (determines R2 key prefix) |

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

## Tech Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Agents SDK](https://developers.cloudflare.com/agents/)
- [AIChatAgent](https://developers.cloudflare.com/agents/api-reference/chat-agents/) for streaming chat with message persistence
- [R2](https://developers.cloudflare.com/r2/) for object storage
- [Workers AI](https://developers.cloudflare.com/workers-ai/) for built-in LLM inference
- [AI Gateway](https://developers.cloudflare.com/ai-gateway/) for observability and control
- [Vercel AI SDK](https://sdk.vercel.ai/) for unified model interface
- React + Vite + Tailwind CSS for the frontend

## License

[MIT](LICENSE)

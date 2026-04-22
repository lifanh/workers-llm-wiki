# LLM Wiki Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Workers-hosted LLM Wiki agent that incrementally builds and maintains a persistent knowledge base through conversational AI.

**Architecture:** Single `WikiAgent` class (extends `AIChatAgent`) per wiki instance, backed by a Durable Object with SQLite for metadata and R2 for markdown files. React SPA frontend using `useAgentChat`. Dynamic model routing via AI Gateway.

**Tech Stack:** Cloudflare Workers, Agents SDK, AIChatAgent, R2, AI Gateway, Workers AI, Vercel AI SDK, React, Vite, Zod, TypeScript

---

## File Map

```
workers-llm-wiki/
├── index.html                       # Vite HTML entry
├── env.d.ts                         # Generated Cloudflare env types
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc
├── public/
│   └── favicon.ico
├── src/
│   ├── server.ts                    # Worker entry + WikiAgent export + routing
│   ├── client.tsx                   # React entry point (mounts App)
│   ├── agent/
│   │   ├── wiki-agent.ts            # AIChatAgent subclass
│   │   ├── models.ts                # Dynamic model resolver
│   │   ├── prompts.ts               # System prompt builder
│   │   ├── r2.ts                    # R2 read/write helpers
│   │   ├── db.ts                    # SQLite schema init + query helpers
│   │   └── tools/
│   │       ├── wiki-tools.ts        # readPage, writePage, deletePage, listPages, readIndex
│   │       ├── source-tools.ts      # saveSource, readSource, listSources
│   │       ├── schema-tools.ts      # readSchema, updateSchema
│   │       ├── log-tools.ts         # appendLog
│   │       └── config-tools.ts      # modelConfig
│   └── app/
│       ├── App.tsx                  # Layout shell
│       ├── styles.css               # Tailwind styles
│       └── components/
│           ├── ChatPanel.tsx
│           ├── Sidebar.tsx
│           ├── PageViewer.tsx
│           ├── FileUpload.tsx
│           └── WikiSelector.tsx
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `index.html`, `.gitignore`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "workers-llm-wiki",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy",
    "types": "wrangler types env.d.ts --include-runtime false"
  },
  "dependencies": {
    "@cloudflare/ai-chat": "^0.4.6",
    "agents": "^0.11.4",
    "ai": "^6.0.168",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-markdown": "^10.1.0",
    "workers-ai-provider": "^3.1.11",
    "zod": "^4.3.6",
    "@ai-sdk/openai": "^1.3.22",
    "@ai-sdk/anthropic": "^1.2.12",
    "@ai-sdk/google": "^1.2.18"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.33.0",
    "@cloudflare/workers-types": "^4.20260420.1",
    "@tailwindcss/vite": "^4.2.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "tailwindcss": "^4.2.2",
    "typescript": "^6.0.3",
    "vite": "^8.0.9",
    "wrangler": "^4.84.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "agents/tsconfig",
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import agents from "agents/vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare(), tailwindcss()],
});
```

- [ ] **Step 4: Create wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "llm-wiki",
  "main": "src/server.ts",
  "compatibility_date": "2026-04-22",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "r2_buckets": [
    {
      "binding": "WIKI_BUCKET",
      "bucket_name": "llm-wiki"
    }
  ],
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*"]
  },
  "durable_objects": {
    "bindings": [
      {
        "class_name": "WikiAgent",
        "name": "WikiAgent"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["WikiAgent"]
    }
  ]
}
```

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LLM Wiki</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
env.d.ts
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: All packages install without errors.

- [ ] **Step 8: Generate types**

Run: `npm run types`
Expected: `env.d.ts` is created with `Env` interface containing `AI`, `WIKI_BUCKET`, and `WikiAgent` bindings.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts wrangler.jsonc index.html .gitignore env.d.ts
git commit -m "chore: scaffold project with Cloudflare Workers + Agents + React"
```

---

## Task 2: R2 Helpers

**Files:**
- Create: `src/agent/r2.ts`

- [ ] **Step 1: Create R2 helper module**

```typescript
// src/agent/r2.ts

export async function r2Read(
  bucket: R2Bucket,
  key: string,
): Promise<string | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.text();
}

export async function r2Write(
  bucket: R2Bucket,
  key: string,
  content: string,
): Promise<void> {
  await bucket.put(key, content);
}

export async function r2Delete(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}

export async function r2List(
  bucket: R2Bucket,
  prefix: string,
): Promise<string[]> {
  const listed = await bucket.list({ prefix });
  return listed.objects.map((obj) => obj.key);
}

export async function r2Append(
  bucket: R2Bucket,
  key: string,
  content: string,
): Promise<void> {
  const existing = await r2Read(bucket, key);
  const updated = existing ? existing + "\n" + content : content;
  await r2Write(bucket, key, updated);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/r2.ts
git commit -m "feat: add R2 read/write/delete/list/append helpers"
```

---

## Task 3: SQLite Schema & DB Helpers

**Files:**
- Create: `src/agent/db.ts`

- [ ] **Step 1: Create DB helper module**

This module provides functions that accept the `this.sql` tagged template from the agent. The agent calls `initDb(this.sql)` in `onStart()`.

```typescript
// src/agent/db.ts

type SqlTagged = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => T[];

export function initDb(sql: SqlTagged): void {
  sql`CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tags TEXT
  )`;

  sql`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    ingested_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    page_count INTEGER DEFAULT 0
  )`;

  sql`CREATE TABLE IF NOT EXISTS model_config (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    gateway_enabled INTEGER DEFAULT 0
  )`;

  // Seed default model config if empty
  const existing = sql`SELECT key FROM model_config LIMIT 1`;
  if (existing.length === 0) {
    sql`INSERT INTO model_config (key, provider, model, gateway_enabled)
        VALUES ('fast', 'workers-ai', '@cf/meta/llama-4-scout-17b-16e-instruct', 0)`;
    sql`INSERT INTO model_config (key, provider, model, gateway_enabled)
        VALUES ('capable', 'workers-ai', '@cf/meta/llama-4-scout-17b-16e-instruct', 0)`;
  }
}

export type WikiPageRow = {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  r2_key: string;
  updated_at: string;
  tags: string | null;
};

export type SourceRow = {
  id: string;
  filename: string;
  r2_key: string;
  ingested_at: string | null;
  status: string;
  page_count: number;
};

export type ModelConfigRow = {
  key: string;
  provider: string;
  model: string;
  gateway_enabled: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/db.ts
git commit -m "feat: add SQLite schema init and DB type helpers"
```

---

## Task 4: Dynamic Model Resolver

**Files:**
- Create: `src/agent/models.ts`

- [ ] **Step 1: Create model resolver**

```typescript
// src/agent/models.ts

import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelConfigRow } from "./db";

type Env = {
  AI: Ai;
  AI_GATEWAY_ID?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

export function resolveModel(config: ModelConfigRow, env: Env) {
  const gatewayOpts =
    config.gateway_enabled && env.AI_GATEWAY_ID
      ? { gateway: { id: env.AI_GATEWAY_ID } }
      : undefined;

  switch (config.provider) {
    case "workers-ai": {
      const workersai = createWorkersAI({ binding: env.AI });
      return workersai(config.model as Parameters<typeof workersai>[0]);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/openai`,
            }
          : {}),
      });
      return openai(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/anthropic`,
            }
          : {}),
      });
      return anthropic(config.model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/google-ai-studio`,
            }
          : {}),
      });
      return google(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/models.ts
git commit -m "feat: add dynamic model resolver with AI Gateway support"
```

---

## Task 5: System Prompt Builder

**Files:**
- Create: `src/agent/prompts.ts`

- [ ] **Step 1: Create system prompt builder**

```typescript
// src/agent/prompts.ts

export function buildSystemPrompt(
  wikiId: string,
  schemaContent: string | null,
): string {
  const base = `You are an LLM Wiki agent. You incrementally build and maintain a persistent, interlinked knowledge base of markdown files.

## Your Role
- You maintain a wiki for the user. The user curates sources and asks questions. You do all the summarizing, cross-referencing, filing, and bookkeeping.
- You NEVER modify source files — they are immutable.
- You own the wiki layer entirely: creating pages, updating them, maintaining cross-references, and keeping everything consistent.

## Wiki ID
Current wiki: "${wikiId}"

## Tools Available
You have tools to read/write wiki pages, manage sources, read/update the schema, and append to the log.

## Operations

### Ingest
When the user provides a new source (file upload or pasted text):
1. Save it using saveSource
2. Read and analyze the content
3. Discuss key takeaways with the user
4. Create/update relevant wiki pages (summary, entities, concepts, topics)
5. Update index.md with the new pages
6. Append an entry to log.md

### Query
When the user asks a question:
1. Read the index or list pages to find relevant content
2. Read the relevant pages
3. Synthesize an answer with citations to wiki pages
4. If the answer is substantial, offer to save it as a new wiki page

### Lint
When the user asks for a health check:
1. List all pages and read a sample
2. Check for: contradictions, stale claims, orphan pages, missing cross-references
3. Report findings and offer to fix them

## Page Format
All wiki pages use markdown with YAML frontmatter:
\`\`\`markdown
---
title: Page Title
category: entity | concept | topic | source
tags: [tag1, tag2]
sources: [source-filename]
updated: YYYY-MM-DD
---

# Page Title

Content with [[wikilinks]] to other pages.
\`\`\`

## Cross-References
Use [[Page Title]] syntax for cross-references between wiki pages. Maintain these actively — when you update a page, check if it should link to or be linked from other pages.`;

  if (schemaContent) {
    return base + "\n\n## Wiki-Specific Schema\n\n" + schemaContent;
  }

  return base;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/prompts.ts
git commit -m "feat: add system prompt builder for wiki agent"
```

---

## Task 6: Wiki CRUD Tools

**Files:**
- Create: `src/agent/tools/wiki-tools.ts`

- [ ] **Step 1: Create wiki tools**

```typescript
// src/agent/tools/wiki-tools.ts

import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write, r2Delete } from "../r2";
import type { WikiPageRow } from "../db";

type ToolContext = {
  bucket: R2Bucket;
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => T[];
  wikiId: string;
  onPagesChanged: () => void;
};

export function createWikiTools(ctx: ToolContext) {
  const { bucket, sql, wikiId, onPagesChanged } = ctx;

  return {
    readPage: tool({
      description:
        "Read a wiki page by its path (e.g. 'entities/some-entity' or 'overview'). Returns the full markdown content.",
      parameters: z.object({
        path: z
          .string()
          .describe(
            "Page path relative to wiki directory, e.g. 'entities/some-entity'",
          ),
      }),
      execute: async ({ path }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { error: `Page not found: ${path}` };
        return { path, content };
      },
    }),

    writePage: tool({
      description:
        "Create or update a wiki page. Writes markdown to R2 and updates the SQLite index. Use this for creating new pages and updating existing ones.",
      parameters: z.object({
        path: z
          .string()
          .describe("Page path, e.g. 'entities/some-entity' or 'overview'"),
        title: z.string().describe("Page title"),
        content: z
          .string()
          .describe("Full markdown content including frontmatter"),
        category: z
          .enum(["entity", "concept", "topic", "source"])
          .describe("Page category"),
        summary: z
          .string()
          .optional()
          .describe("One-line summary for the index"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags for categorization"),
      }),
      execute: async ({ path, title, content, category, summary, tags }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        await r2Write(bucket, key, content);

        const now = new Date().toISOString();
        const tagsJson = tags ? JSON.stringify(tags) : null;

        // Upsert into SQLite
        sql`DELETE FROM wiki_pages WHERE id = ${path}`;
        sql`INSERT INTO wiki_pages (id, title, summary, category, r2_key, updated_at, tags)
            VALUES (${path}, ${title}, ${summary ?? null}, ${category}, ${key}, ${now}, ${tagsJson})`;

        onPagesChanged();
        return { success: true, path, title };
      },
    }),

    deletePage: tool({
      description: "Delete a wiki page from R2 and the SQLite index.",
      parameters: z.object({
        path: z.string().describe("Page path to delete"),
      }),
      execute: async ({ path }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        await r2Delete(bucket, key);
        sql`DELETE FROM wiki_pages WHERE id = ${path}`;
        onPagesChanged();
        return { success: true, path };
      },
    }),

    listPages: tool({
      description:
        "List wiki pages from the index. Optionally filter by category or tag. Returns page metadata, not full content.",
      parameters: z.object({
        category: z
          .enum(["entity", "concept", "topic", "source"])
          .optional()
          .describe("Filter by category"),
        tag: z.string().optional().describe("Filter by tag"),
      }),
      execute: async ({ category, tag }) => {
        let pages: WikiPageRow[];
        if (category) {
          pages =
            sql<WikiPageRow>`SELECT * FROM wiki_pages WHERE category = ${category} ORDER BY updated_at DESC`;
        } else {
          pages =
            sql<WikiPageRow>`SELECT * FROM wiki_pages ORDER BY updated_at DESC`;
        }

        if (tag) {
          pages = pages.filter((p) => {
            if (!p.tags) return false;
            const parsed = JSON.parse(p.tags) as string[];
            return parsed.includes(tag);
          });
        }

        return {
          count: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            title: p.title,
            summary: p.summary,
            category: p.category,
            tags: p.tags ? JSON.parse(p.tags) : [],
            updated_at: p.updated_at,
          })),
        };
      },
    }),

    readIndex: tool({
      description:
        "Read the full wiki index (index.md). Use this to get an overview of all pages when answering queries.",
      parameters: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/index.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { content: "Index is empty. No pages yet." };
        return { content };
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/wiki-tools.ts
git commit -m "feat: add wiki CRUD tools (readPage, writePage, deletePage, listPages, readIndex)"
```

---

## Task 7: Source Tools

**Files:**
- Create: `src/agent/tools/source-tools.ts`

- [ ] **Step 1: Create source tools**

```typescript
// src/agent/tools/source-tools.ts

import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write, r2List } from "../r2";
import type { SourceRow } from "../db";

type ToolContext = {
  bucket: R2Bucket;
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => T[];
  wikiId: string;
};

export function createSourceTools(ctx: ToolContext) {
  const { bucket, sql, wikiId } = ctx;

  return {
    saveSource: tool({
      description:
        "Save a source document to storage. Use this when the user provides text to ingest or after receiving an uploaded file.",
      parameters: z.object({
        filename: z
          .string()
          .describe(
            "Filename for the source, e.g. '2026-04-22-article-title.md'",
          ),
        content: z.string().describe("Full text content of the source"),
      }),
      execute: async ({ filename, content }) => {
        const key = `${wikiId}/sources/${filename}`;
        await r2Write(bucket, key, content);

        const id = filename.replace(/\.[^.]+$/, "");
        sql`DELETE FROM sources WHERE id = ${id}`;
        sql`INSERT INTO sources (id, filename, r2_key, status)
            VALUES (${id}, ${filename}, ${key}, 'pending')`;

        return { success: true, filename, key };
      },
    }),

    readSource: tool({
      description: "Read a source document from storage.",
      parameters: z.object({
        filename: z.string().describe("Source filename to read"),
      }),
      execute: async ({ filename }) => {
        const key = `${wikiId}/sources/${filename}`;
        const content = await r2Read(bucket, key);
        if (!content) return { error: `Source not found: ${filename}` };
        return { filename, content };
      },
    }),

    listSources: tool({
      description:
        "List all sources with their ingestion status. Optionally filter by status.",
      parameters: z.object({
        status: z
          .enum(["pending", "ingested", "failed"])
          .optional()
          .describe("Filter by ingestion status"),
      }),
      execute: async ({ status }) => {
        let sources: SourceRow[];
        if (status) {
          sources =
            sql<SourceRow>`SELECT * FROM sources WHERE status = ${status} ORDER BY rowid DESC`;
        } else {
          sources =
            sql<SourceRow>`SELECT * FROM sources ORDER BY rowid DESC`;
        }

        return {
          count: sources.length,
          sources: sources.map((s) => ({
            id: s.id,
            filename: s.filename,
            status: s.status,
            ingested_at: s.ingested_at,
            page_count: s.page_count,
          })),
        };
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/source-tools.ts
git commit -m "feat: add source tools (saveSource, readSource, listSources)"
```

---

## Task 8: Schema & Log Tools

**Files:**
- Create: `src/agent/tools/schema-tools.ts`, `src/agent/tools/log-tools.ts`

- [ ] **Step 1: Create schema tools**

```typescript
// src/agent/tools/schema-tools.ts

import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write } from "../r2";

type ToolContext = {
  bucket: R2Bucket;
  wikiId: string;
};

export function createSchemaTools(ctx: ToolContext) {
  const { bucket, wikiId } = ctx;

  return {
    readSchema: tool({
      description:
        "Read the wiki schema (conventions, page formats, workflows). The schema guides how you maintain this specific wiki.",
      parameters: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/schema.md`;
        const content = await r2Read(bucket, key);
        if (!content)
          return {
            content:
              "No schema defined yet. You can create one with updateSchema.",
          };
        return { content };
      },
    }),

    updateSchema: tool({
      description:
        "Update the wiki schema. Use this to evolve conventions as the wiki grows.",
      parameters: z.object({
        content: z.string().describe("Full markdown content for schema.md"),
      }),
      execute: async ({ content }) => {
        const key = `${wikiId}/wiki/schema.md`;
        await r2Write(bucket, key, content);
        return { success: true };
      },
    }),
  };
}
```

- [ ] **Step 2: Create log tools**

```typescript
// src/agent/tools/log-tools.ts

import { tool } from "ai";
import { z } from "zod";
import { r2Append, r2Read } from "../r2";

type ToolContext = {
  bucket: R2Bucket;
  wikiId: string;
};

export function createLogTools(ctx: ToolContext) {
  const { bucket, wikiId } = ctx;

  return {
    appendLog: tool({
      description:
        "Append a timestamped entry to the wiki log. Use consistent prefixes like 'ingest | Title', 'query | Question', 'lint | Summary'.",
      parameters: z.object({
        entry: z
          .string()
          .describe(
            "Log entry text, e.g. 'ingest | Article about X — created 3 pages, updated 2'",
          ),
      }),
      execute: async ({ entry }) => {
        const key = `${wikiId}/wiki/log.md`;
        const now = new Date().toISOString().split("T")[0];
        const logEntry = `## [${now}] ${entry}`;
        await r2Append(bucket, key, logEntry);
        return { success: true, entry: logEntry };
      },
    }),

    readLog: tool({
      description: "Read the wiki activity log.",
      parameters: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/log.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { content: "Log is empty." };
        return { content };
      },
    }),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/schema-tools.ts src/agent/tools/log-tools.ts
git commit -m "feat: add schema tools and log tools"
```

---

## Task 9: Config Tools

**Files:**
- Create: `src/agent/tools/config-tools.ts`

- [ ] **Step 1: Create config tools**

```typescript
// src/agent/tools/config-tools.ts

import { tool } from "ai";
import { z } from "zod";
import type { ModelConfigRow } from "../db";

type ToolContext = {
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => T[];
};

export function createConfigTools(ctx: ToolContext) {
  const { sql } = ctx;

  return {
    modelConfig: tool({
      description:
        "Read or update the model configuration. There are two tiers: 'fast' (for simple ops like listing, classification) and 'capable' (for synthesis, complex queries). Each tier has a provider, model name, and gateway toggle.",
      parameters: z.object({
        action: z.enum(["read", "update"]).describe("Read or update config"),
        tier: z
          .enum(["fast", "capable"])
          .optional()
          .describe("Which model tier to read/update"),
        provider: z
          .enum(["workers-ai", "openai", "anthropic", "gemini"])
          .optional()
          .describe("Provider to set (for update)"),
        model: z.string().optional().describe("Model name to set (for update)"),
        gatewayEnabled: z
          .boolean()
          .optional()
          .describe("Enable AI Gateway for this tier (for update)"),
      }),
      execute: async ({ action, tier, provider, model, gatewayEnabled }) => {
        if (action === "read") {
          const configs =
            sql<ModelConfigRow>`SELECT * FROM model_config ORDER BY key`;
          return {
            configs: configs.map((c) => ({
              tier: c.key,
              provider: c.provider,
              model: c.model,
              gatewayEnabled: Boolean(c.gateway_enabled),
            })),
          };
        }

        if (!tier)
          return { error: "tier is required for update" };

        const updates: string[] = [];
        if (provider) {
          sql`UPDATE model_config SET provider = ${provider} WHERE key = ${tier}`;
          updates.push(`provider=${provider}`);
        }
        if (model) {
          sql`UPDATE model_config SET model = ${model} WHERE key = ${tier}`;
          updates.push(`model=${model}`);
        }
        if (gatewayEnabled !== undefined) {
          const val = gatewayEnabled ? 1 : 0;
          sql`UPDATE model_config SET gateway_enabled = ${val} WHERE key = ${tier}`;
          updates.push(`gatewayEnabled=${gatewayEnabled}`);
        }

        return { success: true, tier, updated: updates };
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/config-tools.ts
git commit -m "feat: add model config tools (read/update)"
```

---

## Task 10: WikiAgent Class

**Files:**
- Create: `src/agent/wiki-agent.ts`

- [ ] **Step 1: Create the WikiAgent**

```typescript
// src/agent/wiki-agent.ts

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import { initDb, type ModelConfigRow } from "./db";
import { resolveModel } from "./models";
import { buildSystemPrompt } from "./prompts";
import { r2Read } from "./r2";
import { createWikiTools } from "./tools/wiki-tools";
import { createSourceTools } from "./tools/source-tools";
import { createSchemaTools } from "./tools/schema-tools";
import { createLogTools } from "./tools/log-tools";
import { createConfigTools } from "./tools/config-tools";

type WikiState = {
  wikiId: string;
  pageCount: number;
  sourceCount: number;
  lastActivity: string;
  currentOperation: string | null;
  pageIndex: Array<{
    id: string;
    title: string;
    category: string;
    summary: string | null;
  }>;
};

interface Env {
  AI: Ai;
  WIKI_BUCKET: R2Bucket;
  AI_GATEWAY_ID?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

export class WikiAgent extends AIChatAgent<Env, WikiState> {
  initialState: WikiState = {
    wikiId: "default",
    pageCount: 0,
    sourceCount: 0,
    lastActivity: new Date().toISOString(),
    currentOperation: null,
    pageIndex: [],
  };

  async onStart() {
    initDb(this.sql);
    this.syncStateFromDb();
  }

  private syncStateFromDb() {
    const pages =
      this.sql<{ id: string; title: string; category: string; summary: string | null }>`SELECT id, title, category, summary FROM wiki_pages ORDER BY updated_at DESC`;
    const sourceCount =
      this.sql<{ count: number }>`SELECT COUNT(*) as count FROM sources`;

    this.setState({
      ...this.state,
      pageCount: pages.length,
      sourceCount: sourceCount[0]?.count ?? 0,
      lastActivity: new Date().toISOString(),
      pageIndex: pages,
    });
  }

  private getModelConfig(tier: "fast" | "capable"): ModelConfigRow {
    const rows =
      this.sql<ModelConfigRow>`SELECT * FROM model_config WHERE key = ${tier}`;
    if (rows.length === 0) {
      return {
        key: tier,
        provider: "workers-ai",
        model: "@cf/meta/llama-4-scout-17b-16e-instruct",
        gateway_enabled: 0,
      };
    }
    return rows[0];
  }

  async onChatMessage(
    onFinish?: Parameters<AIChatAgent<Env, WikiState>["onChatMessage"]>[0],
    options?: Parameters<AIChatAgent<Env, WikiState>["onChatMessage"]>[1],
  ) {
    const wikiId = this.state.wikiId;
    const bucket = this.env.WIKI_BUCKET;

    // Read schema for system prompt
    const schemaContent = await r2Read(bucket, `${wikiId}/wiki/schema.md`);
    const systemPrompt = buildSystemPrompt(wikiId, schemaContent);

    // Build tool context
    const toolCtx = {
      bucket,
      sql: this.sql,
      wikiId,
      onPagesChanged: () => this.syncStateFromDb(),
    };

    const capableConfig = this.getModelConfig("capable");
    const model = resolveModel(capableConfig, this.env);

    // Handle file uploads from options.body
    const body = options?.body as
      | { file?: { name: string; content: string } }
      | undefined;
    let extraMessages: Array<{ role: "user"; content: string }> = [];
    if (body?.file) {
      extraMessages = [
        {
          role: "user",
          content: `[File uploaded: ${body.file.name}]\n\nContent:\n${body.file.content}`,
        },
      ];
    }

    const allTools = {
      ...createWikiTools(toolCtx),
      ...createSourceTools(toolCtx),
      ...createSchemaTools(toolCtx),
      ...createLogTools(toolCtx),
      ...createConfigTools(toolCtx),
    };

    const result = streamText({
      model,
      system: systemPrompt,
      messages: [
        ...(await convertToModelMessages(this.messages)),
        ...extraMessages,
      ],
      tools: allTools,
      maxSteps: 15,
      onFinish: async (result) => {
        this.syncStateFromDb();
        if (onFinish) {
          await onFinish(result);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/wiki-agent.ts
git commit -m "feat: add WikiAgent class with tools, model routing, and state sync"
```

---

## Task 11: Worker Entry Point

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Create server entry point**

```typescript
// src/server.ts

import { routeAgentRequest } from "agents";

export { WikiAgent } from "./agent/wiki-agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Verify the server compiles**

Run: `npx tsc --noEmit`
Expected: No type errors. (If `env.d.ts` hasn't been regenerated, run `npm run types` first.)

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add worker entry point with agent routing"
```

---

## Task 12: Frontend — App Shell & Styles

**Files:**
- Create: `src/client.tsx`, `src/app/App.tsx`, `src/app/styles.css`

- [ ] **Step 1: Create React entry point**

```tsx
// src/client.tsx

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: Create styles**

```css
/* src/app/styles.css */

@import "tailwindcss";

body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 3: Create App shell**

```tsx
// src/app/App.tsx

import { useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { PageViewer } from "./components/PageViewer";

type WikiState = {
  wikiId: string;
  pageCount: number;
  sourceCount: number;
  lastActivity: string;
  currentOperation: string | null;
  pageIndex: Array<{
    id: string;
    title: string;
    category: string;
    summary: string | null;
  }>;
};

export default function App() {
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string | null>(null);

  const agent = useAgent<WikiState>({
    agent: "WikiAgent",
  });

  const chat = useAgentChat({ agent });

  const wikiState = agent.state;

  const handlePageSelect = async (pageId: string) => {
    setSelectedPage(pageId);
    // Fetch page content by sending a read request through chat
    // For now, we'll use a simple approach — the user asks to view a page
    setPageContent(null);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        pageIndex={wikiState?.pageIndex ?? []}
        pageCount={wikiState?.pageCount ?? 0}
        sourceCount={wikiState?.sourceCount ?? 0}
        currentOperation={wikiState?.currentOperation ?? null}
        selectedPage={selectedPage}
        onPageSelect={handlePageSelect}
      />

      <div className="flex flex-1 min-w-0">
        <ChatPanel chat={chat} agent={agent} />

        {selectedPage && (
          <PageViewer
            pageId={selectedPage}
            content={pageContent}
            onClose={() => {
              setSelectedPage(null);
              setPageContent(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/client.tsx src/app/App.tsx src/app/styles.css
git commit -m "feat: add React app shell with layout"
```

---

## Task 13: Frontend — ChatPanel Component

**Files:**
- Create: `src/app/components/ChatPanel.tsx`

- [ ] **Step 1: Create ChatPanel**

```tsx
// src/app/components/ChatPanel.tsx

import { useState, useRef, useEffect } from "react";
import type { useAgentChat } from "@cloudflare/ai-chat/react";

type ChatPanelProps = {
  chat: ReturnType<typeof useAgentChat>;
  agent: { setState: (state: unknown) => void };
};

export function ChatPanel({ chat }: ChatPanelProps) {
  const { messages, sendMessage, clearHistory, status } = chat;
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      sendMessage({
        text: `Please ingest this file: ${file.name}`,
        body: { file: { name: file.name, content } },
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <h2 className="text-xl font-semibold mb-2">LLM Wiki</h2>
            <p>Upload sources, ask questions, or request a wiki lint.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200"
              }`}
            >
              {msg.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <div key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  return (
                    <details
                      key={part.toolCallId}
                      className="text-xs text-gray-500 mt-1"
                    >
                      <summary className="cursor-pointer">
                        🔧 {part.toolName}
                        {part.state === "result" ? " ✓" : " ..."}
                      </summary>
                      {part.state === "result" && (
                        <pre className="mt-1 overflow-x-auto">
                          {JSON.stringify(part.result, null, 2)}
                        </pre>
                      )}
                    </details>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {status === "streaming" && (
          <div className="text-gray-400 text-sm">Agent is thinking...</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <label className="flex items-center cursor-pointer text-gray-400 hover:text-gray-600">
            <span className="text-xl">📎</span>
            <input
              type="file"
              className="hidden"
              accept=".md,.txt,.pdf,.json,.csv"
              onChange={handleFileUpload}
            />
          </label>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question, paste a source, or request a lint..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={status === "streaming"}
          />

          <button
            type="submit"
            disabled={status === "streaming" || !input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>

          <button
            type="button"
            onClick={clearHistory}
            className="text-gray-400 hover:text-gray-600 px-2"
            title="Clear chat history"
          >
            🗑️
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/ChatPanel.tsx
git commit -m "feat: add ChatPanel component with streaming and file upload"
```

---

## Task 14: Frontend — Sidebar Component

**Files:**
- Create: `src/app/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar**

```tsx
// src/app/components/Sidebar.tsx

type PageEntry = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
};

type SidebarProps = {
  pageIndex: PageEntry[];
  pageCount: number;
  sourceCount: number;
  currentOperation: string | null;
  selectedPage: string | null;
  onPageSelect: (pageId: string) => void;
};

export function Sidebar({
  pageIndex,
  pageCount,
  sourceCount,
  currentOperation,
  selectedPage,
  onPageSelect,
}: SidebarProps) {
  const categories = ["entity", "concept", "topic", "source"] as const;

  const grouped = categories.reduce(
    (acc, cat) => {
      acc[cat] = pageIndex.filter((p) => p.category === cat);
      return acc;
    },
    {} as Record<string, PageEntry[]>,
  );

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold">LLM Wiki</h1>
        <div className="text-xs text-gray-500 mt-1">
          {pageCount} pages · {sourceCount} sources
        </div>
        {currentOperation && (
          <div className="text-xs text-blue-600 mt-1 animate-pulse">
            {currentOperation}
          </div>
        )}
      </div>

      {/* Page list */}
      <div className="flex-1 overflow-y-auto p-2">
        {pageIndex.length === 0 ? (
          <div className="text-sm text-gray-400 p-2">
            No pages yet. Start by uploading a source.
          </div>
        ) : (
          categories.map((cat) => {
            const pages = grouped[cat];
            if (pages.length === 0) return null;

            return (
              <div key={cat} className="mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase px-2 py-1">
                  {cat}s ({pages.length})
                </div>
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => onPageSelect(page.id)}
                    className={`w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 truncate ${
                      selectedPage === page.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700"
                    }`}
                    title={page.summary ?? page.title}
                  >
                    {page.title}
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "feat: add Sidebar component with categorized page list"
```

---

## Task 15: Frontend — PageViewer Component

**Files:**
- Create: `src/app/components/PageViewer.tsx`

- [ ] **Step 1: Create PageViewer**

```tsx
// src/app/components/PageViewer.tsx

import ReactMarkdown from "react-markdown";

type PageViewerProps = {
  pageId: string;
  content: string | null;
  onClose: () => void;
};

export function PageViewer({ pageId, content, onClose }: PageViewerProps) {
  return (
    <div className="w-1/2 border-l border-gray-200 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700 truncate">
          {pageId}
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {content ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">
            Ask the agent to show this page: "Show me the page {pageId}"
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/PageViewer.tsx
git commit -m "feat: add PageViewer component with markdown rendering"
```

---

## Task 16: Frontend — FileUpload & WikiSelector

**Files:**
- Create: `src/app/components/FileUpload.tsx`, `src/app/components/WikiSelector.tsx`

- [ ] **Step 1: Create FileUpload component**

File upload is already handled inline in ChatPanel. Create a standalone drag-and-drop component for the sidebar:

```tsx
// src/app/components/FileUpload.tsx

import { useCallback, useState } from "react";

type FileUploadProps = {
  onFileSelected: (file: { name: string; content: string }) => void;
};

export function FileUpload({ onFileSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        onFileSelected({
          name: file.name,
          content: reader.result as string,
        });
      };
      reader.readAsText(file);
    },
    [onFileSelected],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
        isDragging
          ? "border-blue-500 bg-blue-50 text-blue-600"
          : "border-gray-300 text-gray-400 hover:border-gray-400"
      }`}
    >
      Drop a file here to ingest
    </div>
  );
}
```

- [ ] **Step 2: Create WikiSelector component**

```tsx
// src/app/components/WikiSelector.tsx

import { useState } from "react";

type WikiSelectorProps = {
  currentWikiId: string;
  onWikiChange: (wikiId: string) => void;
};

export function WikiSelector({
  currentWikiId,
  onWikiChange,
}: WikiSelectorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentWikiId);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentWikiId) {
      onWikiChange(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex gap-1"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-24"
          autoFocus
          onBlur={handleSubmit}
        />
      </form>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="text-xs text-gray-500 hover:text-gray-700"
      title="Click to switch wiki"
    >
      Wiki: {currentWikiId}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/FileUpload.tsx src/app/components/WikiSelector.tsx
git commit -m "feat: add FileUpload and WikiSelector components"
```

---

## Task 17: Verify End-to-End

- [ ] **Step 1: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev`
Expected: Vite dev server starts, outputs a local URL (e.g., `http://localhost:5173`). The page loads in a browser showing the LLM Wiki layout with sidebar and chat panel.

- [ ] **Step 3: Test basic chat**

Open the app in a browser. Type "Hello" in the chat input and send. The agent should respond via Workers AI streaming. (Requires Cloudflare account — `wrangler login` if not already authenticated.)

- [ ] **Step 4: Test source upload**

Upload a small `.md` or `.txt` file via the file upload button. The agent should save it to R2 and begin ingesting.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: LLM Wiki agent — initial working version"
```

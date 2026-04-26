# Wiki Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users browse wiki pages and sources directly from the sidebar without going through the chat agent — clicking a page fetches its markdown from R2 and renders it immediately.

**Architecture:** Add REST API endpoints to `server.ts` that serve R2 content directly (`GET /api/wiki/:path` and `GET /api/sources/:filename`). Wire the sidebar and PageViewer to fetch content on click. Add a sources list to the sidebar. The agent WebSocket is untouched — these are independent HTTP routes handled before `routeAgentRequest`.

**Tech Stack:** Cloudflare Workers (R2 bucket), React (existing components), react-markdown (already installed), Tailwind CSS (existing)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/server.ts` | Modify | Add REST routes for `/api/wiki/*` and `/api/sources/*` before `routeAgentRequest` |
| `src/app/App.tsx` | Modify | Fetch page/source content on sidebar click, pass to PageViewer |
| `src/app/components/Sidebar.tsx` | Modify | Add sources section, add active styling for sources |
| `src/app/components/PageViewer.tsx` | Modify | Remove "ask the agent" fallback, show loading state, handle sources |

---

### Task 1: REST API endpoints in the Worker

**Files:**
- Modify: `src/server.ts`

The Worker's `fetch` handler currently only does `routeAgentRequest`. We add two GET endpoints before that call. `routeAgentRequest` returns `undefined` for non-agent paths, so our routes simply go first. The wikiId is hardcoded to `"default"` for now (matching the agent's `initialState.wikiId`).

- [ ] **Step 1: Add wiki page endpoint**

```ts
// src/server.ts
import { routeAgentRequest } from "agents";

export { WikiAgent } from "./agent/wiki-agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // REST API: read a wiki page directly from R2
    if (request.method === "GET" && url.pathname.startsWith("/api/wiki/")) {
      const pagePath = url.pathname.slice("/api/wiki/".length);
      if (!pagePath) return new Response("Missing page path", { status: 400 });
      const key = `default/wiki/${pagePath}.md`;
      const obj = await env.WIKI_BUCKET.get(key);
      if (!obj) return new Response("Page not found", { status: 404 });
      const text = await obj.text();
      return new Response(text, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    // REST API: read a source file directly from R2
    if (request.method === "GET" && url.pathname.startsWith("/api/sources/")) {
      const filename = url.pathname.slice("/api/sources/".length);
      if (!filename) return new Response("Missing filename", { status: 400 });
      const key = `default/sources/${filename}`;
      const obj = await env.WIKI_BUCKET.get(key);
      if (!obj) return new Response("Source not found", { status: 404 });
      const text = await obj.text();
      return new Response(text, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Verify the endpoints work**

Run: `npm run dev`

In another terminal, test with curl after uploading at least one source/page via chat:
```bash
# Should return markdown content
curl -s http://localhost:5173/api/wiki/index
# Should return 404
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/wiki/nonexistent
```

Expected: 200 with markdown body for existing pages, 404 for missing ones.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add REST endpoints to browse wiki pages and sources"
```

---

### Task 2: Fetch and display page content on sidebar click

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/components/PageViewer.tsx`

Currently `handlePageSelect` sets the selected page ID but never fetches content — the PageViewer shows "Ask the agent to show this page". We fetch from the new REST endpoint instead.

- [ ] **Step 1: Fetch page content in App.tsx on click**

In `src/app/App.tsx`, update `handlePageSelect` to fetch from the REST API:

```tsx
const handlePageSelect = async (pageId: string) => {
  setSelectedPage(pageId);
  setPageContent(null);
  try {
    const res = await fetch(`/api/wiki/${pageId}`);
    if (res.ok) {
      setPageContent(await res.text());
    }
  } catch {
    // Leave content null — PageViewer will show error state
  }
};
```

- [ ] **Step 2: Update PageViewer to show loading and error states**

In `src/app/components/PageViewer.tsx`, replace the "Ask the agent" fallback with a loading spinner and an error state:

```tsx
import ReactMarkdown from "react-markdown";

type PageViewerProps = {
  pageId: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
};

export function PageViewer({ pageId, content, loading, onClose }: PageViewerProps) {
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
        {loading ? (
          <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
        ) : content ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">
            Could not load this page.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the loading prop through App.tsx**

In `src/app/App.tsx`, add a `loading` state and pass it to PageViewer:

```tsx
const [pageLoading, setPageLoading] = useState(false);

const handlePageSelect = async (pageId: string) => {
  setSelectedPage(pageId);
  setPageContent(null);
  setPageLoading(true);
  try {
    const res = await fetch(`/api/wiki/${pageId}`);
    if (res.ok) {
      setPageContent(await res.text());
    }
  } finally {
    setPageLoading(false);
  }
};

// In the JSX:
{selectedPage && (
  <PageViewer
    pageId={selectedPage}
    content={pageContent}
    loading={pageLoading}
    onClose={() => {
      setSelectedPage(null);
      setPageContent(null);
    }}
  />
)}
```

- [ ] **Step 4: Verify page browsing works**

Run: `npm run dev`

1. Open the app, ingest a source via chat so pages exist
2. Click a page in the sidebar
3. The PageViewer should show "Loading…" briefly, then render the markdown

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/app/components/PageViewer.tsx
git commit -m "feat: fetch and render wiki pages on sidebar click"
```

---

### Task 3: Add sources to the sidebar

**Files:**
- Modify: `src/agent/wiki-agent.ts` (add source list to WikiState sync)
- Modify: `src/app/App.tsx` (pass sources and handle source selection)
- Modify: `src/app/components/Sidebar.tsx` (render sources section)

Currently the sidebar only shows wiki pages. Sources are only accessible via the agent's `listSources` tool. We add them to the synced WikiState so the sidebar can list them, and clicking a source fetches from `/api/sources/`.

- [ ] **Step 1: Add source index to WikiState**

In `src/agent/wiki-agent.ts`, add `sourceIndex` to the `WikiState` type and sync it in `syncStateFromDb`:

```ts
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
  sourceIndex: Array<{
    id: string;
    filename: string;
    status: string;
  }>;
};
```

Update `initialState`:
```ts
initialState: WikiState = {
  wikiId: "default",
  pageCount: 0,
  sourceCount: 0,
  lastActivity: new Date().toISOString(),
  currentOperation: null,
  pageIndex: [],
  sourceIndex: [],
};
```

Update `syncStateFromDb`:
```ts
private syncStateFromDb() {
  const pages =
    this.sql<{ id: string; title: string; category: string; summary: string | null }>`SELECT id, title, category, summary FROM wiki_pages ORDER BY updated_at DESC`;
  const sources =
    this.sql<{ id: string; filename: string; status: string }>`SELECT id, filename, status FROM sources ORDER BY rowid DESC`;

  this.setState({
    ...this.state,
    pageCount: pages.length,
    sourceCount: sources.length,
    lastActivity: new Date().toISOString(),
    pageIndex: pages,
    sourceIndex: sources,
  });
}
```

- [ ] **Step 2: Update Sidebar to show sources**

In `src/app/components/Sidebar.tsx`, add props for sources and a selected source, and render a "Sources" section below the wiki categories:

```tsx
type SourceEntry = {
  id: string;
  filename: string;
  status: string;
};

type SidebarProps = {
  pageIndex: PageEntry[];
  pageCount: number;
  sourceCount: number;
  sourceIndex: SourceEntry[];
  currentOperation: string | null;
  selectedPage: string | null;
  selectedSource: string | null;
  onPageSelect: (pageId: string) => void;
  onSourceSelect: (filename: string) => void;
};
```

Add the sources section at the bottom of the scrollable area (after the page categories loop):

```tsx
{/* Sources */}
{sourceIndex.length > 0 && (
  <div className="mb-3 mt-4 border-t border-gray-200 pt-3">
    <div className="text-xs font-semibold text-gray-500 uppercase px-2 py-1">
      Sources ({sourceIndex.length})
    </div>
    {sourceIndex.map((source) => (
      <button
        key={source.id}
        onClick={() => onSourceSelect(source.filename)}
        className={`w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 truncate ${
          selectedSource === source.filename
            ? "bg-blue-50 text-blue-700"
            : "text-gray-700"
        }`}
        title={`${source.filename} (${source.status})`}
      >
        <span className="mr-1">{source.status === "ingested" ? "✓" : "○"}</span>
        {source.filename}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Wire source selection through App.tsx**

In `src/app/App.tsx`, add state for selected source, a handler that fetches from `/api/sources/`, and pass everything to Sidebar and PageViewer. When a source is selected, deselect any page (and vice versa):

```tsx
const [selectedSource, setSelectedSource] = useState<string | null>(null);

const handlePageSelect = async (pageId: string) => {
  setSelectedPage(pageId);
  setSelectedSource(null);
  setPageContent(null);
  setPageLoading(true);
  try {
    const res = await fetch(`/api/wiki/${pageId}`);
    if (res.ok) {
      setPageContent(await res.text());
    }
  } finally {
    setPageLoading(false);
  }
};

const handleSourceSelect = async (filename: string) => {
  setSelectedSource(filename);
  setSelectedPage(null);
  setPageContent(null);
  setPageLoading(true);
  try {
    const res = await fetch(`/api/sources/${filename}`);
    if (res.ok) {
      setPageContent(await res.text());
    }
  } finally {
    setPageLoading(false);
  }
};
```

Pass to Sidebar:
```tsx
<Sidebar
  pageIndex={wikiState?.pageIndex ?? []}
  pageCount={wikiState?.pageCount ?? 0}
  sourceCount={wikiState?.sourceCount ?? 0}
  sourceIndex={wikiState?.sourceIndex ?? []}
  currentOperation={wikiState?.currentOperation ?? null}
  selectedPage={selectedPage}
  selectedSource={selectedSource}
  onPageSelect={handlePageSelect}
  onSourceSelect={handleSourceSelect}
/>
```

Update PageViewer to show either page or source:
```tsx
{(selectedPage || selectedSource) && (
  <PageViewer
    pageId={selectedPage ?? selectedSource!}
    content={pageContent}
    loading={pageLoading}
    onClose={() => {
      setSelectedPage(null);
      setSelectedSource(null);
      setPageContent(null);
    }}
  />
)}
```

- [ ] **Step 4: Verify sources appear and are browsable**

Run: `npm run dev`

1. Upload a source via chat
2. The sidebar should show a "Sources" section with the filename and a status indicator
3. Clicking the source should open it in the PageViewer with rendered markdown

- [ ] **Step 5: Commit**

```bash
git add src/agent/wiki-agent.ts src/app/App.tsx src/app/components/Sidebar.tsx
git commit -m "feat: add source browsing to sidebar"
```

---

### Task 4: Auto-refresh PageViewer when agent updates a page

**Files:**
- Modify: `src/app/App.tsx`

When the agent writes or updates a wiki page during chat, the PageViewer should refresh if that page is currently selected. The agent already syncs `pageIndex` via `setState` after every tool call, so we can use a React effect that re-fetches when the page's `updated_at` changes (or more simply, whenever `pageIndex` changes and a page is selected).

- [ ] **Step 1: Add effect to re-fetch on state change**

In `src/app/App.tsx`, add a `useEffect` that re-fetches the selected page whenever `wikiState?.pageIndex` changes:

```tsx
useEffect(() => {
  if (!selectedPage) return;
  // Re-fetch the currently viewed page in case the agent updated it
  fetch(`/api/wiki/${selectedPage}`)
    .then((res) => (res.ok ? res.text() : null))
    .then((text) => {
      if (text !== null) setPageContent(text);
    });
}, [wikiState?.pageIndex, selectedPage]);
```

- [ ] **Step 2: Do the same for sources**

```tsx
useEffect(() => {
  if (!selectedSource) return;
  fetch(`/api/sources/${selectedSource}`)
    .then((res) => (res.ok ? res.text() : null))
    .then((text) => {
      if (text !== null) setPageContent(text);
    });
}, [wikiState?.sourceIndex, selectedSource]);
```

- [ ] **Step 3: Verify live refresh**

Run: `npm run dev`

1. Click a page in the sidebar to open it
2. In the chat, tell the agent to update that page (e.g. "Add a new section to the overview page")
3. The PageViewer should update automatically when the agent finishes writing

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat: auto-refresh page viewer when agent updates content"
```

---

### Task 5: Handle wiki-links in rendered markdown

**Files:**
- Modify: `src/app/components/PageViewer.tsx`
- Modify: `src/app/App.tsx`

Wiki pages contain cross-references as markdown links like `[Some Entity](entities/some-entity)`. When rendered in the PageViewer, clicking these should navigate within the wiki browser (load that page), not trigger a browser navigation.

- [ ] **Step 1: Add onNavigate prop and custom link renderer to PageViewer**

In `src/app/components/PageViewer.tsx`, add an `onNavigate` callback and a custom `a` component for react-markdown that intercepts internal wiki links:

```tsx
type PageViewerProps = {
  pageId: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
  onNavigate: (pageId: string) => void;
};

export function PageViewer({ pageId, content, loading, onClose, onNavigate }: PageViewerProps) {
  const linkRenderer = ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
    // Internal wiki links: relative paths without protocol
    if (href && !href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("#")) {
      return (
        <a
          {...props}
          href={href}
          className="text-blue-600 hover:underline cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            // Strip .md extension if present
            const target = href.replace(/\.md$/, "");
            onNavigate(target);
          }}
        >
          {children}
        </a>
      );
    }
    // External links: open in new tab
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };

  return (
    <div className="w-1/2 border-l border-gray-200 bg-white flex flex-col">
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

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
        ) : content ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown components={{ a: linkRenderer }}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">
            Could not load this page.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass onNavigate from App.tsx**

In `src/app/App.tsx`, pass `handlePageSelect` as the `onNavigate` prop:

```tsx
<PageViewer
  pageId={selectedPage ?? selectedSource!}
  content={pageContent}
  loading={pageLoading}
  onClose={() => {
    setSelectedPage(null);
    setSelectedSource(null);
    setPageContent(null);
  }}
  onNavigate={handlePageSelect}
/>
```

- [ ] **Step 3: Verify wiki-link navigation**

Run: `npm run dev`

1. Ingest a source that creates multiple interlinked pages
2. Open a page in the PageViewer
3. Click a wiki-link (e.g. a cross-reference to another entity)
4. The PageViewer should load the linked page; the sidebar selection should update

- [ ] **Step 4: Commit**

```bash
git add src/app/components/PageViewer.tsx src/app/App.tsx
git commit -m "feat: support wiki-link navigation in page viewer"
```

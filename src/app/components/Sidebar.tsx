import { useMemo, useState } from "react";

type PageEntry = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
};

type SourceEntry = {
  id: string;
  filename: string;
  status: string;
  source_type: string;
  source_url: string | null;
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

export function Sidebar({
  pageIndex,
  pageCount,
  sourceCount,
  sourceIndex,
  currentOperation,
  selectedPage,
  selectedSource,
  onPageSelect,
  onSourceSelect,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const categories = ["entity", "concept", "topic", "source"] as const;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPages = useMemo(
    () =>
      normalizedQuery
        ? pageIndex.filter((page) =>
            [page.title, page.summary ?? "", page.category].some((value) =>
              value.toLowerCase().includes(normalizedQuery),
            ),
          )
        : pageIndex,
    [normalizedQuery, pageIndex],
  );
  const filteredSources = useMemo(
    () =>
      normalizedQuery
        ? sourceIndex.filter((source) =>
            [source.filename, source.source_type, source.source_url ?? "", source.status].some(
              (value) => value.toLowerCase().includes(normalizedQuery),
            ),
          )
        : sourceIndex,
    [normalizedQuery, sourceIndex],
  );
  const grouped = useMemo(
    () =>
      categories.reduce(
        (acc, cat) => {
          acc[cat] = filteredPages.filter((page) => page.category === cat);
          return acc;
        },
        {} as Record<string, PageEntry[]>,
      ),
    [categories, filteredPages],
  );
  const hasResults = filteredPages.length > 0 || filteredSources.length > 0;

  return (
    <aside className="flex h-full w-[21rem] shrink-0 flex-col border-r border-slate-200/80 bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
          Knowledge workspace
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">LLM Wiki</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Explore pages, inspect sources, and keep the wiki synced with your latest context.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Pages</div>
            <div className="mt-1 text-lg font-semibold text-white">{pageCount}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Sources</div>
            <div className="mt-1 text-lg font-semibold text-white">{sourceCount}</div>
          </div>
        </div>
        {currentOperation && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
            {currentOperation}
          </div>
        )}
      </div>

      <div className="border-b border-white/10 px-5 py-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Search library
        </label>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find pages or sources"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!hasResults ? (
          <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-sm text-slate-400">
            {pageIndex.length === 0 && sourceIndex.length === 0
              ? "No pages yet. Upload or ingest a source to seed the wiki."
              : "No matching pages or sources for this search."}
          </div>
        ) : (
          categories.map((cat) => {
            const pages = grouped[cat];
            if (pages.length === 0) return null;

            return (
              <section key={cat} className="mb-4 rounded-3xl border border-white/8 bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between px-1 py-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {cat}s
                  </div>
                  <div className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-medium text-slate-300">
                    {pages.length}
                  </div>
                </div>
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => onPageSelect(page.id)}
                    className={`mb-1 w-full rounded-2xl border px-3 py-2 text-left transition hover:border-sky-300/40 hover:bg-white/10 ${
                      selectedPage === page.id
                        ? "border-sky-300/40 bg-sky-400/15 text-white shadow-[0_10px_24px_rgba(14,165,233,0.18)]"
                        : "border-transparent text-slate-200"
                    }`}
                    title={page.summary ?? page.title}
                  >
                    <div className="truncate text-sm font-medium">{page.title}</div>
                    {page.summary && (
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                        {page.summary}
                      </div>
                    )}
                  </button>
                ))}
              </section>
            );
          })
        )}

        {filteredSources.length > 0 && (
          <section className="mt-5 rounded-3xl border border-white/8 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between px-1 py-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Sources
              </div>
              <div className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-medium text-slate-300">
                {filteredSources.length}
              </div>
            </div>
            {filteredSources.map((source) => {
              const typeIcon =
                source.source_type === "pdf" ? "📄"
                : source.source_type === "url" ? "🔗"
                  : "📝";
              const statusIcon =
                source.status === "ingested" ? "✓"
                : source.status === "failed" ? "✗"
                : "○";
              return (
                <div
                  key={source.id}
                  className={`mb-1 flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition hover:border-sky-300/40 hover:bg-white/10 ${
                    selectedSource === source.filename
                      ? "border-sky-300/40 bg-sky-400/15 text-white shadow-[0_10px_24px_rgba(14,165,233,0.18)]"
                      : "border-transparent text-slate-200"
                   }`}
                >
                  <span className="text-slate-400">{statusIcon}</span>
                  <span title={source.source_type} className="text-base leading-none">
                    {typeIcon}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSourceSelect(source.filename)}
                    className="flex-1 text-left"
                    title={source.source_url ?? `${source.filename} (${source.status})`}
                  >
                    <div className="truncate font-medium">{source.filename}</div>
                    <div className="text-xs text-slate-400">
                      {source.source_type} · {source.status}
                    </div>
                  </button>
                  <a
                    href={`/api/originals/${encodeURIComponent(source.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-400 transition hover:text-sky-200"
                    title="Open original"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </aside>
  );
}

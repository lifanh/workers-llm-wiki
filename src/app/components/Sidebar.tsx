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

        {sourceIndex.length > 0 && (
          <div className="mb-3 mt-4 border-t border-gray-200 pt-3">
            <div className="text-xs font-semibold text-gray-500 uppercase px-2 py-1">
              Sources ({sourceIndex.length})
            </div>
            {sourceIndex.map((source) => {
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
                  className={`flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-100 ${
                    selectedSource === source.filename
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700"
                  }`}
                >
                  <span className="text-gray-400">{statusIcon}</span>
                  <span title={source.source_type} className="text-base leading-none">
                    {typeIcon}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSourceSelect(source.filename)}
                    className="flex-1 text-left truncate hover:underline"
                    title={source.source_url ?? `${source.filename} (${source.status})`}
                  >
                    {source.filename}
                  </button>
                  <a
                    href={`/api/originals/${encodeURIComponent(source.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-600"
                    title="Open original"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

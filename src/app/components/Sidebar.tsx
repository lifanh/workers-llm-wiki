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

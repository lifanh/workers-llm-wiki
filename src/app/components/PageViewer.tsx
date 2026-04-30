import ReactMarkdown from "react-markdown";

type PageViewerProps = {
  pageId: string;
  title: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
  onNavigate: (pageId: string) => void;
};

export function PageViewer({ pageId, title, content, loading, onClose, onNavigate }: PageViewerProps) {
  return (
    <aside className="flex w-[44%] min-w-[24rem] flex-col border-l border-slate-200/70 bg-slate-50/80 backdrop-blur">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
            Document viewer
          </div>
          <h2 className="mt-2 truncate text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{pageId}</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-lg text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {content ? (
          <div className="prose prose-sm max-w-none rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.06)] prose-headings:text-slate-900 prose-pre:bg-slate-950 prose-pre:text-slate-50">
            <ReactMarkdown
              components={{
                a: ({ href, children, ...props }) => {
                  if (href && !href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("#")) {
                    return (
                      <a
                        {...props}
                        href={href}
                        className="text-blue-600 hover:underline cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigate(href.replace(/\.md$/, ""));
                        }}
                      >
                        {children}
                      </a>
                    );
                  }
                  return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : loading ? (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white/80 px-6 py-10 text-center text-sm text-slate-500">
            <div className="text-3xl">⏳</div>
            <div className="mt-3 animate-pulse">Loading document…</div>
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white/80 px-6 py-10 text-center text-sm text-slate-500">
            <div className="text-3xl">📄</div>
            <div className="mt-3">Could not load this page.</div>
          </div>
        )}
      </div>
    </aside>
  );
}

import ReactMarkdown from "react-markdown";

type PageViewerProps = {
  pageId: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
  onNavigate: (pageId: string) => void;
};

export function PageViewer({ pageId, content, loading, onClose, onNavigate }: PageViewerProps) {
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
          <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
        ) : (
          <div className="text-gray-400 text-sm">Could not load this page.</div>
        )}
      </div>
    </div>
  );
}

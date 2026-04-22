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

import { useState, useRef, useEffect } from "react";
import type { useAgentChat } from "@cloudflare/ai-chat/react";
import ReactMarkdown from "react-markdown";

type ChatPanelProps = {
  chat: ReturnType<typeof useAgentChat>;
};

export function ChatPanel({ chat }: ChatPanelProps) {
  const { messages, sendMessage, clearHistory, status } = chat;
  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      alert(`"${file.name}" is too large (max 25 MB).`);
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ingest/file", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; source: { id: string; filename: string; status: string } }
        | { ok: false; error: string };
      if (!data.ok) {
        alert(`Failed to ingest "${file.name}": ${data.error}`);
        return;
      }
      sendMessage({
        text: `Ingested file "${data.source.filename}" (id: ${data.source.id}, status: ${data.source.status}). Please review and proceed.`,
      });
    } catch (err) {
      alert(
        `Failed to ingest "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsUploading(false);
    }
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

        {messages.map((msg: any) => (
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
              {msg.parts.map((part: any, i: any) => {
                if (part.type === "text") {
                  if (msg.role === "user") {
                    return (
                      <div key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className="prose prose-sm max-w-none prose-pre:bg-gray-100 prose-pre:text-gray-800 prose-p:my-2 prose-headings:my-3"
                    >
                      <ReactMarkdown
                        components={{
                          a: ({ href, children, ...props }) => (
                            <a
                              {...props}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {part.text}
                      </ReactMarkdown>
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
          <label className={`flex items-center cursor-pointer ${isUploading ? "opacity-50 pointer-events-none" : "text-gray-400 hover:text-gray-600"}`}>
            <span className="text-xl">📎</span>
            <input
              type="file"
              className="hidden"
              accept=".md,.txt,.json,.csv,.pdf,text/*,application/pdf"
              onChange={handleFileUpload}
              disabled={isUploading}
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

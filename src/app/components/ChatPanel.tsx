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
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const starterPrompts = [
    "List all pages",
    "Summarize the current wiki",
    "Run a lint check",
    "Suggest missing topics",
  ];

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

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlValue.trim();
    if (!url) return;
    setIsIngestingUrl(true);
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as
        | { ok: true; source: { id: string; filename: string; status: string; source_url: string } }
        | { ok: false; error: string };
      if (!data.ok) {
        alert(`Failed to ingest URL: ${data.error}`);
        return;
      }
      sendMessage({
        text: `Ingested URL "${data.source.source_url}" as source ${data.source.id} (status: ${data.source.status}). Please review and proceed.`,
      });
      setUrlValue("");
      setUrlInputOpen(false);
    } catch (err) {
      alert(`Failed to ingest URL: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsIngestingUrl(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-transparent">
      <div className="border-b border-slate-200/70 bg-white/80 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Conversational workspace
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Chat with your wiki
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Ingest sources, ask questions, and let the agent keep the knowledge base organized.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "streaming" ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
              }`}
            />
            {status === "streaming" ? "Responding" : "Ready"}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-3xl rounded-[2rem] border border-slate-200 bg-white/85 p-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 text-3xl">
              ✨
            </div>
            <h3 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
              Turn raw material into a living wiki
            </h3>
            <p className="mt-3 text-base leading-7 text-slate-500">
              Upload notes, ingest a URL, or ask the agent to summarize, lint, or expand your current knowledge base.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg: any) => (
          <div
            key={msg.id}
            className={`mb-5 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`flex max-w-[85%] gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : "bg-sky-100 text-sky-700"
                }`}
              >
                {msg.role === "user" ? "You" : "AI"}
              </div>
              <div
                className={`rounded-[1.5rem] border px-5 py-4 shadow-sm ${
                  msg.role === "user"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white/90 text-slate-800"
                }`}
              >
              {msg.parts.map((part: any, i: any) => {
                if (part.type === "text") {
                  if (msg.role === "user") {
                    return (
                      <div key={i} className="whitespace-pre-wrap leading-7">
                        {part.text}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className="prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:my-2 prose-pre:bg-slate-950 prose-pre:text-slate-50 prose-strong:text-slate-900"
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
                        <pre className="mt-2 overflow-x-auto rounded-2xl bg-slate-950/90 p-3 text-slate-50">
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
          </div>
        ))}

        {status === "streaming" && (
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            Agent is thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200/70 bg-white/85 px-6 py-5 backdrop-blur">
        {urlInputOpen && (
          <form
            onSubmit={handleUrlSubmit}
            className="mb-4 flex gap-2 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-3"
          >
            <input
              type="url"
              placeholder="https://example.com/article"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              disabled={isIngestingUrl}
              autoFocus
            />
            <button
              type="submit"
              disabled={isIngestingUrl || !urlValue.trim()}
              className="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isIngestingUrl ? "Ingesting..." : "Ingest"}
            </button>
          </form>
        )}
        <div className="mb-3 flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setInput(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-3 rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.06)]"
        >
          <button
            type="button"
            onClick={() => setUrlInputOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
            title="Ingest a web URL"
            disabled={isIngestingUrl}
          >
            🔗
          </button>
          <label
            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 ${
              isUploading ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <span>📎</span>
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
            className="min-w-[16rem] flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            disabled={status === "streaming"}
          />

          <button
            type="submit"
            disabled={status === "streaming" || !input.trim()}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>

          <button
            type="button"
            onClick={clearHistory}
            className="rounded-2xl px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            title="Clear chat history"
          >
            🗑️
          </button>
        </form>
      </div>
    </div>
  );
}
